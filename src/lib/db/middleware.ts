/**
 * Middleware Hooks DB — CRUD operations for middleware_hooks table
 *
 * Module: src/lib/db/middleware.ts
 * Table: middleware_hooks
 * Logs:  middleware_logs
 *
 * Storage path: every statement goes through the async `DatabaseAdapter`
 * (`getAsyncDb()`), in both SQLite and PostgreSQL modes.
 *
 * The two hook *readers* (`getAllMiddlewareHooks`, `getEnabledMiddlewareHooks`)
 * are synchronous by contract — they feed runtime hook loading — so they serve a
 * module-level snapshot that is refreshed through the adapter (TTL + explicit
 * refresh after writes) instead of holding the synchronous SQLite handle.
 */

import { getAsyncDb } from "@/lib/db/core";
import type { DatabaseAdapter } from "@/lib/db/adapters/types";
import { registerDbStateResetter } from "@/lib/db/stateReset";
import type { HookConfig, HookConfigRow, HookLogEntry } from "@/lib/middleware/types";

// ── Helpers ───────────────────────────────────────────────────────────────

function rowToHookConfig(row: HookConfigRow): HookConfig {
  return {
    name: row.name,
    description: row.description,
    priority: row.priority,
    scope:
      row.scope_type === "combo" && row.combo_id
        ? { type: "combo", comboId: row.combo_id }
        : { type: "global" },
    enabled: row.enabled === 1,
    code: row.code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runCount: row.run_count,
    lastError: row.last_error || undefined,
  };
}

function hookConfigToRow(config: HookConfig): HookConfigRow {
  return {
    name: config.name,
    description: config.description,
    priority: config.priority,
    scope_type: config.scope.type,
    combo_id: config.scope.type === "combo" ? config.scope.comboId : null,
    enabled: config.enabled ? 1 : 0,
    code: config.code,
    created_at: config.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    run_count: config.runCount || 0,
    last_error: config.lastError,
  };
}

// ── Synchronous-read snapshot ─────────────────────────────────────────────
//
// Runtime hook loading is synchronous, so the hook list is mirrored into a
// module-level snapshot that is (re)loaded asynchronously:
//   • on demand when a synchronous read finds the snapshot missing or stale,
//   • explicitly after every write through this module.
// Reads hand out clones, so callers can never mutate the cached rows.

const HOOKS_SNAPSHOT_TTL_MS = 30_000;

interface HooksSnapshot {
  hooks: HookConfig[];
  loadedAt: number;
}

let _hooksSnapshot: HooksSnapshot | null = null;
let _hooksRefresh: Promise<void> | null = null;

function cloneHook(hook: HookConfig): HookConfig {
  return { ...hook, scope: hook.scope.type === "combo" ? { ...hook.scope } : hook.scope };
}

async function loadHooksFromDb(): Promise<HookConfig[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const rows = (await db
    .prepare("SELECT * FROM middleware_hooks ORDER BY priority ASC, name ASC")
    .all()) as HookConfigRow[];
  return rows.map(rowToHookConfig);
}

/**
 * Reload the hook snapshot through the async adapter. Concurrent callers share
 * one in-flight load (no N+1); a failure keeps the previous snapshot and is
 * logged instead of thrown — the synchronous readers have no way to surface it.
 */
function refreshMiddlewareHooks(): Promise<void> {
  if (_hooksRefresh) return _hooksRefresh;

  _hooksRefresh = (async () => {
    try {
      const hooks = await loadHooksFromDb();
      _hooksSnapshot = { hooks, loadedAt: Date.now() };
    } catch (error) {
      // Expected before the migration that creates middleware_hooks has run.
      // Keep the previous snapshot; the next read retries.
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[DB] middleware hooks snapshot not loaded (will retry):", message);
    } finally {
      _hooksRefresh = null;
    }
  })();

  return _hooksRefresh;
}

function readHooksSnapshot(): HookConfig[] {
  const snapshot = _hooksSnapshot;
  if (!snapshot || Date.now() - snapshot.loadedAt > HOOKS_SNAPSHOT_TTL_MS) {
    void refreshMiddlewareHooks();
  }
  return (snapshot?.hooks ?? []).map(cloneHook);
}

/** Keep the snapshot in step with a row this module just mutated. */
function patchHookSnapshot(name: string, mutate: (hook: HookConfig) => void): void {
  const hook = _hooksSnapshot?.hooks.find((entry) => entry.name === name);
  if (hook) mutate(hook);
}

function resetMiddlewareHookState(): void {
  _hooksSnapshot = null;
}

registerDbStateResetter(resetMiddlewareHookState);

// NOTE: no DB access at module load — importing this module must never open a
// connection (build phase, edge bundling and isolated test workers all import
// it). The first synchronous read schedules the snapshot load instead; it
// returns the (empty) snapshot for that one call and is populated from the
// next read on.

// ── CRUD Operations ───────────────────────────────────────────────────────

/**
 * Get all hooks from DB.
 *
 * Synchronous by contract (runtime hook loading): serves the snapshot above.
 */
export function getAllMiddlewareHooks(): HookConfig[] {
  return readHooksSnapshot();
}

/**
 * Get enabled hooks from DB (for runtime loading).
 *
 * Synchronous by contract (runtime hook loading): filters the snapshot above.
 */
export function getEnabledMiddlewareHooks(): HookConfig[] {
  return readHooksSnapshot().filter((hook) => hook.enabled);
}

/**
 * Get scoped hooks for a given combo ID.
 */
