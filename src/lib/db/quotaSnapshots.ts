import { rowToCamel, getAsyncDb } from "./core";
import type { DatabaseAdapter } from "./adapters/types";
import type { QuotaSnapshotRow, ProviderUtilizationPoint } from "@/shared/types/utilization";

type JsonRecord = Record<string, unknown>;

let lastCleanupAt = 0;

// ─── Latest-per-window read-through cache ────────────────────────────────────
//
// `getLatestQuotaSnapshotsForConnectionSync` feeds `quotaCache.hydrate`, which is
// called from `Array.sort` comparators in auth's connection scoring — a
// comparator cannot await, and PostgreSQL has no synchronous driver. The sync
// getter therefore reads a module-level snapshot loaded through the async
// adapter, bounded by a TTL and refreshed in the background (one query per
// connection per window, never one per lookup).
const LATEST_SNAPSHOT_CACHE_TTL_MS = 60_000;

interface LatestSnapshotCacheEntry {
  /** Adapter identity — a reset/open swaps it, so old rows must not leak. */
  db: DatabaseAdapter;
  rows: QuotaSnapshotRow[];
  loadedAt: number;
}

const latestSnapshotCache = new Map<string, LatestSnapshotCacheEntry>();
const latestSnapshotInFlight = new Map<string, Promise<void>>();

function rowWindowKey(row: QuotaSnapshotRow): string | null {
  const record = row as unknown as JsonRecord;
  const key = record.windowKey ?? record.window_key;
  return typeof key === "string" ? key : null;
}

function normalizeWindowSnapshot(
  snapshot: {
    provider: string;
    connection_id: string;
    window_key: string;
    remaining_percentage: number | null;
    is_exhausted: number;
    next_reset_at: string | null;
    window_duration_ms: number | null;
    raw_data: string | null;
  },
  createdAt: string
): QuotaSnapshotRow {
  // Same camelCase shape the async readers produce via rowToCamel(): hydrate
  // accepts both spellings, and the camel one is what it reads first.
  return {
    provider: snapshot.provider,
    connectionId: snapshot.connection_id,
    windowKey: snapshot.window_key,
    remainingPercentage: snapshot.remaining_percentage,
    isExhausted: snapshot.is_exhausted,
    nextResetAt: snapshot.next_reset_at,
    windowDurationMs: snapshot.window_duration_ms,
    rawData: snapshot.raw_data,
    createdAt,
  } as unknown as QuotaSnapshotRow;
}

/** Merge a just-written snapshot into the cache (invalidation on write). */
function applySnapshotToCache(
  db: DatabaseAdapter,
  snapshot: Parameters<typeof normalizeWindowSnapshot>[0],
  createdAt: string
): void {
  const existing = latestSnapshotCache.get(snapshot.connection_id);
  const usable = existing && existing.db === db ? existing : null;
  const rows = (usable?.rows ?? []).filter((row) => rowWindowKey(row) !== snapshot.window_key);
  rows.push(normalizeWindowSnapshot(snapshot, createdAt));
  // A cache entry created from a single write is partial: mark it stale (0) so
  // the next synchronous read also kicks a full background refresh, while the
  // row we just wrote is already visible to this process.
  latestSnapshotCache.set(snapshot.connection_id, {
    db,
    rows,
    loadedAt: usable ? Date.now() : 0,
  });
}

/**
 * Load the latest row per window for a connection through the async adapter.
 * Kept private: callers without a sync constraint should use
 * `getLatestQuotaSnapshotsForConnection`.
 */
