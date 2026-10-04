/**
 * db/core.js — Database infrastructure: schema, singleton, utils, migration.
 *
 * All domain modules import `getDbInstance` and helpers from here.
 */

import type {
  RawSyncDb,
  RawSyncStatement,
  RunResult,
  SqliteAdapter,
  DatabaseAdapter,
  DatabaseDriver,
  PreparedStatement,
} from "./adapters/types";
import {
  tryOpenSync,
  getSqlJsAdapter,
  preInitSqlJs,
  getSqlJsPreInitError,
  openDatabaseAsync,
} from "./adapters/driverFactory";
import { createPostgresAdapter, type PostgresAdapterConfig } from "./adapters/postgresAdapter";
import { setDbOptimizationSettingsPromise } from "./optimizationSettingsTracker";
import path from "path";
import os from "node:os";
import fs from "fs";
import { resolveWritableDataDir, getLegacyDotDataDir } from "../dataPaths";
import { runMigrations } from "./migrationRunner";
// Type-only import: erased at runtime, so `core.ts` -> `healthCheck.ts` is a
// compile-time-only edge and no longer half of a runtime import cycle.
// `runDbHealthCheck` itself is imported lazily (dynamic `import()`) at its two
// call sites below (the codebase-wide convention for this handler).
import type { DbHealthCheckResult } from "./healthCheck";
import { resetAllDbModuleState } from "./stateReset";
import { parseStoredPayload } from "../logPayloads";
import { DEFAULT_DATABASE_SETTINGS, type DatabaseSettings } from "@/types/databaseSettings";
import {
  applyDatabaseOptimizationSettingsForDb,
  applyStoredDatabaseOptimizationSettings,
  getAutoVacuumModeForDb,
  setAutoVacuumForDb,
  setCacheSizeForDb,
  setPageSizeForDb,
} from "./optimizationSettings";
import {
  buildArtifactRelativePath,
  writeCallArtifact,
  type CallLogArtifact,
} from "../usage/callLogArtifacts";
import { migrateLegacyEncryptedString } from "./encryption";
import { invalidateDbCache } from "./readCache";
import { SCHEMA_SQL, SCHEMA_BACKFILL_COLUMNS } from "./schemaSql.ts";
import { migrateFromJson } from "./jsonMigration.ts";
import { parseLegacyError, offloadLegacyCallLogDetails } from "./legacyCallLogOffload.ts";
import { rowToCamel } from "./caseMapping";
import { isAutomatedTestProcess } from "@/shared/utils/testProcess";
// Re-exported so existing call sites that pull these helpers off the core module keep working.
export { toSnakeCase, toCamelCase, objToSnake, rowToCamel, cleanNulls } from "./caseMapping";
import {
  ensureProviderConnectionsColumns,
  ensureUsageHistoryAccountIndex,
  ensureUsageHistoryColumns,
  ensureCallLogsColumns,
  hasTable,
  quoteIdentifier,
  getTableColumns,
} from "./schemaColumns";

type SqliteDatabase = SqliteAdapter;
type JsonRecord = Record<string, unknown>;
type CheckpointMode = "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE";
type DatabaseOptimizationSettings = DatabaseSettings["optimization"];
type PreservedTableSnapshot = {
  table: string;
  rowCount: number;
  maxRows: number;
  columns: string[];
  rows: JsonRecord[];
};
type SkippedTableSnapshot = {
  table: string;
  rowCount: number;
  maxRows: number;
  reason: string;
};
type PreservedCriticalDbState = {
  captureSucceeded: boolean;
  captureError: string | null;
  preservedTables: PreservedTableSnapshot[];
  skippedTables: SkippedTableSnapshot[];
};
type CriticalTableSpec = {
  table: string;
  maxRows?: number;
  readRows?: (db: SqliteDatabase) => JsonRecord[];
};

/**
 * Synchronous view of the underlying driver. better-sqlite3 / node:sqlite /
 * sql.js / bun:sqlite are all synchronous, so getDbInstance() and the
 * probe-failure capture path can read through `raw` without awaiting — they
 * must stay synchronous because getDbInstance() itself is. Postgres (async
 * driver) never takes these paths.
 */

// ──────────────── Environment Detection ────────────────
// Cloud detection must NOT fire for self-hosted Next.js (nodejs runtime): Next 16
// polyfills the Web Cache API (globalThis.caches) in the standalone server, which
// used to make `typeof globalThis.caches === "object"` come back true on every
// self-hosted deployment and silently short-circuit the provider-limits cache
// (get/set both bailed out, so balance/limit data froze at the last pre-Next-16
// write). Gate the probe to the edge runtime (true cloud: Vercel/Workers) and let
// explicit `OMNIROUTE_CLOUD=true` force cloud semantics anywhere else.
export const isCloud =
  process.env.OMNIROUTE_CLOUD === "true" ||
  (typeof globalThis.caches === "object" &&
    globalThis.caches !== null &&
    process.env.NEXT_RUNTIME === "edge");

export const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

// ──────────────── Paths ────────────────

export const DATA_DIR = resolveWritableDataDir({ isCloud });
const LEGACY_DATA_DIR = isCloud ? null : getLegacyDotDataDir();
export const SQLITE_FILE = isCloud ? null : path.join(DATA_DIR, "storage.sqlite");
const JSON_DB_FILE = isCloud ? null : path.join(DATA_DIR, "db.json");
export const DB_BACKUPS_DIR = isCloud ? null : path.join(DATA_DIR, "db_backups");
const DEFAULT_CRITICAL_TABLE_ROW_LIMIT = 10_000;
const SKIP_PRESERVE_NAMESPACES = new Set([
  "syncedAvailableModels",
  "providerLimitsCache",
  "lkgp",
  "gemini_thought_signatures",
]);
const CRITICAL_DB_TABLES: CriticalTableSpec[] = [
  {
    table: "key_value",
    maxRows: 10_000,
    readRows(db) {
      return (
        ((db.raw as RawSyncDb)
          .prepare("SELECT namespace, key, value FROM key_value")
          .all() as JsonRecord[]) ?? []
      ).filter(
        (row) => typeof row.namespace !== "string" || !SKIP_PRESERVE_NAMESPACES.has(row.namespace)
      );
    },
  },
  { table: "provider_connections", maxRows: 5_000 },
  { table: "provider_nodes", maxRows: 5_000 },
  { table: "combos", maxRows: 5_000 },
  { table: "api_keys", maxRows: 5_000 },
  { table: "proxy_registry", maxRows: 5_000 },
  { table: "proxy_assignments", maxRows: 10_000 },
  { table: "model_combo_mappings", maxRows: 5_000 },
  { table: "sync_tokens", maxRows: 5_000 },
  { table: "registered_keys", maxRows: 10_000 },
  { table: "provider_key_limits", maxRows: 10_000 },
  { table: "account_key_limits", maxRows: 10_000 },
  { table: "upstream_proxy_config", maxRows: 5_000 },
  { table: "webhooks", maxRows: 5_000 },
];

export function isNativeSqliteLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = getErrorCode(error);
  return (
    message.includes("Module did not self-register") ||
    message.includes("NODE_MODULE_VERSION") ||
    message.includes("ERR_DLOPEN_FAILED") ||
    // bun and similar runtimes that skip the postinstall script never download
    // the prebuilt *.node binary, so `bindings()` fails with this message
    // before any DLOPEN even happens (#2358).
    message.includes("Could not locate the bindings file") ||
    message.includes("Cannot find module 'better-sqlite3'") ||
    code === "ERR_DLOPEN_FAILED" ||
    code === "MODULE_NOT_FOUND"
  );
}