export async function getComboMiddlewareHooks(comboId: string): Promise<HookConfig[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const rows = (await db
    .prepare(
      "SELECT * FROM middleware_hooks WHERE enabled = 1 AND (scope_type = 'global' OR (scope_type = 'combo' AND combo_id = ?)) ORDER BY priority ASC"
    )
    .all(comboId)) as HookConfigRow[];
  return rows.map(rowToHookConfig);
}

/**
 * Get a single hook by name.
 */
export async function getMiddlewareHook(name: string): Promise<HookConfig | undefined> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const row = (await db.prepare("SELECT * FROM middleware_hooks WHERE name = ?").get(name)) as
    HookConfigRow | undefined;
  return row ? rowToHookConfig(row) : undefined;
}

/**
 * Create a new middleware hook.
 */
export async function createMiddlewareHook(config: HookConfig): Promise<HookConfig> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const row = hookConfigToRow(config);
  row.created_at = new Date().toISOString();
  row.updated_at = row.created_at;

  await db
    .prepare(
      `
    INSERT INTO middleware_hooks (name, description, priority, scope_type, combo_id, enabled, code, created_at, updated_at, run_count, last_error)
    VALUES (@name, @description, @priority, @scope_type, @combo_id, @enabled, @code, @created_at, @updated_at, @run_count, @last_error)
  `
    )
    .run(row);

  await refreshMiddlewareHooks();
  return (await getMiddlewareHook(config.name))!;
}

/**
 * Update an existing middleware hook.
 */
export async function updateMiddlewareHook(
  name: string,
  updates: Partial<HookConfig>
): Promise<HookConfig | undefined> {
  const existing = await getMiddlewareHook(name);
  if (!existing) return undefined;

  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  const row = hookConfigToRow(updated);
  const db = getAsyncDb() as unknown as DatabaseAdapter;

  await db
    .prepare(
      `
    UPDATE middleware_hooks SET
      description = @description,
      priority = @priority,
      scope_type = @scope_type,
      combo_id = @combo_id,
      enabled = @enabled,
      code = @code,
      updated_at = @updated_at,
      run_count = @run_count,
      last_error = @last_error
    WHERE name = @name
  `
    )
    .run(row);

  await refreshMiddlewareHooks();
  return getMiddlewareHook(name);
}

/**
 * Delete a middleware hook.
 */
export async function deleteMiddlewareHook(name: string): Promise<boolean> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const result = await db.prepare("DELETE FROM middleware_hooks WHERE name = ?").run(name);
  if (result.changes > 0) await refreshMiddlewareHooks();
  return result.changes > 0;
}

/**
 * Increment run count and optionally update last error.
 */
export async function recordHookExecution(name: string, error?: string): Promise<void> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  if (error) {
    await db
      .prepare(
        "UPDATE middleware_hooks SET run_count = run_count + 1, last_error = ?, updated_at = datetime('now') WHERE name = ?"
      )
      .run(error, name);
  } else {
    await db
      .prepare(
        "UPDATE middleware_hooks SET run_count = run_count + 1, last_error = NULL, updated_at = datetime('now') WHERE name = ?"
      )
      .run(name);
  }

  // Patch the snapshot instead of reloading: this runs once per hook execution.
  // `updatedAt` is left to the next snapshot reload (it is written by the DB clock).
  patchHookSnapshot(name, (hook) => {
    hook.runCount += 1;
    hook.lastError = error;
  });
}

// ── Log Operations ────────────────────────────────────────────────────────

/**
 * Insert a hook execution log entry.
 */
export async function insertHookLog(entry: HookLogEntry): Promise<void> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db
    .prepare(
      `
    INSERT INTO middleware_logs (id, hook_name, request_id, duration_ms, mutated, skipped, error, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      entry.id,
      entry.hookName,
      entry.requestId,
      entry.durationMs,
      entry.mutated ? 1 : 0,
      entry.skipped ? 1 : 0,
      entry.error || null,
      entry.timestamp
    );
}

/**
 * Get hook execution logs, optionally filtered by hook name.
 */
export async function getHookLogs(hookName?: string, limit = 50): Promise<HookLogEntry[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  let rows: any[];
  if (hookName) {
    rows = await db
      .prepare("SELECT * FROM middleware_logs WHERE hook_name = ? ORDER BY timestamp DESC LIMIT ?")
      .all(hookName, limit);
  } else {
    rows = await db
      .prepare("SELECT * FROM middleware_logs ORDER BY timestamp DESC LIMIT ?")
      .all(limit);
  }
  return rows.map((r: any) => ({
    id: r.id,
    hookName: r.hook_name,
    requestId: r.request_id,
    durationMs: r.duration_ms,
    mutated: r.mutated === 1,
    skipped: r.skipped === 1,
    error: r.error,
    timestamp: r.timestamp,
  }));
}

/**
 * Delete logs beyond the newest `maxEntries`.
 *
 * Fire-and-forget housekeeping: the delete goes through the async adapter, so
 * the caller must not wait for it (this function used to return the adapter's
 * Promise's `.changes`, i.e. always `undefined` in both drivers).
 */
export function cleanupHookLogs(maxEntries = 10000): void {
  void deleteOldHookLogs(maxEntries);
}

async function deleteOldHookLogs(maxEntries: number): Promise<void> {
  try {
    const db = getAsyncDb() as unknown as DatabaseAdapter;
    // Delete logs beyond the max, keeping the most recent
    await db
      .prepare(
        `
    DELETE FROM middleware_logs WHERE id NOT IN (
      SELECT id FROM middleware_logs ORDER BY timestamp DESC LIMIT ?
    )
  `
      )
      .run(maxEntries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[DB] Failed to clean up middleware hook logs:", message);
  }
}
