/**
 * Semantic Cache — Phase 9.1
 *
 * Caches LLM responses (temperature=0) to reduce cost and latency.
 * Supports both streaming and non-streaming requests: streaming responses
 * are cached after assembly; cache hits always return JSON.
 * Two-tier: in-memory LRU (fast) + SQLite (persistent across restarts).
 *
 * Cache key = SHA-256(model + normalized messages + temperature + top_p)
 * Bypass: X-AI-Gate-No-Cache: true
 *
 * @module lib/semanticCache
 */

import crypto from "crypto";
import { LRUCache } from "./cacheLayer";
import { getAsyncDb } from "./db/core";
import type { DatabaseAdapter } from "./db/adapters/types";

type JsonRecord = Record<string, unknown>;

/**
 * Persistence tier access.
 *
 * The read path (`getCachedResponse`) is called synchronously from the chat
 * request chain and cannot await, and PostgreSQL has no synchronous driver. So
 * the memory LRU stays the synchronous tier and the `semantic_cache` table is a
 * read-through backing store that is warmed asynchronously through
 * `getAsyncDb()` (see `warmDbTier`). Writes/metrics/invalidations are
 * fire-and-forget — the historical contract for all of them was best-effort
 * ("DB not available — cache still in memory").
 */
function asyncDb(): DatabaseAdapter {
  return getAsyncDb() as unknown as DatabaseAdapter;
}

/**
 * How long a batch of rows loaded from `semantic_cache` is trusted before the
 * next memory miss re-warms it. Bounds the staleness of cross-process/restart
 * entries without querying the DB on every request.
 */
const DB_TIER_WARM_TTL_MS = 30_000;

/** TTL for the async-refreshed DB counters surfaced by `getCacheStats()`. */
const CACHE_STATS_TTL_MS = 10_000;

let metricsEnsuredForDb: unknown = null;
let metricsEnsurePromise: Promise<void> | null = null;

let dbTierWarmAt = 0;
let dbTierWarmForDb: unknown = null;
let dbTierWarmInFlight: Promise<void> | null = null;

interface DbStatsSnapshot {
  db: unknown;
  at: number;
  dbEntries: number;
  metrics: Record<string, number>;
}
let dbStatsSnapshot: DbStatsSnapshot | null = null;
let dbStatsInFlight: Promise<void> | null = null;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Create/seed `cache_metrics` once per adapter instance. `cache_metrics` is not
 * part of the migration set, so it is created at runtime exactly as before —
 * now through the async adapter (the dialect layer translates `datetime('now')`
 * and `INSERT OR IGNORE` for PostgreSQL).
 */