export function isSqliteDriverUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("Nenhum driver SQLite disponível") ||
    message.includes("Chame ensureDbInitialized() no startup") ||
    message.includes("sql.js WASM ainda não foi pré-inicializado")
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Closes a probe/throwaway connection obtained from `openSqliteDatabase()` —
 * but ONLY when it is safe to do so. better-sqlite3/node:sqlite hand back an
 * independent handle per open() call, so closing a probe never affects a
 * later "real" connection to the same file. sql.js has no such notion: its
 * fallback path (`getSqlJsAdapter()`) always returns the SAME module-global
 * cached singleton for a given filePath, so closing "the probe" closes the
 * ONLY connection that file will ever get until process restart — every
 * subsequent query (including the "real" connection opened right after)
 * throws sql.js's raw "Database closed" string (#7494). Skip the close for
 * sql.js and let the same live adapter flow through untouched.
 */
export function closeProbeIfSafe(adapter: SqliteDatabase | null | undefined): void {
  if (!adapter || adapter.driver === "sql.js") return;
  if (adapter.open) adapter.close();
}

function openSqliteDatabase(sqliteFile: string, options?: Record<string, unknown>): SqliteDatabase {
  const adapter = tryOpenSync(sqliteFile, options);
  if (adapter) return adapter;

  const sqlJs = getSqlJsAdapter(sqliteFile);
  if (sqlJs) return sqlJs;

  // sql.js pre-init was genuinely attempted (e.g. by the top-level eager
  // barrier below) and failed — surface the real cause instead of the
  // generic/misleading "not pre-initialized yet" message (#7288).
  const preInitError = getSqlJsPreInitError(sqliteFile);
  const syncDrivers = process.versions.bun
    ? "bun:sqlite (failed)"
    : "better-sqlite3 (failed), node:sqlite (unavailable)";
  if (preInitError) {
    throw new Error(
      `[DB] Nenhum driver SQLite disponível para '${sqliteFile}'. ` +
        `Drivers testados: ${syncDrivers}, ` +
        `sql.js (falhou: ${preInitError}).`
    );
  }

  throw new Error(
    `[DB] Nenhum driver SQLite disponível para '${sqliteFile}'. ` +
      "Chame ensureDbInitialized() no startup. " +
      `Drivers testados: ${syncDrivers}. ` +
      "sql.js WASM ainda não foi pré-inicializado."
  );
}

// Ensure data directory exists — with fallback for restricted home directories (#133)
if (!isCloud && !fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[DB] Cannot create data directory '${DATA_DIR}': ${msg}\n` +
        `[DB] Set the DATA_DIR environment variable to a writable path, e.g.:\n` +
        `[DB]   DATA_DIR=/path/to/writable/dir omniroute`
    );
  }
}

// ──────────────── Schema ────────────────

// ──────────────── Singleton DB Instance ────────────────
// Use globalThis to survive Next.js dev HMR module re-evaluation.
// Module-level `let` resets on every webpack recompile, causing connection leaks.

declare global {
  var __omnirouteDb: SqliteAdapter | undefined;
  // Cycle-breaker counter for the probe-failed/restore cascade. Survives
  // Next.js HMR re-evaluations so concurrent subsystems all see the same
  // count and we abort with a clear error instead of looping forever.
  var __omnirouteDbProbeRestoreCount: number | undefined;
  // Cycle-breaker counter for the OOM-during-probe path (#6835). Unlike the
  // generic corruption path above, an OOM probe failure never renames the
  // file away (intentional — the DB may be perfectly fine, just too large
  // for the current heap), so the restore-count cap above is structurally
  // unreachable here. Without an independent cap, every background poller
  // (BATCH, HealthCheck, ProviderLimitsSync, ModelSync) re-throws the same
  // OOM error forever with no terminal diagnostic.
  var __omnirouteDbOomFailureCount: number | undefined;
}

function getDb(): SqliteDatabase | null {
  return globalThis.__omnirouteDb ?? null;
}

function setDb(db: SqliteDatabase | null): void {
  if (db) {
    globalThis.__omnirouteDb = db;
  } else {
    delete globalThis.__omnirouteDb;
  }
}

function checkpointDb(db: SqliteDatabase, mode: CheckpointMode = "TRUNCATE"): boolean {
  if (isCloud || isBuildPhase || !SQLITE_FILE) return false;
  db.pragma(`wal_checkpoint(${mode})`);
  return true;
}

function summarizePreservedTables(tables: PreservedTableSnapshot[]): string {
  if (tables.length === 0) return "none";
  return tables.map((table) => `${table.table}(${table.rowCount})`).join(", ");
}

function summarizeSkippedTables(tables: SkippedTableSnapshot[]): string {
  if (tables.length === 0) return "none";
  return tables
    .map((table) => `${table.table}(${table.rowCount}/${table.maxRows}: ${table.reason})`)
    .join(", ");
}

function listProbeFailureBackups(sqliteFile: string): string[] {
  const directory = path.dirname(sqliteFile);
  const baseName = path.basename(sqliteFile);
  const prefix = `${baseName}.probe-failed-`;
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({
      path: path.join(directory, name),
      timestamp: Number(name.slice(prefix.length)),
    }))
    .sort((left, right) => {
      const leftTimestamp = Number.isFinite(left.timestamp) ? left.timestamp : 0;
      const rightTimestamp = Number.isFinite(right.timestamp) ? right.timestamp : 0;
      return rightTimestamp - leftTimestamp || right.path.localeCompare(left.path);
    })
    .map((backup) => backup.path);
}

/**
 * Synchronous table-existence check for raw SQLite handles. The async
 * `hasTable()` from schemaColumns returns a Promise — truthy even when the
 * table is absent — so every sync call site MUST use this instead (#8716
 * family). PG mode never reaches these paths (sync raw handles are SQLite-only).
 */
/**
 * Synchronous schema-backfill column sets for the SQLite path. Mirrors the
 * async ensure*Columns wrappers in schemaColumns.ts (which only await a
 * PRAGMA read; their ALTERs are sync). Keep in sync when adding columns —
 * the PG path still uses the async wrappers via initDatabaseDriver().
 */
function applySchemaBackfillsSync(db: SqliteDatabase): void {
  const rawBf = db.raw as unknown as RawSyncDb;
  for (const [table, adds] of SCHEMA_BACKFILL_COLUMNS) {
    const have = new Set(
      (rawBf.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>).map((c) =>
        String(c.name ?? "")
      )
    );
    for (const [column, type] of adds) {
      if (!have.has(column)) {
        rawBf.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }
  }
}

function tableExistsSyncRaw(db: SqliteDatabase, tableName: string): boolean {
  try {
    const row = (db.raw as RawSyncDb)
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as { name?: string } | undefined;
    return row?.name === tableName;
  } catch {
    return false;
  }
}

function captureCriticalDbState(sqliteFile: string): PreservedCriticalDbState {
  const snapshot: PreservedCriticalDbState = {
    captureSucceeded: false,
    captureError: null,
    preservedTables: [],
    skippedTables: [],
  };

  if (!fs.existsSync(sqliteFile)) {
    snapshot.captureSucceeded = true;
    return snapshot;
  }

  let probe: SqliteDatabase | null = null;
  try {
    probe = openSqliteDatabase(sqliteFile, { readonly: true });

    for (const tableSpec of CRITICAL_DB_TABLES) {
      // Sync raw check: `probe` is a synchronous readonly handle and this
      // whole function is sync — the async hasTable() would return a Promise,
      // which is always truthy and silently skipped every table (#8716 family).
      if (!tableExistsSyncRaw(probe, tableSpec.table)) continue;

      const maxRows = tableSpec.maxRows ?? DEFAULT_CRITICAL_TABLE_ROW_LIMIT;
      const rows = (tableSpec.readRows?.(probe) ??
        ((probe.raw as RawSyncDb)
          .prepare(`SELECT * FROM ${quoteIdentifier(tableSpec.table)}`)
          .all() as JsonRecord[])) as JsonRecord[];
      const rowCount = rows.length;

      if (rowCount === 0) continue;

      if (rowCount > maxRows) {
        snapshot.skippedTables.push({
          table: tableSpec.table,
          rowCount,
          maxRows,
          reason: "row_limit_exceeded",
        });
        continue;
      }

      snapshot.preservedTables.push({
        table: tableSpec.table,
        rowCount,
        maxRows,
        columns: getTableColumns(probe, tableSpec.table),
        rows,
      });
    }

    snapshot.captureSucceeded = true;
    return snapshot;
  } catch (error: unknown) {
    snapshot.captureError = error instanceof Error ? error.message : String(error);
    return snapshot;
  } finally {
    try {
      closeProbeIfSafe(probe);
    } catch {
      /* ignore */
    }
  }
}

function restoreCriticalDbState(
  db: SqliteDatabase,
  snapshot: PreservedCriticalDbState
): PreservedTableSnapshot[] {
  const restoredTables: PreservedTableSnapshot[] = [];

  const restore = db.transaction(() => {
    for (const table of snapshot.preservedTables) {
      if (table.rows.length === 0) continue;
      // Sync raw check — see captureCriticalDbState note; an un-awaited
      // Promise here made the guard always pass and masked missing tables.
      if (!tableExistsSyncRaw(db, table.table)) {
        throw new Error(`Current schema is missing preserved table "${table.table}"`);
      }

      const currentColumns = new Set(getTableColumns(db, table.table));
      const restoreColumns = table.columns.filter((column) => currentColumns.has(column));
      if (restoreColumns.length === 0) {
        throw new Error(`No compatible columns remain for preserved table "${table.table}"`);
      }

      const sql = `INSERT OR REPLACE INTO ${quoteIdentifier(table.table)} (${restoreColumns
        .map((column) => quoteIdentifier(column))
        .join(", ")}) VALUES (${restoreColumns.map(() => "?").join(", ")})`;
      const insert = db.prepare(sql);

      for (const row of table.rows) {
        insert.run(...restoreColumns.map((column) => row[column] ?? null));
      }

      restoredTables.push(table);
    }
  });

  restore();
  return restoredTables;
}

function cleanupRecreatedSqliteFiles(sqliteFile: string) {
  for (const filePath of [
    sqliteFile,
    `${sqliteFile}-wal`,
    `${sqliteFile}-shm`,
    `${sqliteFile}-journal`,
  ]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
}

function shouldRunStartupDbHealthCheck(): boolean {
  if (process.env.OMNIROUTE_FORCE_DB_HEALTHCHECK === "1") return true;
  return !isAutomatedTestProcess();
}

async function createManagedDbBackup(db: SqliteDatabase, reason: string): Promise<boolean> {
  const isTest = isAutomatedTestProcess();
  if (isTest) return false;

  try {
    const backupDir = DB_BACKUPS_DIR || path.join(DATA_DIR, "db_backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `db_${timestamp}_${reason}.sqlite`);
    const escapedBackupPath = backupPath.replace(/'/g, "''");

    await db.exec(`VACUUM INTO '${escapedBackupPath}'`);
    console.log(`[DB] Backup created (${reason}): ${backupPath}`);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[DB] Failed to create ${reason} backup:`, message);
    return false;
  }
}

