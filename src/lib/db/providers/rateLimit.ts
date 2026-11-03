/**
 * db/providers/rateLimit.ts — Rate-limit/quota runtime helpers for provider_connections.
 *
 * The rate-limit state is read on every account-selection pass, so the hot
 * predicates (`isConnectionRateLimited`, `getRateLimitedConnections`) stay
 * synchronous and answer from a process-wide snapshot instead of issuing a
 * query per candidate. The snapshot is loaded with ONE async-adapter query and
 * refreshed on a short TTL by `startRateLimitSnapshotRefresh()`; writes update
 * the snapshot immediately and persist fire-and-forget (they are already
 * documented best-effort).
 */

import { getAsyncDb } from "../core";
import { invalidateDbCache } from "../readCache";

// ──────────────── Rate-limit snapshot ──────────────────────────────────────

/** How long a loaded snapshot is served before being refreshed. */
const RATE_LIMIT_SNAPSHOT_TTL_MS = 10_000;

/** connectionId → epoch-ms when the cooldown expires (only non-null rows). */
let _untilByConnection = new Map<string, number>();

/** connectionId → provider id, so the provider-filtered read needs no query. */
let _providerByConnection = new Map<string, string>();

/**
 * Writes applied locally (including clears) since the last snapshot load. These
 * are re-applied over a snapshot result so a refresh racing an in-flight write
 * cannot resurrect a cooldown that was just set/cleared.
 */
const _recentWrites = new Map<string, { until: number | null; at: number }>();

let _snapshotLoaded = false;
let _snapshotLoadedAt = 0;
let _snapshotInFlight: Promise<void> | null = null;
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * `rate_limited_until` is a TEXT column that receives epoch numbers, numeric
 * strings and ISO strings depending on the writer. Normalise all of them to
 * epoch-ms; anything unparseable is treated as "not limited".
 */
function coerceUntilMs(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Load (or refresh) the rate-limit snapshot. Safe to call on every request:
 * a fresh snapshot returns immediately, and concurrent callers share the same
 * in-flight load.
 */
export async function ensureRateLimitSnapshot(force = false): Promise<void> {
  const fresh =
    !force && _snapshotLoaded && Date.now() - _snapshotLoadedAt < RATE_LIMIT_SNAPSHOT_TTL_MS;
  if (fresh) return;
  if (_snapshotInFlight) {
    await _snapshotInFlight;
    return;
  }

  _snapshotInFlight = (async () => {
    try {
      const db = getAsyncDb();
      const rows = (await db
        .prepare(
          "SELECT id, provider, rate_limited_until FROM provider_connections WHERE rate_limited_until IS NOT NULL"
        )
        .all()) as Array<Record<string, unknown>>;

      const nextUntil = new Map<string, number>();
      const nextProvider = new Map<string, string>();
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : "";
        if (!id) continue;
        const until = coerceUntilMs(row.rate_limited_until);
        if (until === null) continue;
        nextUntil.set(id, until);
        if (typeof row.provider === "string" && row.provider) {
          nextProvider.set(id, row.provider);
        }
      }

      // Re-apply our own writes that are newer than the DB read could observe
      // (PG commits are async; a snapshot must never drop a just-set cooldown).
      const writeCutoff = Date.now() - RATE_LIMIT_SNAPSHOT_TTL_MS;
      for (const [id, write] of _recentWrites) {
        if (write.at < writeCutoff) {
          _recentWrites.delete(id);
          continue;
        }
        if (write.until === null) {
          nextUntil.delete(id);
          nextProvider.delete(id);
        } else {
          nextUntil.set(id, write.until);
        }
      }

      _untilByConnection = nextUntil;
      _providerByConnection = nextProvider;
      _snapshotLoaded = true;
      _snapshotLoadedAt = Date.now();
    } catch {
      // Keep the previous snapshot — account selection must not fail because a
      // refresh did not land. Avoid hammering the DB on a broken connection.
      _snapshotLoaded = true;
      _snapshotLoadedAt = Date.now();
    } finally {
      _snapshotInFlight = null;
    }
  })();
  await _snapshotInFlight;
}

/**
 * Keep the snapshot warm: one query per refresh window instead of one per
 * candidate. The timer is unref'd so it never holds the process open, matching
 * `startFitnessSnapshotRefresh()` in open-sse/services/autoCombo/taskFitness.ts.
 */
export function startRateLimitSnapshotRefresh(intervalMs = RATE_LIMIT_SNAPSHOT_TTL_MS): void {
  if (_refreshTimer) return;
  void ensureRateLimitSnapshot(true);
  _refreshTimer = setInterval(() => {
    void ensureRateLimitSnapshot(true);
  }, intervalMs);
  if (typeof _refreshTimer === "object" && "unref" in _refreshTimer) {
    (_refreshTimer as { unref?: () => void }).unref?.();
  }
}

