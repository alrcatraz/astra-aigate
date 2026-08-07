// Proxy scope pool rotation & alive-pool resolution (#6365).
//
// Extracted from ../proxies.ts (#7046 file-size follow-up): this module holds the
// rotation-strategy bookkeeping (cursor persistence, strategy normalization) and the
// read-only alive-pool resolution used by the registry proxy resolvers. It has no
// dependency back on ../proxies.ts — mutators that also need to bump the registry
// generation counter (addProxyToScopePool, removeProxyFromScopePool,
// setScopeRotationStrategy) stay in ../proxies.ts and import the pure helpers here.
import { randomInt } from "crypto";
import { getDbInstance, getAsyncDb } from "../core";
import { pickByLatency } from "../proxyLatency";
import type { JsonRecord, ProxyScope, ProxyRotationStrategy } from "./types";
import { PROXY_ROTATION_STRATEGIES, DEFAULT_PROXY_ROTATION_STRATEGY } from "./types";
import {
  mapAssignmentRow,
  toRegistryProxyResolution,
  normalizeScope,
  normalizeAssignmentScopeId,
} from "./mappers";

// Rotation state keys off the SAME normalized scope_id as assignments so a global
// pool ('__global__') and a per-scope pool share one deterministic cursor row.
export function normalizeRotationScopeId(scope: ProxyScope, scopeId?: string | null): string {
  return normalizeAssignmentScopeId(scope, scopeId) ?? "";
}

export async function clearRotationState(
  db: ReturnType<typeof getDbInstance>,
  scope: string,
  normalizedScopeId: string | null
) {
  await db
    .prepare("DELETE FROM proxy_scope_rotation WHERE scope = ? AND scope_id IS ?")
    .run(scope, normalizedScopeId ?? "");
}

export async function resetRotationCursor(
  db: ReturnType<typeof getDbInstance>,
  scope: string,
  normalizedScopeId: string | null
) {
  await db
    .prepare(
      "UPDATE proxy_scope_rotation SET cursor = 0, rotated_at = NULL, updated_at = ? WHERE scope = ? AND scope_id IS ?"
    )
    .run(new Date().toISOString(), scope, normalizedScopeId ?? "");
}

export function normalizeRotationStrategy(strategy: unknown): ProxyRotationStrategy {
  return PROXY_ROTATION_STRATEGIES.includes(strategy as ProxyRotationStrategy)
    ? (strategy as ProxyRotationStrategy)
    : DEFAULT_PROXY_ROTATION_STRATEGY;
}

/**
 * List a scope's pool members in rotation order (position ASC). Includes every
 * assigned proxy regardless of alive status — callers that only want serviceable
 * members should filter by proxy status themselves.
 */
export async function getScopeProxyPool(scope: string, scopeId?: string | null) {
  const normalizedScope = normalizeScope(scope);
  const normalizedScopeId = normalizeAssignmentScopeId(normalizedScope, scopeId);
  const db = await getAsyncDb();
  return (
    await db
      .prepare(
        "SELECT id, proxy_id, scope, scope_id, position, created_at, updated_at FROM proxy_assignments WHERE scope = ? AND scope_id IS ? ORDER BY position ASC, created_at ASC, id ASC"
      )
      .all(normalizedScope, normalizedScopeId)
  ).map(mapAssignmentRow);
}

/** Read a scope's rotation strategy (#6365). Defaults to `round-robin`. */
export async function getScopeRotationStrategy(
  scope: string,
  scopeId?: string | null
): Promise<ProxyRotationStrategy> {
  const normalizedScope = normalizeScope(scope);
  const rotationScopeId = normalizeRotationScopeId(normalizedScope, scopeId);
  const db = await getAsyncDb();
  const row = (await db
    .prepare("SELECT strategy FROM proxy_scope_rotation WHERE scope = ? AND scope_id IS ?")
    .get(normalizedScope, rotationScopeId)) as { strategy?: string } | undefined;
  return normalizeRotationStrategy(row?.strategy);
}