function createHealthCheckBackup(db: SqliteDatabase): Promise<boolean> {
  return createManagedDbBackup(db, "health-check-repair");
}

async function autoMigrateLegacyEncryptedConnections(db: SqliteDatabase): Promise<number> {
  const rows = (await db.prepare("SELECT * FROM provider_connections").all()) as JsonRecord[];
  const updateStmt = db.prepare(
    "UPDATE provider_connections SET api_key = @apiKey, id_token = @idToken, access_token = @accessToken, refresh_token = @refreshToken, updated_at = @updatedAt WHERE id = @id"
  );
  const encryptedFields = ["apiKey", "idToken", "accessToken", "refreshToken"] as const;
  let migratedCount = 0;
  let backupCreated = false;

  for (const row of rows) {
    const camelRow = rowToCamel(row);
    if (!camelRow) continue;

    let updatedRow = false;
    for (const field of encryptedFields) {
      if (typeof camelRow[field] !== "string") continue;

      const { updated, value } = migrateLegacyEncryptedString(camelRow[field]);
      if (updated) {
        camelRow[field] = value;
        updatedRow = true;
      }
    }

    if (!updatedRow) continue;
    if (!backupCreated) {
      await createManagedDbBackup(db, "legacy-encryption-migration");
      backupCreated = true;
    }

    await updateStmt.run({
      id: camelRow.id,
      apiKey: camelRow.apiKey ?? null,
      idToken: camelRow.idToken ?? null,
      accessToken: camelRow.accessToken ?? null,
      refreshToken: camelRow.refreshToken ?? null,
      updatedAt: new Date().toISOString(),
    });
    migratedCount++;
  }

  if (migratedCount > 0) {
    invalidateDbCache("connections");
    console.log(`[DB] Auto-migrated ${migratedCount} connection(s) to new static-salt encryption.`);
  }

  return migratedCount;
}

let dbHealthCheckTimer: NodeJS.Timeout | null = null;

function getDbHealthCheckIntervalMs(): number {
  const rawValue = process.env.OMNIROUTE_DB_HEALTHCHECK_INTERVAL_MS;
  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 6 * 60 * 60 * 1000;
}

function clearDbHealthCheckScheduler() {
  if (dbHealthCheckTimer) {
    clearInterval(dbHealthCheckTimer);
    dbHealthCheckTimer = null;
  }
}