/** Learn a connection's provider lazily (writes only know the connection id). */
async function resolveProviderForWrite(connectionId: string): Promise<void> {
  try {
    const db = getAsyncDb();
    const row = (await db
      .prepare("SELECT provider FROM provider_connections WHERE id = ?")
      .get(connectionId)) as { provider?: unknown } | undefined;
    if (typeof row?.provider === "string" && row.provider) {
      _providerByConnection.set(connectionId, row.provider);
    }
  } catch {
    // best-effort — the next snapshot refresh fills the provider map
  }
}

/**
 * Fire-and-forget persistence of a rate-limit write (async adapter; a DB
 * failure must never crash the request path).
 */
async function persistRateLimitUntil(connectionId: string, until: number | null): Promise<void> {
  const db = getAsyncDb();
  await db
    .prepare("UPDATE provider_connections SET rate_limited_until = ?, updated_at = ? WHERE id = ?")
    .run(until, new Date().toISOString(), connectionId);
}

// ──────────────── T05: Rate-Limit DB Persistence ──────────────────────────
// Allows rate-limit state to survive token refresh without being accidentally
// cleared. DB column rate_limited_until already exists in schema.
// Ref: sub2api PR #1218 (fix(openai): prevent rescheduling rate-limited accounts)

/**
 * T05: Persist when a connection is rate-limited, directly in DB.
 * This survives token refresh — OAuth flows must NOT override this field.
 *
 * The in-memory snapshot is updated immediately (the read predicates are
 * synchronous); the DB write is fire-and-forget because this is documented as
 * best-effort and must stay off the chat path.
 *
 * @param connectionId - The provider_connections.id
 * @param until - Epoch ms when the rate limit expires (null to clear)
 */
export function setConnectionRateLimitUntil(connectionId: string, until: number | null): void {
  if (typeof connectionId !== "string" || connectionId.length === 0) return;

  const untilMs = until === null ? null : coerceUntilMs(until);
  _recentWrites.set(connectionId, { until: untilMs, at: Date.now() });
  if (untilMs === null) {
    _untilByConnection.delete(connectionId);
    _providerByConnection.delete(connectionId);
  } else {
    _untilByConnection.set(connectionId, untilMs);
    if (!_providerByConnection.has(connectionId)) {
      void resolveProviderForWrite(connectionId);
    }
  }

  invalidateDbCache("connections");
  void persistRateLimitUntil(connectionId, until).catch(() => {
    // best-effort — the local snapshot still reflects the intended state
  });
}

/**
 * Mark a connection as rate-limited until `Date.now() + retryAfterMs`.
 *
 * Best-effort: never throws — a DB failure must not crash the chat path. The T05
 * startup helper `clearStaleCrashCooldowns` will not undo a write made here because
 * the timestamp is always strictly in the future at the moment of write. See Issue #1
 * (per-account 429 cascade not persisting).
 */
export function markConnectionRateLimitedUntil(connectionId: string, retryAfterMs: number): void {
  if (typeof connectionId !== "string" || connectionId.length === 0) return;
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return;
  try {
    setConnectionRateLimitUntil(connectionId, Date.now() + retryAfterMs);
  } catch {
    // best-effort
  }
}

/**
 * Clear a connection's persisted 429 cooldown.
 *
 * Best-effort: never throws. Mirrors `resetAccountState`'s in-memory clear so the
 * in-memory AccountState and the DB row agree.
 */
export function clearConnectionRateLimit(connectionId: string): void {
  if (typeof connectionId !== "string" || connectionId.length === 0) return;
  try {
    setConnectionRateLimitUntil(connectionId, null);
  } catch {
    // best-effort
  }
}

/**
 * Self-heal when the refresh timer is not running (tests, CLI paths): schedule
 * an async reload when the snapshot is cold or older than its TTL. The caller
 * still answers synchronously from the current map.
 */
function kickSnapshotRefreshIfStale(): void {
  if (_snapshotInFlight) return;
  if (!_snapshotLoaded || Date.now() - _snapshotLoadedAt >= RATE_LIMIT_SNAPSHOT_TTL_MS) {
    void ensureRateLimitSnapshot();
  }
}

/**
 * T05: Check if a connection is currently rate-limited (snapshot-backed).
 * Use this before account selection to skip transiently rate-limited accounts.
 *
 * Stays synchronous by construction — no query is issued here. The snapshot is
 * warmed at startup / by the refresh timer; a cold snapshot kicks an async load
 * and answers from whatever is already loaded.
 *
 * @returns true if rate_limited_until is set and in the future
 */
export function isConnectionRateLimited(connectionId: string): boolean {
  kickSnapshotRefreshIfStale();
  const until = _untilByConnection.get(connectionId);
  if (until === undefined) {
    return false;
  }
  return Date.now() < until;
}

/**
 * T05: Get all connections for a provider that are currently rate-limited.
 * Returns an array of { id, rateLimitedUntil } for dashboard display.
 *
 * Synchronous snapshot read: the provider is taken from the snapshot. A
 * connection limited earlier in this process has its provider resolved lazily;
 * until that lands it is included so a freshly-set cooldown is never hidden.
 */