function ensureCacheMetricsTable(): Promise<void> {
  const db = asyncDb();
  if (metricsEnsuredForDb === db) return Promise.resolve();
  if (metricsEnsurePromise) return metricsEnsurePromise;
  metricsEnsurePromise = (async () => {
    try {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS cache_metrics (
            key TEXT PRIMARY KEY,
            value INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`
        )
        .run();
      await db
        .prepare(
          `INSERT OR IGNORE INTO cache_metrics (key, value) VALUES ('hits', 0), ('misses', 0), ('tokens_saved', 0)`
        )
        .run();
      metricsEnsuredForDb = db;
    } catch {
      // DB not available — metrics stay in-memory only and the next call retries.
    } finally {
      metricsEnsurePromise = null;
    }
  })();
  return metricsEnsurePromise;
}

/** Best-effort metric increment — never blocks or fails the request path. */
function incrementMetric(metric: "hits" | "misses" | "tokens_saved", amount = 1): void {
  void (async () => {
    try {
      const db = asyncDb();
      await ensureCacheMetricsTable();
      await db
        .prepare(
          `UPDATE cache_metrics SET value = value + ?, updated_at = datetime('now') WHERE key = ?`
        )
        .run(amount, metric);
    } catch {
      // DB not available — the in-memory counters already moved on.
    }
  })();
}

/**
 * Load the persisted tier into the memory LRU (read-through warm-up).
 *
 * One bounded query per TTL window — never one per lookup — and only entries
 * that are still unexpired and not already in memory are promoted. A failed
 * refresh leaves the previous memory tier in place.
 */
function warmDbTier(): void {
  const db = asyncDb();
  if (dbTierWarmForDb === db && Date.now() - dbTierWarmAt < DB_TIER_WARM_TTL_MS) return;
  if (dbTierWarmInFlight) return;
  dbTierWarmInFlight = (async () => {
    try {
      const cache = getMemoryCache();
      const limit = Math.max(1, cache.getStats().maxSize);
      const rows = (await db
        .prepare(
          `SELECT signature, response, tokens_saved, expires_at
             FROM semantic_cache
            WHERE expires_at > ?
            ORDER BY created_at DESC
            LIMIT ?`
        )
        .all(new Date().toISOString(), limit)) as unknown[];

      const promoted: string[] = [];
      for (const raw of rows) {
        const record = asRecord(raw);
        const signature = typeof record.signature === "string" ? record.signature : "";
        const payload = typeof record.response === "string" ? record.response : null;
        if (!signature || !payload || cache.has(signature)) continue;
        const expiresAt = typeof record.expires_at === "string" ? Date.parse(record.expires_at) : NaN;
        const remainingMs = Number.isFinite(expiresAt) ? expiresAt - Date.now() : DB_TIER_WARM_TTL_MS;
        if (!(remainingMs > 0)) continue;
        try {
          cache.set(
            signature,
            { response: JSON.parse(payload), tokensSaved: toNumber(record.tokens_saved, 0) },
            remainingMs
          );
          promoted.push(signature);
        } catch {
          // malformed payload — skip the row, keep warming the rest
        }
      }
      // hit_count stays meaningful without a write per cache hit: bump the rows
      // this warm promoted in ONE statement (previously a DB-tier hit bumped its
      // own row; a memory hit never wrote anything, and must keep not writing).
      if (promoted.length > 0) {
        const placeholders = promoted.map(() => "?").join(", ");
        await db
          .prepare(`UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE signature IN (${placeholders})`)
          .run(...promoted);
      }
      dbTierWarmAt = Date.now();
      dbTierWarmForDb = db;
    } catch {
      // DB unavailable: keep serving from memory and retry after the TTL.
      dbTierWarmAt = Date.now();
      dbTierWarmForDb = db;
    } finally {
      dbTierWarmInFlight = null;
    }
  })();
}

/**
 * DB-side counters for `getCacheStats()` (persisted entries + metric totals).
 * Refreshed on a short TTL so the sync dashboard read never touches the DB.
 */
function getDbStatsSnapshot(): DbStatsSnapshot | null {
  const db = asyncDb();
  const fresh =
    dbStatsSnapshot !== null &&
    dbStatsSnapshot.db === db &&
    Date.now() - dbStatsSnapshot.at < CACHE_STATS_TTL_MS;
  if (!fresh && !dbStatsInFlight) {
    dbStatsInFlight = (async () => {
      try {
        await ensureCacheMetricsTable();
        const countRow = await db
          .prepare(`SELECT COUNT(*) as count FROM semantic_cache WHERE expires_at > ?`)
          .get(new Date().toISOString());
        const metricRows = (await db
          .prepare(`SELECT key, value FROM cache_metrics`)
          .all()) as unknown[];
        const metrics: Record<string, number> = {};
        for (const raw of metricRows) {
          const record = asRecord(raw);
          if (typeof record.key === "string") metrics[record.key] = toNumber(record.value, 0);
        }
        dbStatsSnapshot = {
          db,
          at: Date.now(),
          dbEntries: toNumber(asRecord(countRow).count, 0),
          metrics,
        };
      } catch {
        // DB not available — keep the last known snapshot (or zeroes).
        dbStatsSnapshot = { db, at: Date.now(), dbEntries: 0, metrics: {} };
      } finally {
        dbStatsInFlight = null;
      }
    })();
  }
  return dbStatsSnapshot && dbStatsSnapshot.db === db ? dbStatsSnapshot : null;
}

function getHeaderValue(
  headers: { get?: (name: string) => string | null } | Record<string, unknown> | null | undefined,
  name: string
): string | null {
  if (!headers) return null;

  if (typeof headers.get === "function") {
    return headers.get(name);
  }

  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== needle) continue;
    return typeof value === "string" ? value : null;
  }

  return null;
}

// ─── Singleton ─────────────────

let memoryCache: LRUCache | null = null;

function getMemoryCache() {
  if (!memoryCache) {
    memoryCache = new LRUCache({
      maxSize: parseInt(process.env.SEMANTIC_CACHE_MAX_SIZE || "50", 10),
      maxBytes: parseInt(process.env.SEMANTIC_CACHE_MAX_BYTES || String(2 * 1024 * 1024), 10),
      defaultTTL: parseInt(process.env.SEMANTIC_CACHE_TTL_MS || "1800000", 10),
    });
    // Both are async fire-and-forget: in SQLite mode the CREATE/seed statement
    // still executes inline, in PG mode it lands on the event loop.
    void ensureCacheMetricsTable();
    warmDbTier();
  }
  return memoryCache;
}

// ─── Signature Generation ─────────────────

/**
 * Generate deterministic cache signature from request params.
 * @param {string} model
 * @param {Array} messages - Normalized messages array
 * @param {number} temperature
 * @param {number} topP
 * @param {string} [apiKeyId] - API key ID for per-key isolation (prevents cross-user cache hits)
 * @returns {string} hex signature
 */
export function generateSignature(
  model,
  conversation,
  temperature = 0,
  topP = 1,
  apiKeyId?: string
) {
  const payload = JSON.stringify({
    model,
    messages: normalizeConversation(conversation),
    temperature,
    top_p: topP,
  });
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  // Per-key cache isolation (#3740) namespaces the signature with the apiKeyId as a
  // PLAINTEXT prefix instead of folding it into the digest. The apiKeyId is an internal
  // identifier used purely to namespace a deterministic cache key — not a stored
  // credential — so it must never flow into a hash (a salted/slow password hash would
  // also break the determinism the cache relies on). Keeping it out of the digest
  // preserves isolation + determinism and avoids the false-positive
  // CodeQL js/insufficient-password-hash on a cache signature.
  return apiKeyId ? `${apiKeyId}.${digest}` : digest;
}

function stringifyForSignature(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Normalize conversation items for consistent hashing.
 * Supports both Chat Completions `messages[]` and Responses API `input[]`.
 */
function normalizeConversation(conversation: unknown) {
  if (typeof conversation === "string") {
    return [{ role: "user", content: conversation }];
  }
  if (!Array.isArray(conversation)) return [];

  return conversation.map((item: Record<string, unknown>) => ({
    role: typeof item?.role === "string" && item.role.trim().length > 0 ? item.role : "user",
    content: stringifyForSignature(item?.content),
  }));
}

// ─── Cache Operations ─────────────────

/**
 * Check if a cached response exists for the given signature.
 * Checks the memory tier first, then triggers a read-through warm of the
 * persisted `semantic_cache` tier (which promotes rows into memory for the next
 * lookup). Stays synchronous: the chat request chain cannot await.
 * @param {string} signature
 * @returns {object|null} Cached response or null
 */
export function getCachedResponse(signature) {
  // 1. Check memory cache
  const memResult = getMemoryCache().get(signature);
  if (memResult) {
    incrementMetric("hits");
    incrementMetric("tokens_saved", memResult.tokensSaved || 0);
    return memResult.response;
  }

  // 2. Persisted tier: warm it in the background (TTL-bounded, single query per
  // window) so the next identical request is a memory hit. A cold process
  // therefore misses once per entry instead of reading SQLite synchronously.
  warmDbTier();

  incrementMetric("misses");
  return null;
}

/**
 * Store a response in cache.
 * @param {string} signature
 * @param {string} model
 * @param {object} response - The API response to cache
 * @param {number} tokensSaved - Estimated tokens saved
 * @param {number} [ttlMs] - TTL in ms (default: 1 hour)
 */
export function setCachedResponse(signature, model, response, tokensSaved = 0, ttlMs = 3600000) {
  const ttl = parseInt(process.env.SEMANTIC_CACHE_TTL_MS || String(ttlMs), 10);

  // 1. Memory cache (synchronous — the request path must see it immediately)
  getMemoryCache().set(signature, { response, tokensSaved }, ttl);

  // 2. Persisted tier — fire-and-forget, the response is already cached in memory
  void (async () => {
    try {
      const db = asyncDb();
      const id = crypto.randomUUID();
      const promptHash = signature.slice(0, 16);
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + ttl).toISOString();

      await db
        .prepare(
          `INSERT OR REPLACE INTO semantic_cache (id, signature, model, prompt_hash, response, tokens_saved, hit_count, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          id,
          signature,
          model,
          promptHash,
          JSON.stringify(response),
          tokensSaved,
          now,
          expiresAt
        );
    } catch {
      // DB write failed — cache still in memory
    }
  })();
}

/**
 * Invalidate cache entries by model name.
 * Useful when a model is updated/changed and cached responses are stale.
 *
 * The memory tier is cleared synchronously; the persisted-tier delete is
 * fire-and-forget (the historical contract for these maintenance paths was
 * best-effort). The returned count is the number of in-memory entries dropped.
 * @param {string} model - Model name to invalidate (exact match)
 * @returns {number} Number of in-memory entries removed
 */
export function invalidateByModel(model: string): number {
  const removed = getMemoryCache().getStats().size;
  getMemoryCache().clear(); // Memory cache doesn't track model; full clear
  void (async () => {
    try {
      await asyncDb().prepare("DELETE FROM semantic_cache WHERE model = ?").run(model);
    } catch {
      // DB not available
    }
  })();
  return removed;
}

/**
 * Invalidate a single cache entry by its signature.
 * @param {string} signature - Cache signature to invalidate
 * @returns {boolean} Whether the entry was present in the memory tier
 */
export function invalidateBySignature(signature: string): boolean {
  const removed = getMemoryCache().delete(signature);
  void (async () => {
    try {
      await asyncDb().prepare("DELETE FROM semantic_cache WHERE signature = ?").run(signature);
    } catch {
      // DB not available
    }
  })();
  return removed;
}

/**
 * Invalidate entries older than a given age.
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {number} Number of in-memory entries removed
 */
export function invalidateStale(maxAgeMs: number): number {
  const removed = getMemoryCache().getStats().size;
  getMemoryCache().clear();
  void (async () => {
    try {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      await asyncDb().prepare("DELETE FROM semantic_cache WHERE created_at < ?").run(cutoff);
    } catch {
      // DB not available
    }
  })();
  return removed;
}

/**
 * Clear all cache entries.
 * @returns {number} Number of in-memory entries cleared
 */
export function clearCache(): number {
  const removed = getMemoryCache().getStats().size;
  getMemoryCache().clear();
  void (async () => {
    try {
      const db = asyncDb();
      await db.prepare("DELETE FROM semantic_cache").run();
      await db.prepare("UPDATE cache_metrics SET value = 0").run();
    } catch {
      // DB not available
    }
  })();
  return removed;
}

export function getCacheStats() {
  const memStats = getMemoryCache().getStats();
  // Persisted-tier counters come from the async-refreshed snapshot: the
  // dashboard read is synchronous, so it must not block on the adapter.
  const dbStats = getDbStatsSnapshot();
  const metrics = dbStats?.metrics ?? {};
  const dbSize = dbStats?.dbEntries ?? 0;

  const hits = toNumber(metrics.hits, 0);
  const misses = toNumber(metrics.misses, 0);
  const tokensSaved = toNumber(metrics.tokens_saved, 0);
  const total = hits + misses;

  return {
    memoryEntries: memStats.size,
    dbEntries: dbSize,
    hits,
    misses,
    hitRate: total > 0 ? ((hits / total) * 100).toFixed(1) : "0.0",
    tokensSaved,
  };
}

/**
 * Check if a cached response can be served for this request.
 * Works for both streaming and non-streaming requests (cache hit returns JSON).
 * Requires explicit numeric `temperature: 0` — omitted temperature is NOT cached
 * because the provider default may be non-deterministic (e.g. random/creative tasks).
 */
/**
 * True when the client asked to bypass the semantic cache for this request.
 * The no-cache bypass was renamed to X-AI-Gate-No-Cache (matching the X-AI-Gate-*
 * header rebrand); the original x-omniroute-no-cache is still accepted for
 * legacy clients — mirroring how executors/base.ts and the compression/memory
 * resolvers honour both names (see 6de470ce).
 */
function isNoCacheRequested(headers): boolean {
  return ["x-ai-gate-no-cache", "x-omniroute-no-cache"].some(
    (name) => (getHeaderValue(headers, name) || "").toLowerCase() === "true"
  );
}

export function isCacheableForRead(body, headers) {
  if (isNoCacheRequested(headers)) {
    return false;
  }
  if (typeof body.temperature !== "number" || body.temperature !== 0) return false;
  return true;
}

/**
 * Check if a response should be stored in cache after completion.
 * Works for both streaming and non-streaming responses.
 * Requires explicit `temperature: 0` — omitted temperature is NOT cacheable
 * because the provider default may be non-deterministic.
 */
export function isCacheableForWrite(body, headers) {
  if (isNoCacheRequested(headers)) {
    return false;
  }
  if (body.temperature !== 0) return false;
  return true;
}