function startDbHealthCheckScheduler(db: SqliteDatabase) {
  clearDbHealthCheckScheduler();
  if (isCloud || isBuildPhase || isAutomatedTestProcess()) return;

  const intervalMs = getDbHealthCheckIntervalMs();
  if (intervalMs <= 0) return;

  dbHealthCheckTimer = setInterval(async () => {
    try {
      if (!db.open) return;
      const { runDbHealthCheck } = await import("./healthCheck");
      await runDbHealthCheck(db, {
        autoRepair: true,
        skipIntegrityCheck: process.env.OMNIROUTE_SKIP_DB_HEALTHCHECK === "1",
        expectedSchemaVersion: "1",
        createBackupBeforeRepair: () => createHealthCheckBackup(db),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[DB] Periodic health-check failed:", message);
    }
  }, intervalMs);
  dbHealthCheckTimer.unref?.();
}

export async function runManagedDbHealthCheck(options?: {
  autoRepair?: boolean;
}): Promise<DbHealthCheckResult> {
  const db = getDbInstance();
  const { runDbHealthCheck } = await import("./healthCheck");
  return await runDbHealthCheck(db, {
    autoRepair: options?.autoRepair === true,
    expectedSchemaVersion: "1",
    createBackupBeforeRepair: () => createHealthCheckBackup(db),
  });
}

export type DbDriver = "sqlite" | "postgres";

/**
 * Which database driver this process should use. Controlled by the
 * DB_DRIVER environment variable — "sqlite" (default) or "postgres".
 * The SQLite driver stays the default: PG is an opt-in deployment target.
 */
export function getDbDriver(): DbDriver {
  const driver = process.env.DB_DRIVER?.trim().toLowerCase();
  return driver === "postgres" ? "postgres" : "sqlite";
}

/**
 * PG-aware table existence check (single source of truth) now lives in the
 * dependency-free leaf `./tableExists` (adapter + driver injected by the
 * caller), so `core.ts` <-> `healthCheck.ts` no longer form an import cycle.
 * Re-exported here because existing call sites import it from `core`.
 */
export { tableExists } from "./tableExists";

/**
 * Wrap the synchronous SQLite handle in the async DatabaseAdapter interface so
 * async call sites (usage, quota, settings) work identically in both driver
 * modes. Statements resolve immediately; transaction callbacks must stay
 * synchronous in this mode (SQLite holds the JS thread).
 */
export function sqliteAsyncAdapter(sync: SqliteDatabase): DatabaseAdapter {
  const wrapStmt = (stmt: RawSyncStatement) => ({
    run: (...params: unknown[]) => Promise.resolve(stmt.run(...params) as RunResult),
    get: (...params: unknown[]) => Promise.resolve(stmt.get(...params)),
    all: (...params: unknown[]) => Promise.resolve(stmt.all(...params) as unknown[]),
  });
  return {
    driver: "better-sqlite3" as DatabaseDriver,
    open: true,
    name: "sqlite (async wrapper)",
    prepare: (sql: string) => wrapStmt(sync.prepare(sql) as unknown as RawSyncStatement),
    exec: (sql: string) => Promise.resolve(sync.exec(sql)),
    pragma: (pragmaStr: string, options?: { simple?: boolean }) =>
      Promise.resolve(sync.pragma(pragmaStr, options)),
    transaction: <T>(fn: (...args: unknown[]) => Promise<T> | T) => {
      // better-sqlite3's sync.transaction() rejects an async callback
      // ("Transaction function cannot return a promise"), but call sites like
      // settings.updatePricing pass an async fn (they `await insert.run(...)`
      // inside). In SQLite mode the underlying statement wrappers resolve
      // synchronously anyway, so drive BEGIN/COMMIT/ROLLBACK manually and
      // `await` the callback — this keeps async transaction bodies working
      // identically in both drivers.
      //
      // Nested transactions must become SAVEPOINTs (migrationRunner.supportsFts5
      // opens a transaction while runMigrations already holds one). Detect the
      // outer transaction via better-sqlite3's own `inTransaction` flag.
      const t = async (...args: unknown[]): Promise<T> => {
        const raw = sync as unknown as { inTransaction: boolean; exec: (sql: string) => unknown };
        if (raw.inTransaction) {
          // Outer transaction already open → SAVEPOINT (matches PG adapter).
          const sp = `sp_${Math.random().toString(36).slice(2, 10)}`;
          raw.exec(`SAVEPOINT ${sp}`);
          try {
            return (await fn(...args)) as T;
          } catch (err) {
            raw.exec(`ROLLBACK TO ${sp}`);
            raw.exec(`RELEASE ${sp}`);
            throw err;
          }
        }
        raw.exec("BEGIN");
        try {
          const result = (await fn(...args)) as T;
          raw.exec("COMMIT");
          return result;
        } catch (err) {
          try {
            raw.exec("ROLLBACK");
          } catch {
            /* connection may be gone — nothing more to do */
          }
          throw err;
        }
      };
      return t;
    },
    immediate: (fn: () => Promise<void> | void) =>
      Promise.resolve(sync.immediate(fn as () => void)),
    backup: (destination: string) => Promise.resolve(sync.backup(destination)),
    checkpoint: (mode?: string) => Promise.resolve(sync.checkpoint(mode as never)),
    close: () => Promise.resolve(sync.close()),
    raw: sync,
  };
}

let asyncDb: DatabaseAdapter | null = null;

/**
 * Tracks the fire-and-forget versioned migration run started by openSqliteDatabase
 * (getDb). Exposed via awaitDbMigrations() so callers (tests that reset the DB,
 * restore flows) can wait for the schema to be fully materialised instead of
 * racing ahead of the async runner. Reset to null on close so a re-opened DB
 * starts a fresh migration and the await target tracks the current instance.
 */
let migrationsPromise: Promise<void> | null = null;

/** Deferred startup passes (health check, legacy re-encrypt) — tracked so a
 * drained close/reset can wait for them instead of closing under their feet. */
const deferredStartupWork = new Set<Promise<void>>();

function trackDeferredStartupWork(promise: Promise<unknown>): void {
  const settled = promise.then(() => undefined).catch(() => undefined);
  deferredStartupWork.add(settled);
  void settled.finally(() => deferredStartupWork.delete(settled));
}

async function flushDeferredStartupWork(): Promise<void> {
  while (deferredStartupWork.size > 0) {
    await Promise.all([...deferredStartupWork]);
  }
}

/**
 * Schema backfill barrier (ensure*Columns + account index). Async wrappers
 * over the sync connection — callers that must see the final schema before
 * their first statement (boot hook, call-log writers in tests) await this via
 * `awaitDbColumnBackfills()`. Reassigned on every DB open.
 */
let columnBackfillsPromise: Promise<void> = Promise.resolve();

/**
 * Post-migration startup maintenance (legacy call-log offload). Kicked off by
 * `awaitDbStartupTasks()` — never inline during open, because its final
 * wal_checkpoint(TRUNCATE)+VACUUM would race the migration transaction on the
 * same connection. Tracked so resetDbInstance() can await it before closing.
 */
let startupTasksPromise: Promise<void> | null = null;

/**
 * The async database handle (PostgreSQL in postgres mode, SQLite-backed in
 * sqlite mode). Async call paths (usage, quota, settings) should prefer this
 * over the synchronous getDbInstance() when running against PG.
 */
export function getAsyncDb(): DatabaseAdapter {
  if (!asyncDb) {
    if (getDbDriver() === "postgres") {
      // PG mode: lazily initialise the real Postgres adapter if the boot hook
      // (initDatabaseDriver/initAsyncDb) hasn't run yet. NEVER fall back to a
      // SQLite scratch wrapper here — that silently locks the whole process
      // into the empty in-memory SQLite database (asyncDb is non-null after
      // this, so the boot hook can never replace it).
      asyncDb = createPostgresAdapter(resolvePostgresConfig());
    } else {
      // SQLite mode: lazily initialise the async wrapper around the sync
      // handle so call sites can uniformly use getAsyncDb() in both modes.
      asyncDb = sqliteAsyncAdapter(getDbInstance());
    }
  }
  return asyncDb;
}

/** Parse DATABASE_URL (postgres://user:pass@host:port/db) into PG config. */
export function parseDatabaseUrl(url: string): PostgresAdapterConfig {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "") || "postgres";
    return {
      host: u.hostname || "127.0.0.1",
      port: u.port ? Number(u.port) : 5432,
      database: db,
      user: decodeURIComponent(u.username || "postgres"),
      password: decodeURIComponent(u.password || ""),
      ssl: u.searchParams.get("ssl") === "true" ? { rejectUnauthorized: false } : undefined,
    };
  } catch (err) {
    throw new Error(`[DB] Invalid DATABASE_URL: ${(err as Error).message}`);
  }
}

/** Resolve the PG config from DATABASE_URL, falling back to PG* env vars. */
export function resolvePostgresConfig(): PostgresAdapterConfig {
  const url = process.env.DATABASE_URL;
  if (url) return parseDatabaseUrl(url);
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "postgres",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
  };
}

/**
 * Driver-aware database bootstrap, called once at server startup.
 * - sqlite (default): no-op — the synchronous getDbInstance() path is used.
 * - postgres: connects, and when the PG database is empty bootstraps it from
 *   the local SQLite file (one-shot migration). Idempotent: re-runs skip the
 *   migration when tables already exist.
 */
