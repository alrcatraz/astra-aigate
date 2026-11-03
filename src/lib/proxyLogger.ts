/**
 * Proxy Logger — Hybrid in-memory + persisted log store
 *
 * Keeps a fast in-memory ring buffer for real-time dashboard AND persists
 * entries so logs survive server restarts. Persistence goes through the async
 * DB adapter (SQLite in local mode, PostgreSQL in PG mode) so this module no
 * longer holds the synchronous handle — but every caller stays synchronous:
 * reads come from the ring buffer, writes are fire-and-forget.
 *
 * Pattern follows callLogs.js (T-15 decomposition).
 */
import { v4 as uuidv4 } from "uuid";
import { getAsyncDb, isCloud, isBuildPhase } from "./db/core";
import type { DatabaseAdapter } from "./db/adapters/types";

const shouldPersistToDisk = !isCloud && !isBuildPhase;

const MAX_IN_MEMORY_ENTRIES = 200;

/** Shared statement text so the shape is defined once, next to the columns. */
const INSERT_PROXY_LOG_SQL = `INSERT INTO proxy_logs (id, timestamp, status, proxy_type, proxy_host, proxy_port,
   level, level_id, provider, target_url, public_ip, latency_ms, error,
   connection_id, combo_id, account, tls_fingerprint)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

interface ProxyInfo {
  type: string;
  host: string;
  port: number | string;
}

interface ProxyLogEntry {
  id: string;
  timestamp: string;
  status: string;
  proxy: ProxyInfo | null;
  level: string;
  levelId: string | null;
  provider: string | null;
  targetUrl: string | null;
  clientIp: string | null;
  /** Outbound/egress IP the upstream actually saw (null until probed). The
   * historical clientIp is the INBOUND IP (x-forwarded-for); egressIp answers
   * "by which IP is this account leaving" — critical for rotating providers. */
  egressIp: string | null;
  latencyMs: number;
  error: string | null;
  connectionId: string | null;
  comboId: string | null;
  account: string | null;
  tlsFingerprint: boolean;
}

type ProxyLogInput = Partial<ProxyLogEntry> & {
  publicIp?: string | null;
};

interface ProxyLogFilters {
  status?: string;
  type?: string;
  provider?: string;
  level?: string;
  search?: string;
  limit?: number;
}

const proxyLogs: ProxyLogEntry[] = [];

// `public_ip` is the historical SQLite column name; API/UI expose the value as clientIp.

// ──────────────── Startup: hydrate from DB ────────────────

/**
 * Hydrate the in-memory ring buffer from persistence.
 *
 * Fire-and-forget: module import must not block on I/O, and the adapter is
 * async-only in both drivers. A failure here costs the dashboard its history
 * after a restart — nothing functional — so it is logged and swallowed.
 */
async function loadFromDb(): Promise<void> {
  if (!shouldPersistToDisk) return;
  try {
    const db = getAsyncDb() as unknown as DatabaseAdapter;
    const rows = (await db
      .prepare("SELECT * FROM proxy_logs ORDER BY timestamp DESC LIMIT ?")
      .all(MAX_IN_MEMORY_ENTRIES)) as any[];

    for (const row of rows) {
      proxyLogs.push({
        id: row.id,
        timestamp: row.timestamp,
        status: row.status || "success",
        proxy: row.proxy_host
          ? { type: row.proxy_type, host: row.proxy_host, port: row.proxy_port }
          : null,
        level: row.level || "direct",
        levelId: row.level_id || null,
        provider: row.provider || null,
        targetUrl: row.target_url || null,
        clientIp: row.public_ip || null,
        egressIp: row.egress_ip || null,
        latencyMs: row.latency_ms || 0,
        error: row.error || null,
        connectionId: row.connection_id || null,
        comboId: row.combo_id || null,
        account: row.account || null,
        tlsFingerprint: row.tls_fingerprint === 1,
      });
    }

    if (proxyLogs.length > 0) {
      console.log(`[proxyLogger] Loaded ${proxyLogs.length} proxy logs from the database`);
    }
  } catch (err: any) {
    console.warn("[proxyLogger] Failed to load from DB:", err?.message ?? err);
  }
}

void loadFromDb().catch((err: any) => {
  console.warn("[proxyLogger] Failed to load from DB:", err?.message ?? err);
});

// ──────────────── Persistence (fire-and-forget) ────────────────

/**
 * Write one entry through the async adapter. Never awaited by callers: proxy
 * logging sits on the request hot path and must stay synchronous from the
 * caller's point of view. Errors are reported and dropped, mirroring the old
 * `try/catch + warn` behaviour.
 */
async function persistProxyLog(log: ProxyLogEntry): Promise<void> {
  try {
    const db = getAsyncDb() as unknown as DatabaseAdapter;
    await db
      .prepare(INSERT_PROXY_LOG_SQL)
      .run(
        log.id,
        log.timestamp,
        log.status,
        log.proxy?.type || null,
        log.proxy?.host || null,
        log.proxy?.port ? Number(log.proxy.port) : null,
        log.level,
        log.levelId,
        log.provider,
        log.targetUrl,
        log.clientIp,
        log.latencyMs,
        log.error,
        log.connectionId,
        log.comboId,
        log.account,
        log.tlsFingerprint ? 1 : 0
      );
  } catch (err: any) {
    console.warn("[proxyLogger] Failed to persist:", err?.message ?? err);
  }
}

// ──────────────── Log a proxy event ────────────────

export function logProxyEvent(entry: ProxyLogInput) {
  const log: ProxyLogEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    status: entry.status || "success",
    proxy: entry.proxy || null,
    level: entry.level || "direct",
    levelId: entry.levelId || null,
    provider: entry.provider || null,
    targetUrl: entry.targetUrl || null,
    clientIp: entry.clientIp ?? entry.publicIp ?? null,
    egressIp: entry.egressIp ?? null,
    latencyMs: entry.latencyMs || 0,
    error: entry.error || null,
    connectionId: entry.connectionId || null,
    comboId: entry.comboId || null,
    account: entry.account || null,
    tlsFingerprint: entry.tlsFingerprint || false,
  };

  // Structured egress line so the operator can confirm, in the proxy logs, which
  // IP each account is entering (clientIp) and leaving (egressIp) by.
  if (log.proxy || log.egressIp) {
    console.log(
      `[ProxyEgress] ${log.provider || "-"}/${log.account || "-"} ` +
        `in=${log.clientIp || "?"} out=${log.egressIp || "?"} ` +
        `proxy=${log.level}${log.proxy ? `:${log.proxy.host}` : ""} status=${log.status}`
    );
  }

  // 1. In-memory ring buffer (newest first)
  proxyLogs.unshift(log);
  if (proxyLogs.length > MAX_IN_MEMORY_ENTRIES) {
    proxyLogs.length = MAX_IN_MEMORY_ENTRIES;
  }

  // 2. Persist through the async adapter, off the request path. Logging must
  //    never make a caller wait (or fail) on storage, so this is fire-and-forget
  //    and the helper swallows its own errors — no unhandled rejections.
  if (shouldPersistToDisk) {
    void persistProxyLog(log);
  }

  return log;
}

// ──────────────── Query ────────────────

/**
 * Get proxy logs with optional filters.
 * Reads from in-memory for speed (already hydrated from DB on startup).
 */
export function getProxyLogs(filters: ProxyLogFilters = {}) {
  let logs = [...proxyLogs];

  if (filters.status) {
    if (filters.status === "ok") {
      logs = logs.filter((l) => l.status === "success");
    } else {
      logs = logs.filter((l) => l.status === filters.status);
    }
  }

  if (filters.type) {
    logs = logs.filter((l) => l.proxy?.type === filters.type);
  }

  if (filters.provider) {
    logs = logs.filter((l) => l.provider === filters.provider);
  }

  if (filters.level) {
    logs = logs.filter((l) => l.level === filters.level);
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    logs = logs.filter(
      (l) =>
        (l.proxy?.host || "").toLowerCase().includes(q) ||
        (l.provider || "").toLowerCase().includes(q) ||
        (l.targetUrl || "").toLowerCase().includes(q) ||
        (l.clientIp || "").toLowerCase().includes(q) ||
        (l.level || "").toLowerCase().includes(q) ||
        (l.error || "").toLowerCase().includes(q) ||
        (l.account || "").toLowerCase().includes(q)
    );
  }

  const limit = filters.limit || 300;
  return logs.slice(0, limit);
}

// ──────────────── Clear ────────────────

async function clearProxyLogsInDb(): Promise<void> {
  try {
    const db = getAsyncDb() as unknown as DatabaseAdapter;
    await db.prepare("DELETE FROM proxy_logs").run();
  } catch (err: any) {
    console.warn("[proxyLogger] Failed to clear DB:", err?.message ?? err);
  }
}

export function clearProxyLogs() {
  proxyLogs.length = 0;

  if (shouldPersistToDisk) {
    void clearProxyLogsInDb();
  }
}