// Read the rotation row for a scope, creating a default one lazily so the
// round-robin cursor has somewhere to live. Best-effort: any write failure leaves
// the caller on the default strategy with an ephemeral cursor.
async function getOrCreateRotationRow(
  db: ReturnType<typeof getDbInstance>,
  normalizedScope: string,
  rotationScopeId: string
): Promise<{
  strategy: ProxyRotationStrategy;
  cursor: number;
  stickyWindowMinutes: number;
  rotatedAt: string | null;
}> {
  const row = (await db
    .prepare(
      "SELECT strategy, cursor, sticky_window_minutes, rotated_at FROM proxy_scope_rotation WHERE scope = ? AND scope_id IS ?"
    )
    .get(normalizedScope, rotationScopeId)) as
    | {
        strategy?: string;
        cursor?: number;
        sticky_window_minutes?: number;
        rotated_at?: string | null;
      }
    | undefined;

  if (row) {
    return {
      strategy: normalizeRotationStrategy(row.strategy),
      cursor: Number(row.cursor) || 0,
      stickyWindowMinutes: Number(row.sticky_window_minutes) || 30,
      rotatedAt: typeof row.rotated_at === "string" ? row.rotated_at : null,
    };
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT OR IGNORE INTO proxy_scope_rotation (scope, scope_id, strategy, cursor, updated_at) VALUES (?, ?, ?, 0, ?)"
    )
    .run(normalizedScope, rotationScopeId, DEFAULT_PROXY_ROTATION_STRATEGY, now);
  return {
    strategy: DEFAULT_PROXY_ROTATION_STRATEGY,
    cursor: 0,
    stickyWindowMinutes: 30,
    rotatedAt: null,
  };
}

/**
 * Pick one member from an already-alive candidate list according to the scope's
 * rotation strategy. Assumes `candidates` is non-empty and ordered by position.
 * Round-robin uses (and persists) a monotonic cursor; random uses crypto.randomInt;
 * sticky holds the current member until its window elapses, then advances.
 */
async function pickFromCandidates<T>(
  db: ReturnType<typeof getDbInstance>,
  normalizedScope: string,
  rotationScopeId: string,
  candidates: T[]
): Promise<T> {
  if (candidates.length === 1) return candidates[0];

  const state = await getOrCreateRotationRow(db, normalizedScope, rotationScopeId);

  if (state.strategy === "random") {
    return candidates[randomInt(candidates.length)];
  }

  if (state.strategy === "latency") return pickByLatency(db, candidates);

  if (state.strategy === "sticky") {
    const windowMs = state.stickyWindowMinutes * 60_000;
    const lastRotated = state.rotatedAt ? Date.parse(state.rotatedAt) : NaN;
    const expired = !Number.isFinite(lastRotated) || Date.now() - lastRotated >= windowMs;
    let cursor = state.cursor;
    if (expired) {
      cursor = state.cursor + 1;
      await db
        .prepare(
          "UPDATE proxy_scope_rotation SET cursor = ?, rotated_at = ?, updated_at = ? WHERE scope = ? AND scope_id IS ?"
        )
        .run(
          cursor,
          new Date().toISOString(),
          new Date().toISOString(),
          normalizedScope,
          rotationScopeId
        );
    }
    const idx = ((cursor % candidates.length) + candidates.length) % candidates.length;
    return candidates[idx];
  }

  // round-robin (default): pick at the current cursor, then advance it monotonically.
  const idx = ((state.cursor % candidates.length) + candidates.length) % candidates.length;
  await db
    .prepare(
      "UPDATE proxy_scope_rotation SET cursor = ?, updated_at = ? WHERE scope = ? AND scope_id IS ?"
    )
    .run(state.cursor + 1, new Date().toISOString(), normalizedScope, rotationScopeId);
  return candidates[idx];
}

// A proxy is "alive" for resolution unless it has been explicitly marked dead
// (by an operator or a health check). Conservative: active/null/unknown stay
// usable so a working proxy is never stranded; only known-dead states are
// excluded so a dead proxy stops being handed out (every request would
// otherwise pay the timeout or leak out the host IP).
export const PROXY_ALIVE_PREDICATE =
  "(p.status IS NULL OR LOWER(p.status) NOT IN ('inactive','error','disabled','dead','down'))";