export async function initDatabaseDriver(): Promise<void> {
  if (getDbDriver() !== "postgres") return;
  const pg = await initAsyncDb();
  // Warm the PK cache so INSERT OR REPLACE upserts can emit a valid PG
  // `ON CONFLICT (<pk>) DO UPDATE` arbiter (required by PG syntax).
  await (pg as unknown as { __warmPrimaryKeys?: () => Promise<void> }).__warmPrimaryKeys?.();
  const probe = await pg
    .prepare(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'key_value' LIMIT 1"
    )
    .get();
  if (probe) {
    console.log("[DB] Postgres driver — existing schema found, skipping bootstrap migration");
    return;
  }
  if (SQLITE_FILE && fs.existsSync(SQLITE_FILE)) {
    const { migrateSqliteToPostgres } = await import("./migrateToPostgres");
    const report = await migrateSqliteToPostgres({
      sqlitePath: SQLITE_FILE,
      pgConfig: resolvePostgresConfig(),
    });
    const rows = Object.values(report.rowsMigrated).reduce((a, b) => a + b, 0);
    console.log(
      `[DB] Postgres bootstrapped from ${SQLITE_FILE}: ${report.tablesCreated.length} tables, ${rows} rows, ` +
        `${report.warnings.length} warnings`
    );
  } else {
    // ★ Fresh install: 空 PG 库 + 无 storage.sqlite。与 sqlite 全新部署等价的
    // final schema 用「临时 sqlite 文件 + SCHEMA_SQL + full migrations」生成，
    // 再迁到 PG —— 使 PG 全新安装无需预先存在任何 SQLite/Schema 即可自举。
    const freshStarted = Date.now();
    console.log("[DB] Postgres empty schema detected — bootstrapping fresh (no SQLITE_FILE)");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aigate-fresh-"));
    const tmpSqlite = path.join(tmpDir, "bootstrap.sqlite");
    try {
      const tmpDb = openSqliteDatabase(tmpSqlite);
      tmpDb.pragma("busy_timeout = 2000");
      tmpDb.pragma("synchronous = NORMAL");
      tmpDb.exec(SCHEMA_SQL);
      await ensureProviderConnectionsColumns(tmpDb);
      await ensureUsageHistoryColumns(tmpDb);
      await ensureCallLogsColumns(tmpDb);
      tmpDb.exec(`
        CREATE TABLE IF NOT EXISTS _omniroute_migrations (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO _omniroute_migrations (version, name)
        VALUES ('001', 'initial_schema');
      `);
      await runMigrations(sqliteAsyncAdapter(tmpDb), { isNewDb: true });
      tmpDb.close();
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw new Error(
        `[DB] Fresh PG bootstrap: failed to seed temporary SQLite schema: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const { migrateSqliteToPostgres } = await import("./migrateToPostgres");
    const report = await migrateSqliteToPostgres({
      sqlitePath: tmpSqlite,
      pgConfig: resolvePostgresConfig(),
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const rows = Object.values(report.rowsMigrated).reduce((a, b) => a + b, 0);
    console.log(
      `[DB] Postgres bootstrapped fresh (${Math.round((Date.now() - freshStarted) / 1000)}s): ` +
        `${report.tablesCreated.length} tables, ${rows} rows, ${report.warnings.length} warnings`
    );
    if (report.warnings.length > 0) {
      console.log(`[DB] bootstrap warnings:\n${report.warnings.map((w) => `  - ${w}`).join("\n")}`);
    }
  }
}

/**
 * Initialise the async database handle for the configured driver.
 * - sqlite (default): wraps the shared synchronous SQLite handle in the async
 *   adapter interface (see sqliteAsyncAdapter), so async call sites work
 *   unchanged in both modes.
 * - postgres: connects via DATABASE_URL / PG* env vars. The caller is
 *   responsible for running schema migration before serving traffic.
 */
export async function initAsyncDb(): Promise<DatabaseAdapter> {
  if (asyncDb) return asyncDb;
  if (getDbDriver() === "postgres") {
    const config = resolvePostgresConfig();
    console.log(
      `[DB] Postgres driver — connecting to ${config.host}:${config.port}/${config.database}`
    );
    asyncDb = createPostgresAdapter(config);
    return asyncDb;
  }
  // SQLite mode: reuse the synchronous singleton through a tiny async wrapper.
  const sync = getDbInstance();
  asyncDb = sqliteAsyncAdapter(sync);
  return asyncDb;
}

/**
 * Sync call sites expect the raw synchronous driver handle (better-sqlite3 /
 * node:sqlite / bun:sqlite all execute synchronously): `prepare().all()` must
 * return an array, not a Promise. The SqliteAdapter wraps the raw handle in an
 * async interface, so sync modules must unwrap it. Adapters without a raw
 * handle (e.g. sql.js) fall back to the adapter itself.
 */
function unwrapRawSync(db: SqliteDatabase): SqliteDatabase {
  const raw = (db as { raw?: unknown }).raw;
  if (raw && typeof (raw as { prepare?: unknown }).prepare === "function") {
    // Legacy call sites still reach for `(getDbInstance() as SqliteAdapter).raw`
    // to get a synchronous handle. On the unwrapped raw handle, `.raw` is
    // itself — keep that accessor working so those 17+ call sites don't crash
    // with "reading 'raw' of undefined" after the unwrap.
    if ((raw as { raw?: unknown }).raw === undefined) {
      Object.defineProperty(raw, "raw", {
        get: () => raw,
        configurable: true,
      });
    }
    return raw as unknown as SqliteDatabase;
  }
  return db;
}

export function getDbInstance(): SqliteDatabase {
  if (getDbDriver() === "postgres") {
    // Transition: PG mode routes async call sites through initAsyncDb(); a few
    // not-yet-migrated synchronous modules still land here. Keep them working
    // against an in-memory SQLite scratch DB (never the on-disk file — that
    // stays owned by the SQLite deployment) and make the leak visible.
    console.warn(
      "[DB] WARNING: synchronous SQLite path used in PG mode (module not yet async-migrated). " +
        "Data written here is scratch-only and will NOT persist."
    );
    const existing = getDb();
    if (existing) return unwrapRawSync(existing);
    const memoryDb = openSqliteDatabase(":memory:");
    // Build the schema on the RAW synchronous handle so sync modules degrade
    // gracefully: reads return arrays (not Promises) and empty results instead
    // of throwing "no such table"; writes stay scratch-only.
    (memoryDb.raw as unknown as RawSyncDb).exec(SCHEMA_SQL);
    setDb(memoryDb);
    return unwrapRawSync(memoryDb);
  }

  const existing = getDb();
  if (existing) return unwrapRawSync(existing);

  if (isCloud || isBuildPhase) {
    if (isBuildPhase) {
      console.log("[DB] Build phase detected — using in-memory SQLite (read-only)");
    }
    const memoryDb = openSqliteDatabase(":memory:");
    memoryDb.pragma("journal_mode = WAL");
    memoryDb.exec(SCHEMA_SQL);
    // Sync backfill (same as the on-disk path): the async wrappers would be
    // fire-and-forget Promises here and never complete before first use.
    applySchemaBackfillsSync(memoryDb);
    ensureUsageHistoryAccountIndex(memoryDb);
    setDb(memoryDb);
    return unwrapRawSync(memoryDb);
  }

  const sqliteFile = SQLITE_FILE;
  if (!sqliteFile) {
    throw new Error("SQLITE_FILE is unavailable for local mode");
  }
  const jsonDbFile = JSON_DB_FILE;
  const probeFailureBackups = listProbeFailureBackups(sqliteFile);
  if (!fs.existsSync(sqliteFile) && probeFailureBackups.length > 0) {
    // Cycle-breaker: a previous probe failure renamed the DB to
    // `storage.sqlite.probe-failed-<ts>` and the next caller auto-restored it.
    // When the same DB continues to fail the probe (typically an OOM on a
    // large sql.js WASM load), the rename/restore cascade loops forever
    // because every subsystem (BATCH, HealthCheck, ProviderLimitsSync, ...)
    // hits the same code path during boot. Track restoration attempts on
    // globalThis; abort with a clear recovery message after 3 attempts so
    // the user gets a real error instead of a hung "Starting server...".
    if (
      (globalThis.__omnirouteDbProbeRestoreCount =
        (globalThis.__omnirouteDbProbeRestoreCount || 0) + 1) > 3
    ) {
      throw new Error(
        `[DB] Aborting startup: probe-failed/restore loop detected after 3 attempts. ` +
          `The preserved database at ${path.dirname(sqliteFile)} is unloadable under this runtime. ` +
          `Remove the probe-failed backups (storage.sqlite.probe-failed-*) from ${path.dirname(
            sqliteFile
          )} and restart, or restore the database from a known-good backup.`
      );
    }
    const latestBackup = probeFailureBackups[0];
    try {
      fs.renameSync(latestBackup, sqliteFile);
      console.log(
        `[DB] Auto-restored preserved database from previous probe failure: ${path.basename(latestBackup)}`
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[DB] Manual recovery required before startup. ` +
          `Failed to auto-restore preserved database ${latestBackup}: ${msg}. ` +
          `Restore the preserved file or another backup to ${sqliteFile} before restarting.`
      );
    }
  }

  let preservedCriticalState: PreservedCriticalDbState = {
    captureSucceeded: true,
    captureError: null,
    preservedTables: [],
    skippedTables: [],
  };
  let failedProbePath: string | null = null;
  let failedProbeMessage: string | null = null;

  // Track whether the DB file is brand new (fresh DATA_DIR / Docker volume).
  // This is needed so the migration runner skips the mass-migration safety abort
  // that would otherwise trigger because heuristic seeding marks some migrations
  // as applied, making the fresh DB look like a wiped existing DB (#1328).
  const isNewDb = !fs.existsSync(sqliteFile);

  // Detect and handle old schema format — preserve data when possible (#146)
  // Uses a single probe connection that becomes the real connection when possible.
  if (fs.existsSync(sqliteFile)) {
    try {
      const probe = openSqliteDatabase(sqliteFile, { readonly: true });
      const hasOldSchema = (probe.raw as RawSyncDb)
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get();

      if (hasOldSchema) {
        let hasData = false;
        try {
          const count = (probe.raw as RawSyncDb)
            .prepare("SELECT COUNT(*) as c FROM provider_connections")
            .get() as { c: number } | undefined;
          hasData = Boolean(count && count.c > 0);
        } catch {
          // Table might not exist at all — truly incompatible
        }
        closeProbeIfSafe(probe);

        if (hasData) {
          console.log(
            `[DB] Old schema_migrations table found but data exists — preserving data (#146)`
          );
          const fixDb = openSqliteDatabase(sqliteFile);
          try {
            fixDb.exec("DROP TABLE IF EXISTS schema_migrations");
            fixDb.pragma("wal_checkpoint(TRUNCATE)");
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn("[DB] Could not clean up old schema table:", message);
          } finally {
            closeProbeIfSafe(fixDb);
          }
        } else {
          const oldPath = sqliteFile + ".old-schema";
          console.log(
            `[DB] Old incompatible schema detected (empty) — renaming to ${path.basename(oldPath)}`
          );
          fs.renameSync(sqliteFile, oldPath);
          for (const ext of ["-wal", "-shm"]) {
            try {
              if (fs.existsSync(sqliteFile + ext)) fs.unlinkSync(sqliteFile + ext);
            } catch {
              /* ok */
            }
          }
        }
      } else {
        closeProbeIfSafe(probe);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[DB] Could not probe existing DB:", message);

      // If the error is a Node module/ABI failure, throw it immediately to avoid renaming the database
      if (
        isNativeSqliteLoadError(e) ||
        isSqliteDriverUnavailableError(e) ||
        message.includes("could not be found")
      ) {
        throw e;
      }
      // OOM during probe = the DB is too large to load under the current
      // V8 heap (sql.js loads the whole file into WASM memory). Throwing
      // immediately gives the user a clear "increase --max-old-space-size"
      // signal instead of silently renaming a perfectly good DB.
      if (
        /out of memory|allocation failure|Array buffer allocation failed|allocation failed/i.test(
          message
        )
      ) {
        // Cycle-breaker (#6835): the OOM path never renames the file away,
        // so it never trips the generic probe-failed/restore cap above. Cap
        // it independently after 3 consecutive OOM failures (same threshold
        // as the generic path) so repeated polling doesn't hang forever with
        // no actionable terminal diagnostic.
        if (
          (globalThis.__omnirouteDbOomFailureCount =
            (globalThis.__omnirouteDbOomFailureCount || 0) + 1) > 3
        ) {
          throw new Error(
            `[DB] Aborting startup: persistent out-of-memory probing ${sqliteFile} after 3 attempts. ` +
              `Increase the V8 heap with NODE_OPTIONS=--max-old-space-size=4096 (or higher) — the ` +
              `current heap is insufficient for this database — and restart, or shrink/restore the ` +
              `database from a backup. Original error: ${message}`
          );
        }
        throw new Error(
          `[DB] Out of memory while probing ${sqliteFile}. ` +
            `The bundled sql.js driver loads the entire file into WASM memory; ` +
            `increase the V8 heap with NODE_OPTIONS=--max-old-space-size=4096 (or higher) ` +
            `and restart, or restore the database from a backup. ` +
            `Original error: ${message}`
        );
      }
      preservedCriticalState = captureCriticalDbState(sqliteFile);

      // SAFETY: Never delete the database — rename to backup so data can be recovered.
      // The old code would silently destroy all user data on any probe failure.
      const failedPath = sqliteFile + `.probe-failed-${Date.now()}`;
      try {
        fs.renameSync(sqliteFile, failedPath);
        console.warn(`[DB] Renamed corrupt DB to ${path.basename(failedPath)}`);
        failedProbePath = failedPath;
        failedProbeMessage = message;
      } catch {
        /* ok */
      }
    }
  }

  if (failedProbePath) {
    const hasUnsafeSkippedTables = preservedCriticalState.skippedTables.length > 0;
    const missingSnapshot = !preservedCriticalState.captureSucceeded;
    if (hasUnsafeSkippedTables || missingSnapshot) {
      const details = missingSnapshot
        ? `snapshot_failed=${preservedCriticalState.captureError || "unknown"}`
        : `skipped_tables=${summarizeSkippedTables(preservedCriticalState.skippedTables)}`;
      throw new Error(
        `[DB] Manual recovery required after probe failure. ` +
          `Preserved database: ${failedProbePath}. ` +
          `Automatic recovery was aborted because ${details}. ` +
          `Original probe error: ${failedProbeMessage || "unknown"}.`
      );
    }
  }

  const db = openSqliteDatabase(sqliteFile);
  db.pragma("journal_mode = WAL");
  // better-sqlite3 is synchronous, so a contended write parks the Node event loop for up to
  // busy_timeout ms (a 0-CPU freeze that stacks under load → /health stops responding). The
  // hot-path writers here (usage_history, call_logs) are best-effort and the WinUI host opens
  // the same DB, so cap the block at 2s instead of 5s: normal writes complete in <1ms, and a
  // contended op can no longer freeze the loop past the host watchdog's 6s liveness probe.
  db.pragma("busy_timeout = 2000");
  db.pragma("synchronous = NORMAL");
  db.pragma(`cache_size = -${DEFAULT_DATABASE_SETTINGS.optimization.cacheSize}`);
  db.pragma("temp_store = MEMORY");
  db.exec(SCHEMA_SQL);
  // Column backfills run SYNCHRONOUSLY on the raw handle before anything else
  // touches this connection. The async wrappers in schemaColumns only await a
  // PRAGMA read; their ALTERs are sync — but awaiting the wrapper's Promise
  // defers the whole function body to a microtask, so early writers raced a
  // half-backfilled call_logs ("no column named reasoning_source") and the
  // migration runner interleaved statements against later closes. Sync raw
  // exec removes the race entirely (SQLite mode; PG never reaches this path).
  applySchemaBackfillsSync(db);

  // ── Versioned Migrations ──
  // Auto-seed 001 as applied (the inline SCHEMA_SQL already created these tables)
  // then run any new migrations (002+)
  db.exec(`
    CREATE TABLE IF NOT EXISTS _omniroute_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO _omniroute_migrations (version, name)
    VALUES ('001', 'initial_schema');
  `);

  // Kick the versioned migration run off AFTER the current synchronous call
  // chain finishes. runMigrations is async (its adapter awaits every step), so
  // starting it inline interleaved its statements with the next sync caller's
  // work on this same connection — a test that closes/resets the DB right after
  // getDbInstance() then killed the runner mid-flight ("database connection is
  // not open", migration 116 never applied). setTimeout(0) drains the sync
  // stack first; consumers join via awaitDbMigrations().
  migrationsPromise = new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  })
    .then(() => runMigrations(sqliteAsyncAdapter(db), { isNewDb }))
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error("[DB] Migration runner failed:", error);
    });
  // Fresh installs need the same post-migration index guarantee as upgraded
  // databases, including recovery from an interrupted migration 127 attempt.
  // Sync now — runs immediately after the schema backfill above, before any
  // async work can interleave on this connection.
  ensureUsageHistoryAccountIndex(db);

  const optimizationSettingsApply = applyStoredDatabaseOptimizationSettings(db)
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn("[DB] Stored optimization settings apply failed:", error);
    });
  setDbOptimizationSettingsPromise(optimizationSettingsApply);

  // Apply mmap_size from stored settings (migration 046), fallback to 256MiB
  try {
    const mmapRow = (db.raw as RawSyncDb)
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get("databaseSettings", "mmapSize") as { value: string } | undefined;
    const mmapSize = mmapRow ? Math.max(0, parseInt(mmapRow.value, 10) || 0) : 268435456;
    if (mmapSize > 0) {
      db.pragma(`mmap_size = ${mmapSize}`);
    }
  } catch {
    // mmap_size is best-effort; not available in all runtimes (e.g. web)
  }

  // Legacy call-log offload is deferred to `awaitDbStartupTasks()` (called by
  // the boot hook and by tests before touching the DB). It ends with
  // wal_checkpoint(TRUNCATE)+VACUUM, which cannot run here: migrationsPromise
  // may still hold a transaction on this connection ("cannot VACUUM from
  // within a transaction"), and firing it inline raced migrations into
  // "database is not open" cascades that killed ~1200 DB tests under
  // concurrency. The tracked promise also lets resetDbInstance() cancel any
  // in-flight offload before closing the handle.

  // Auto-migrate from db.json if exists
  if (jsonDbFile && fs.existsSync(jsonDbFile)) {
    void migrateFromJson(db, jsonDbFile).catch((error: unknown) => {
      console.warn("[DB] db.json migration failed:", error);
    });
  }

  if (failedProbePath && preservedCriticalState.preservedTables.length > 0) {
    try {
      const restoredTables = restoreCriticalDbState(db, preservedCriticalState);
      console.log(
        `[DB] Restored preserved critical DB state after probe failure: ${summarizePreservedTables(
          restoredTables
        )}`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        closeProbeIfSafe(db);
      } catch {
        /* ignore */
      }
      cleanupRecreatedSqliteFiles(sqliteFile);
      throw new Error(
        `[DB] Automatic recovery aborted after probe failure. ` +
          `Preserved database: ${failedProbePath}. ` +
          `Restore failure: ${message}.`
      );
    }
  }

  // Store schema version
  const versionStmt = db.prepare(
    "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('schema_version', '1')"
  );
  versionStmt.run();
  if (shouldRunStartupDbHealthCheck()) {
    const skipIntegrityCheck = process.env.OMNIROUTE_SKIP_DB_HEALTHCHECK === "1";
    if (skipIntegrityCheck) {
      console.log("[DB] Health check skipped (OMNIROUTE_SKIP_DB_HEALTHCHECK=1)");
    }
    // Join the deferred migration run first: the runner is async over this
    // same connection, so a health check starting while it runs interleaves
    // statements against a half-migrated schema.
    trackDeferredStartupWork(
      awaitDbMigrations()
        .then(async () => {
          const { runDbHealthCheck } = await import("./healthCheck");
          return runDbHealthCheck(db, {
            autoRepair: true,
            expectedSchemaVersion: "1",
            skipIntegrityCheck,
            createBackupBeforeRepair: () => createHealthCheckBackup(db),
          });
        })
        .catch((error: unknown) => {
          console.warn("[DB] Startup health-check failed:", error);
        })
    );
  }

  setDb(db);

  // Re-encrypt any tokens using the legacy dynamic salt to canonical static salt
  try {
    // Defer until the migration run settles (async statements on the same
    // connection must never interleave).
    trackDeferredStartupWork(
      awaitDbMigrations()
        .then(() => autoMigrateLegacyEncryptedConnections(db))
        .catch((error: unknown) => {
          console.warn("[DB] Legacy connection encryption migration failed:", error);
        })
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DB] Legacy encryption migration failed: ${message}`);
  }

  startDbHealthCheckScheduler(db);
  // Log the resolved absolute DATA_DIR + SQLITE_FILE once at init so a
  // multi-replica / Docker volume-topology mismatch (each replica opening a
  // different on-disk DB → "phantom"/missing combos & connections) is
  // diagnosable straight from the logs. (#3147)
  console.log(
    `[DB] SQLite database ready: ${sqliteFile} ` +
      `(DATA_DIR=${path.resolve(DATA_DIR)}, SQLITE_FILE=${path.resolve(sqliteFile)})`
  );
  return unwrapRawSync(db);
}

/**
 * Lightweight liveness probe — runs `SELECT 1` against the singleton DB.
 * Returns `true` if the database is reachable, `false` on any error.
 * Intended for use by the `/api/health/ping` route (Hard Rule #5: no raw SQL in routes).
 */
export async function pingDb(): Promise<boolean> {
  try {
    const result = (await getDbInstance().prepare("SELECT 1 AS ok").get()) as
      { ok: number } | undefined;
    return result?.ok === 1;
  } catch {
    return false;
  }
}

export function closeDbInstance(options?: { checkpointMode?: CheckpointMode | null }): boolean {
  clearDbHealthCheckScheduler();
  const db = getDb();
  if (!db) return false;

  const checkpointMode = options?.checkpointMode ?? "TRUNCATE";

  try {
    if (checkpointMode) {
      try {
        if (checkpointDb(db, checkpointMode)) {
          console.log(`[DB] SQLite WAL checkpoint completed (${checkpointMode}).`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[DB] WAL checkpoint failed during close (${checkpointMode}):`, message);
      }
    }
  } finally {
    try {
      if (db.open) db.close();
    } finally {
      setDb(null);
      // Module-level caches (prepared statements, schema-check memos — e.g.
      // apiKeys.ts) are bound to the closed connection. Without this, a recreated
      // DB (tests, backup restore of an older snapshot) hits "no such column"
      // on the stale re-prepare path. backup.ts already does this on restore;
      // close/reset must too (found by the 6A.1 orphan-test re-wire, 2026-06-09).
      resetAllDbModuleState();
    }
  }

  return true;
}