async function loadLatestSnapshotsForConnection(connectionId: string): Promise<QuotaSnapshotRow[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const rows = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY window_key ORDER BY created_at DESC, id DESC
         ) AS rn
         FROM quota_snapshots
         WHERE connection_id = ?
       )
       WHERE rn = 1`
    )
    .all(connectionId);

  return rows.map((row) => rowToCamel(row) as unknown as QuotaSnapshotRow);
}

/** One background refresh per connection at a time; failures keep old rows. */
function refreshLatestSnapshotCache(connectionId: string): void {
  if (latestSnapshotInFlight.has(connectionId)) return;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const inFlight = (async () => {
    try {
      const rows = await loadLatestSnapshotsForConnection(connectionId);
      latestSnapshotCache.set(connectionId, { db, rows, loadedAt: Date.now() });
    } catch {
      // quota_snapshots absent or DB unavailable — keep the previous rows.
    } finally {
      latestSnapshotInFlight.delete(connectionId);
    }
  })();
  latestSnapshotInFlight.set(connectionId, inFlight);
}

export async function saveQuotaSnapshot(
  snapshot: Omit<QuotaSnapshotRow, "id" | "created_at">
): Promise<void> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const now = new Date().toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO quota_snapshots
       (provider, connection_id, window_key, remaining_percentage, is_exhausted,
        next_reset_at, window_duration_ms, raw_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.provider,
        snapshot.connection_id,
        snapshot.window_key,
        snapshot.remaining_percentage,
        snapshot.is_exhausted,
        snapshot.next_reset_at,
        snapshot.window_duration_ms,
        snapshot.raw_data,
        now
      );
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      console.warn(
        "[QuotaSnapshots] Skipping save: quota_snapshots table not found. Awaiting migration."
      );
      return;
    }
    throw err;
  }

  // Invalidate/refresh the sync tier with the row we just wrote (no query: the
  // row is merged in place). Without this, hydrate right after a write would
  // still see the pre-write snapshot.
  applySnapshotToCache(db, snapshot, now);
}

export async function getQuotaSnapshots(opts: {
  provider?: string;
  connectionId?: string;
  since: string;
  until?: string;
}): Promise<QuotaSnapshotRow[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const conditions: string[] = ["created_at >= ?"];
  const params: unknown[] = [opts.since];

  if (opts.provider) {
    conditions.push("provider = ?");
    params.push(opts.provider);
  }

  if (opts.connectionId) {
    conditions.push("connection_id = ?");
    params.push(opts.connectionId);
  }

  if (opts.until) {
    conditions.push("created_at <= ?");
    params.push(opts.until);
  }

  try {
    const sql = `SELECT * FROM quota_snapshots WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`;
    const rows = await db.prepare(sql).all(...params);
    return rows.map((r) => rowToCamel(r) as unknown as QuotaSnapshotRow);
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      return [];
    }
    throw err;
  }
}

/**
 * Returns the single latest snapshot row for each distinct `window_key`
 * ever observed for this connection.
 *
 * Deliberately NOT a "most recent N rows across all windows" query: a
 * connection with many quota windows where only a subset actively churn
 * (frequent writes as they drain) and the rest stay idle/healthy (a single
 * old row each, thanks to the #4438 no-op-write dedup) would otherwise have
 * its recent-rows slice flooded entirely by the hot windows, silently
 * evicting the idle windows from rehydration (#8431). Scoping "latest" PER
 * window_key via a window function keeps every window visible regardless of
 * how skewed the write frequency is across windows.
 */
export async function getLatestQuotaSnapshotsForConnection(
  connectionId: string
): Promise<QuotaSnapshotRow[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;

  try {
    const rows = await loadLatestSnapshotsForConnection(connectionId);
    // Prime the synchronous tier from this read — the async caller already paid
    // for the query, so hydrate does not need a second one within the TTL.
    latestSnapshotCache.set(connectionId, { db, rows, loadedAt: Date.now() });
    return rows;
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      return [];
    }
    throw err;
  }
}

/**
 * Synchronous variant of getLatestQuotaSnapshotsForConnection for callers that
 * must stay sync (quotaCache.hydrate, which feeds the Array.sort comparator in
 * auth's connection scoring — a comparator cannot await).
 *
 * Reads the module-level snapshot loaded through the async adapter (TTL + write
 * invalidation) instead of a raw synchronous handle: PostgreSQL has no sync
 * driver, and the previous raw-handle read silently hit an in-memory SQLite
 * scratch in PG mode. A cold/stale entry returns the rows already known
 * (possibly none for a first-ever call) and refreshes in the background.
 */
export function getLatestQuotaSnapshotsForConnectionSync(connectionId: string): QuotaSnapshotRow[] {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const cached = latestSnapshotCache.get(connectionId);
  const usable = cached && cached.db === db ? cached : null;
  const fresh = usable !== null && Date.now() - usable.loadedAt < LATEST_SNAPSHOT_CACHE_TTL_MS;
  if (!fresh) refreshLatestSnapshotCache(connectionId);
  return usable ? usable.rows : [];
}

/**
 * Awaitable warm-up for callers that can wait before scoring.
 *
 * The sync reader above cannot await (it feeds a sort comparator), so on a cold
 * cache it hands back an empty row set and refreshes in the background. Selection
 * that runs right after a restart would then decide without any snapshot. Priming
 * first makes that first read see real rows; failure is non-fatal and leaves the
 * same empty result the sync path would have produced.
 */
export async function primeLatestQuotaSnapshots(connectionId: string): Promise<void> {
  try {
    const db = getAsyncDb() as unknown as DatabaseAdapter;
    const rows = await loadLatestSnapshotsForConnection(connectionId);
    latestSnapshotCache.set(connectionId, { db, rows, loadedAt: Date.now() });
  } catch {
    // quota_snapshots absent or DB unavailable — keep whatever is cached
  }
}

export async function getAggregatedSnapshots(opts: {
  provider?: string;
  since: string;
  until?: string;
  bucketMinutes: number;
  aggregateBy?: "provider" | "connection";
}): Promise<ProviderUtilizationPoint[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const conditions: string[] = ["created_at >= ?"];
  const params: unknown[] = [opts.since];

  if (opts.provider) {
    conditions.push("provider = ?");
    params.push(opts.provider);
  }

  if (opts.until) {
    conditions.push("created_at <= ?");
    params.push(opts.until);
  }

  const bucketSeconds = Number(opts.bucketMinutes) * 60;
  if (!Number.isFinite(bucketSeconds) || bucketSeconds <= 0) {
    throw new Error("Invalid bucket size");
  }

  const groupFields =
    opts.aggregateBy === "connection"
      ? "bucket, provider, connection_id, window_key"
      : "bucket, provider, window_key";
  const selectKey =
    opts.aggregateBy === "connection" ? "provider || ':' || connection_id as provider" : "provider";

  try {
    const sql = `
      SELECT
        datetime((strftime('%s', created_at) / ${bucketSeconds}) * ${bucketSeconds}, 'unixepoch') as bucket,
        ${selectKey},
        AVG(remaining_percentage) as remainingPct,
        MAX(is_exhausted) as isExhausted,
        window_key
      FROM quota_snapshots
      WHERE ${conditions.join(" AND ")}
      GROUP BY ${groupFields}
      ORDER BY bucket ASC
    `;

    const rows = (await db.prepare(sql).all(...params)) as Array<{
      bucket: string;
      provider: string;
      remainingPct: number | null;
      isExhausted: number;
      windowKey: string;
    }>;

    return rows.map((r) => ({
      timestamp: r.bucket,
      provider: r.provider,
      remainingPct: r.remainingPct ?? 0,
      isExhausted: r.isExhausted === 1,
      windowKey: r.windowKey,
    }));
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      return [];
    }
    throw err;
  }
}

export async function cleanupOldSnapshots(retentionDays = 90): Promise<number> {
  const now = Date.now();
  const cleanupThresholdMs = 6 * 60 * 60 * 1000;

  if (now - lastCleanupAt < cleanupThresholdMs) {
    return 0;
  }

  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await db
      .prepare("DELETE FROM quota_snapshots WHERE created_at < ?")
      .run(cutoffDate);
    lastCleanupAt = now;
    // The sync read tier may still hold rows this delete just removed.
    latestSnapshotCache.clear();
    return result.changes;
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      return 0;
    }
    throw err;
  }
}