// Fetch the alive, position-ordered candidate rows for a (scope, scope_id) pool.
// `scope_id` is matched with `IS` (NULL-safe); pass the query-level scope_id
// (connection id / provider / '__global__' / combo id) — global callers pass null
// to match the historical "any global row" behavior.
async function fetchAlivePoolRows(
  db: ReturnType<typeof getDbInstance>,
  scope: string,
  scopeIdFilter: string | null,
  matchAnyScopeId: boolean
): Promise<JsonRecord[]> {
  const baseSelect =
    "SELECT p.id, p.type, p.host, p.port, p.username, p.password, p.notes, p.family, a.position AS __pos, a.id AS __aid " +
    "FROM proxy_assignments a JOIN proxy_registry p ON p.id = a.proxy_id WHERE a.scope = ? ";
  const order = " ORDER BY a.position ASC, a.id ASC";
  if (matchAnyScopeId) {
    return (await db
      .prepare(`${baseSelect}AND ${PROXY_ALIVE_PREDICATE}${order}`)
      .all(scope)) as JsonRecord[];
  }
  return (await db
    .prepare(`${baseSelect}AND a.scope_id IS ? AND ${PROXY_ALIVE_PREDICATE}${order}`)
    .all(scope, scopeIdFilter)) as JsonRecord[];
}

// Resolve one scope's alive pool to a single proxy via its rotation strategy.
// Returns the standard registry resolution shape, or null when the pool is empty
// or every member is dead (preserving the #6246 fail-closed contract — a dead
// pool never falls through to direct egress; the caller's guard blocks it).
async function resolveScopePoolInternal(
  db: ReturnType<typeof getDbInstance>,
  scope: ProxyScope,
  levelId: string | null,
  options: { rotationScopeId: string; matchAnyScopeId?: boolean; scopeIdFilter?: string | null }
): Promise<ReturnType<typeof toRegistryProxyResolution> | null> {
  const rows = await fetchAlivePoolRows(
    db,
    scope,
    options.scopeIdFilter ?? null,
    options.matchAnyScopeId === true
  );
  if (rows.length === 0) return null;
  const picked = await pickFromCandidates(db, scope, options.rotationScopeId, rows);
  return toRegistryProxyResolution(picked, scope, levelId);
}

export async function resolveProxyForConnectionFromRegistry(connectionId: string) {
  try {
    const db = await getAsyncDb();

    const account = await resolveScopePoolInternal(db, "account", connectionId, {
      rotationScopeId: connectionId,
      scopeIdFilter: connectionId,
    });
    if (account) return account;

    const connection = (await db
      .prepare("SELECT provider FROM provider_connections WHERE id = ?")
      .get(connectionId)) as { provider?: string } | undefined;

    if (connection?.provider) {
      const provider = await resolveScopePoolInternal(db, "provider", connection.provider, {
        rotationScopeId: connection.provider,
        scopeIdFilter: connection.provider,
      });
      if (provider) return provider;
    }

    const global = await resolveScopePoolInternal(db, "global", null, {
      rotationScopeId: normalizeRotationScopeId("global", null),
      matchAnyScopeId: true,
    });
    if (global) return global;

    return null;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no such table")) return null;
    throw error;
  }
}

export async function resolveProxyForScopeFromRegistry(scope: string, scopeId?: string | null) {
  try {
    const db = await getAsyncDb();
    const normalizedScope = normalizeScope(scope);

    if (normalizedScope === "global") {
      return resolveScopePoolInternal(db, "global", null, {
        rotationScopeId: normalizeRotationScopeId("global", null),
        matchAnyScopeId: true,
      });
    }

    const normalizedScopeId = scopeId || null;
    if (!normalizedScopeId) return null;

    return resolveScopePoolInternal(db, normalizedScope, normalizedScopeId, {
      rotationScopeId: normalizeRotationScopeId(normalizedScope, normalizedScopeId),
      scopeIdFilter: normalizedScopeId,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no such table")) return null;
    throw error;
  }
}