/**
 * Wait for the fire-and-forget versioned migration run to finish.
 *
 * openSqliteDatabase (getDb) kicks off `migrationsPromise` without awaiting it.
 * Tests / restore flows that reset the DB need the schema fully materialised
 * before touching it, so they await this. Resolves immediately when no migration
 * is in flight (e.g. no DB opened yet). Any runner failure is swallowed by the
 * tracked promise (it logs); this simply resolves once the run has settled.
 */
export async function awaitDbMigrations(): Promise<void> {
  if (migrationsPromise) await migrationsPromise;
}

/**
 * Wait for the schema-backfill barrier (ensure*Columns + usage-history index)
 * of the CURRENT database instance. Sync modules that write columns owned by
 * those backfills (call_logs.reasoning_source et al.) must await this once at
 * boot so early statements never hit a half-migrated schema.
 */
export async function awaitDbColumnBackfills(): Promise<void> {
  await columnBackfillsPromise;
}

export { awaitDbOptimizationSettings } from "./optimizationSettingsTracker";

/**
 * Await post-migration startup maintenance (currently: the legacy call-log
 * offload). Must run AFTER `awaitDbMigrations()` — VACUUM cannot start inside
 * an open migration transaction on the same connection. Idempotent: the first
 * caller kicks the work off, later callers just join the settled promise.
 */