export function getRateLimitedConnections(
  provider: string
): Array<{ id: string; rateLimitedUntil: number }> {
  kickSnapshotRefreshIfStale();
  const now = Date.now();
  const result: Array<{ id: string; rateLimitedUntil: number }> = [];
  for (const [id, until] of _untilByConnection) {
    if (until <= now) {
      _untilByConnection.delete(id);
      continue;
    }
    const knownProvider = _providerByConnection.get(id);
    if (knownProvider !== undefined && knownProvider !== provider) continue;
    result.push({ id, rateLimitedUntil: until });
  }
  return result;
}

// ──────────────── T13: Stale Quota Display Fix ─────────────────────────────
// Codex/Claude quotas display stale cumulative usage after the window resets.
// By comparing resetAt timestamp to now(), we can show 0 when window has passed.
// Ref: sub2api PR #1171 (fix: quota display shows stale cumulative usage after reset)

/**
 * T13: Get effective quota usage, zeroing it out if the window has already reset.
 *
 * @param used - Stored usage value (tokens used in the window)
 * @param resetAt - ISO-8601 string or epoch ms when the window resets, or null
 * @returns Effective usage: 0 if window expired, original value otherwise
 */
export function getEffectiveQuotaUsage(
  used: number,
  resetAt: string | number | null | undefined
): number {
  if (!resetAt) return used;
  const resetTime = typeof resetAt === "number" ? resetAt : new Date(resetAt).getTime();
  if (isNaN(resetTime)) return used;
  // Window has passed — display should show 0 (pending next snapshot)
  if (Date.now() >= resetTime) return 0;
  return used;
}

/**
 * T05: Startup crash-recovery — clear stale transient connection cooldowns.
 *
 * After an unclean crash (SIGKILL, OOM-kill, large-body burst) the normal
 * error-handler paths that would clear/normalise cooldowns never run.
 * A connection's `rate_limited_until` may have been pushed far into the
 * future by exponential back-off.  On next startup that leaves all affected
 * connections excluded by `getProviderCredentials()`, so every request sits
 * in the Bottleneck queue and times out at `maxWaitMs` (120 s default).
 *
 * Safe invariants:
 *  - Only connections with `rate_limited_until IS NOT NULL` are touched.
 *  - Terminal states (`banned`, `expired`, `credits_exhausted`) are skipped —
 *    those require a deliberate credential change or operator reset.
 *  - Past timestamps are also cleared: they are already expired in the lazy
 *    expiry sense, but clearing them resets `backoffLevel` / transient error
 *    fields so the connection gets a clean slate on this fresh process.
 *
 * Must be called once, early in the startup sequence, before any request
 * is handled.  Returns the number of connections that were cleared.
 */
export async function clearStaleCrashCooldowns(): Promise<{ cleared: number }> {
  const db = getAsyncDb();
  const now = new Date().toISOString();

  // Fetch all connections that have a rate_limited_until set and are NOT in
  // a terminal state.  We do the terminal-status filter in JS to reuse the
  // canonical `TERMINAL_STATUSES` set rather than duplicating the list in SQL.
  const TERMINAL_STATUSES = new Set(["banned", "expired", "credits_exhausted"]);

  const rows = (await db
    .prepare(
      `SELECT id, test_status FROM provider_connections WHERE rate_limited_until IS NOT NULL`
    )
    .all()) as Array<{ id: string; test_status: string | null }>;

  const toReset = rows.filter((r) => {
    const status = (r.test_status || "").trim().toLowerCase();
    return !TERMINAL_STATUSES.has(status);
  });

  if (toReset.length === 0) return { cleared: 0 };

  const ids = toReset.map((row) => row.id);

  // One transaction, one UPDATE per bounded batch (never a per-row statement
  // loop). The adapter owns BEGIN/COMMIT and the PG equivalent.
  await db.immediate(async () => {
    const BATCH_SIZE = 200;
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(", ");
      await db
        .prepare(
          `UPDATE provider_connections SET
             rate_limited_until = NULL,
             test_status        = 'active',
             backoff_level      = 0,
             last_error         = NULL,
             last_error_at      = NULL,
             last_error_type    = NULL,
             last_error_source  = NULL,
             error_code         = NULL,
             updated_at         = ?
           WHERE id IN (${placeholders})`
        )
        .run(now, ...batch);
    }
  });

  invalidateDbCache("connections");

  // The startup clear must win over any concurrently loading snapshot.
  const clearedAt = Date.now();
  for (const id of ids) {
    _untilByConnection.delete(id);
    _recentWrites.set(id, { until: null, at: clearedAt });
  }

  return { cleared: toReset.length };
}

// T13: Format a reset countdown as a human-readable string ("2h 35m" / "4m 30s").
// The implementation lives in the client-safe formatting utils so client
// components (e.g. CoolingConnectionsPanel) can import it without pulling this
// server-only DB module (better-sqlite3/ioredis) into the browser bundle.
// Re-exported here for existing server-side callers and the db/providers barrel.
export { formatResetCountdown } from "@/shared/utils/formatting";