export async function awaitDbStartupTasks(): Promise<void> {
  if (getDbDriver() === "postgres") return;
  const db = getDb();
  if (!db) return;
  if (!startupTasksPromise) {
    startupTasksPromise = offloadLegacyCallLogDetails(db)
      .catch((error: unknown) => {
        console.warn("[DB] Legacy call-log offload failed:", error);
      })
      .then(() => undefined);
  }
  await startupTasksPromise;
}

/**
 * Async variant of closeDbInstance(): drains the fire-and-forget migration
 * runner BEFORE closing, so a test reset / restore never yanks the connection
 * out from under `runMigrations` ("database connection is not open" cascade).
 * The sync close stays for shutdown paths where nothing may be in flight.
 */
export async function closeDbInstanceDrained(options?: {
  checkpointMode?: CheckpointMode | null;
}): Promise<boolean> {
  await awaitDbMigrations();
  // The deferred startup passes (health check, legacy re-encrypt) run on this
  // same connection; a reset that closes mid-flight makes them throw "the
  // database connection is not open" and leaves the next open racing stale
  // work. Give them a chance to settle before closing.
  await flushDeferredStartupWork();
  const closed = closeDbInstance(options);
  // resetDbInstance() clears these; the drained variant must too, or a test
  // reset leaves asyncDb wrapping the just-closed connection and every later
  // getAsyncDb() call throws "database connection is not open" (call-log-cap
  // cascade, 2026-09-28). startupTasksPromise belongs to the old instance as
  // well — clearing it lets the next DB kick off its own offload.
  asyncDb = null;
  migrationsPromise = null;
  columnBackfillsPromise = Promise.resolve();
  setDbOptimizationSettingsPromise(Promise.resolve());
  startupTasksPromise = null;
  return closed;
}

/**
 * Async variant of resetDbInstance() — see closeDbInstanceDrained.
 */
export async function resetDbInstanceDrained(): Promise<void> {
  await closeDbInstanceDrained();
}

/**
 * Reset the singleton (used by restore).
 */
export function resetDbInstance() {
  closeDbInstance();
  // The async handle may be a wrapper around the just-closed synchronous SQLite
  // (sqlite mode). Drop it so the next getAsyncDb() re-wraps the freshly opened
  // handle instead of preparing statements against a closed connection — the
  // previous instance would throw "database connection is not open" (tests,
  // backup restore). Postgres mode is unaffected (adapter is connection-less
  // and re-wraps fine, though we clear it anyway for a clean slate).
  asyncDb = null;
  migrationsPromise = null;
  // The old backfill barrier belongs to the closed instance; drop it so a
  // pending await never resolves against the next DB's half-migrated schema.
  columnBackfillsPromise = Promise.resolve();
  // Read caches outlive the SQLite singleton. A reset swaps the backing
  // database, so retaining cached rows can leak the previous database's
  // connections/settings into the newly opened instance (tests and restore).
  invalidateDbCache();
}

// ──────────────── Runtime Driver Info ────────────────

type DbDriverInfo = { source: string; kind: string };
let driverInfoCached: DbDriverInfo | null = null;

function setDriverInfo(info: DbDriverInfo) {
  driverInfoCached = info;
}

/** Returns how better-sqlite3 was resolved (bundled / runtime / etc.). Null if not yet init. */
export function getDriverInfo(): DbDriverInfo | null {
  return driverInfoCached;
}

/**
 * Async initializer that pre-resolves the SQLite runtime before first DB access.
 *
 * Call this at process startup (before any call to getDbInstance()) so that
 * if the bundled better-sqlite3 binary is unavailable, the runtime installer
 * can place it in ~/.omniroute/runtime/ without blocking a synchronous caller.
 *
 * Idempotent — safe to call multiple times.
 */
export async function ensureDbInitialized(): Promise<void> {
  // PG mode: never open SQLite — the async Postgres adapter is the single DB.
  // Callers on the sync path (getDbInstance) are handled separately (transition
  // warning), but the boot probe must not create a SQLite file next to PG.
  if (getDbDriver() === "postgres") {
    await initAsyncDb();
    return;
  }

  if (getDb()) {
    await awaitDbMigrations();
    return;
  }

  // Cloud/build: getDbInstance() cria in-memory, sem necessidade de pré-init
  if (isCloud || isBuildPhase || !SQLITE_FILE) {
    getDbInstance();
    return;
  }

  // Tenta drivers síncronos primeiro
  const sync = tryOpenSync(SQLITE_FILE);
  if (sync) {
    // Drivers síncronos disponíveis — fechar o probe, getDbInstance() vai abrir com setup completo
    sync.close();
    getDbInstance();
    await awaitDbMigrations();
    return;
  }

  // No synchronous driver available — pre-initialize sql.js (WASM, async)
  console.warn("[DB] Pre-initializing sql.js WASM (synchronous drivers unavailable)...");
  await preInitSqlJs(SQLITE_FILE);
  // Agora getSqlJsAdapter() retornará o adapter, e getDbInstance() vai usá-lo
  getDbInstance();
  await awaitDbMigrations();
}

// ──────────────── JSON → SQLite Migration ────────────────

export async function applyDatabaseOptimizationSettings(
  settings: DatabaseOptimizationSettings
): Promise<void> {
  await applyDatabaseOptimizationSettingsForDb(getDbInstance(), settings, {
    applyPersistent: true,
  });
}

export async function setAutoVacuum(mode: "NONE" | "FULL" | "INCREMENTAL"): Promise<void> {
  await setAutoVacuumForDb(getDbInstance(), mode);
}

export async function getAutoVacuumMode(): Promise<"NONE" | "FULL" | "INCREMENTAL"> {
  return getAutoVacuumModeForDb(getDbInstance());
}

export async function runManualVacuum(): Promise<{
  success: boolean;
  duration: number;
  error?: string;
}> {
  const db = getDbInstance();
  const startTime = Date.now();

  try {
    console.log("[DB] Starting manual VACUUM...");
    await db.exec("VACUUM");
    const duration = Date.now() - startTime;
    console.log(`[DB] Manual VACUUM completed in ${duration}ms`);
    return { success: true, duration };
  } catch (err: unknown) {
    const duration = Date.now() - startTime;
    console.error("[DB] Manual VACUUM failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, duration, error: message };
  }
}

export async function setPageSize(pageSize: number): Promise<void> {
  await setPageSizeForDb(getDbInstance(), pageSize);
}

export function setCacheSize(cacheSizeKb: number): void {
  setCacheSizeForDb(getDbInstance(), cacheSizeKb);
}
