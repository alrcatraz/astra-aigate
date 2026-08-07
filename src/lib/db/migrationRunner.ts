/**
 * Migration Runner — Versioned SQL Migrations for SQLite
 *
 * Reads numbered `.sql` files from the migrations directory and applies
 * them sequentially, tracking applied versions in a `schema_migrations` table.
 *
 * Naming convention: `NNN_description.sql` (e.g., `001_initial_schema.sql`)
 *
 * All migrations run within a single transaction — all-or-nothing per file.
 *
 * Safety features:
 * - Pre-migration backup before applying any pending migrations
 * - Mass-migration detection (abort if too many pending on existing DB)
 * - Migration name mismatch warning (detects renumbering issues)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { SqliteAdapter } from "./adapters/types";
import { DEFAULT_DATABASE_SETTINGS } from "@/types/databaseSettings";
import { isAutomatedTestProcess } from "@/shared/utils/testProcess";
import {
  RENAMED_MIGRATION_COMPATIBILITY,
  LEGACY_VERSION_SLOT_MIGRATIONS,
  SUPERSEDED_DUPLICATE_MIGRATIONS,
  PHYSICAL_SCHEMA_SENTINELS,
  INITIAL_SCHEMA_SENTINELS,
  OPTIONAL_FTS5_MIGRATION_VERSIONS,
} from "./migrationRunner/constants";
import { getExtraMigrationFiles } from "./migrationRunner/extraDirs";

const isNodeTestRunnerChild = typeof process.env.NODE_TEST_CONTEXT === "string";

const console = {
  log: (...args: unknown[]) => {
    if (!isNodeTestRunnerChild) globalThis.console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (!isNodeTestRunnerChild) globalThis.console.warn(...args);
  },
  error: (...args: unknown[]) => {
    globalThis.console.error(...args);
  },
};

/**
 * Resolve the migrations directory path safely across platforms.
 * On Windows with global npm installs, `import.meta.url` may not be a valid
 * `file://` URL, causing `fileURLToPath` to throw `ERR_INVALID_FILE_URL_PATH`.
 */
function resolveMigrationsDir(): string {
  const configuredDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
  if (typeof configuredDir === "string" && configuredDir.trim().length > 0) {
    return path.resolve(configuredDir);
  }

  const checkLocations = (basePath: string) => {
    const locations = [
      path.join(basePath, "migrations"),
      path.join(basePath, "src", "lib", "db", "migrations"),
      path.join(basePath, "app", "src", "lib", "db", "migrations"),
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) return loc;
    }
    return null;
  };

  try {
    let currentDir = path.dirname(fileURLToPath(import.meta.url));
    while (currentDir !== path.dirname(currentDir)) {
      const found = checkLocations(currentDir);
      if (found) return found;
      currentDir = path.dirname(currentDir);
    }
  } catch {
    // Fall through to more defensive URL parsing below.
  }

  // Fix #1704: On Windows with global npm installs, import.meta.url may contain
  // CI build-time paths (e.g., /home/runner/work/...) that are not valid file://
  // URLs on Windows. Extract the path portion directly and normalize it.
  const metaUrl = import.meta.url;
  if (typeof metaUrl === "string" && metaUrl.startsWith("file://")) {
    try {
      // Strip the file:// prefix and decode, then normalize for the platform
      const rawPath = decodeURIComponent(
        metaUrl.replace(/^file:\/\/\//, "/").replace(/^file:\/\//, "")
      );
      let currentDir = path.dirname(path.resolve(rawPath));
      while (currentDir !== path.dirname(currentDir)) {
        const found = checkLocations(currentDir);
        if (found) return found;
        currentDir = path.dirname(currentDir);
      }
    } catch {
      // Fall through to process.cwd fallback
    }
  }

  // Last resort: use process.cwd to find migrations relative to the app root
  const fromCwd = checkLocations(process.cwd());
  if (fromCwd) return fromCwd;

  throw new Error(
    "[Migration] Could not resolve migrations directory. Set OMNIROUTE_MIGRATIONS_DIR."
  );
}

const MIGRATIONS_DIR = resolveMigrationsDir();

/**
 * Default maximum number of migrations allowed to run in a single startup on an
 * existing database. If more migrations are pending than this threshold,
 * it likely means the migration tracking table was accidentally wiped,
 * and running all migrations from scratch could cause data loss.
 *
 * Set the threshold to 0 (via `OMNIROUTE_MAX_PENDING_MIGRATIONS`) to disable
 * this safety check.
 */
const DEFAULT_MAX_PENDING_MIGRATIONS_ON_EXISTING_DB = 50;

/**
 * Resolve the mass-migration safety threshold, allowing an operator to override
 * the default via the `OMNIROUTE_MAX_PENDING_MIGRATIONS` env var (#3416). This
 * is read at CALL TIME inside runMigrations() so a backup restore can raise the
 * limit (or `0` to disable the check) without a code change. Mirrors the
 * `OMNIROUTE_MIGRATIONS_DIR` convention used in resolveMigrationsDir(). Falls
 * back to the default on missing or invalid (non-numeric / negative) input.
 */
function resolveMaxPendingMigrations(): number {
  const raw = process.env.OMNIROUTE_MAX_PENDING_MIGRATIONS;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_PENDING_MIGRATIONS_ON_EXISTING_DB;
}

/**
 * Raised by the mass-migration safety check when far more migrations are pending
 * than the resolved threshold — a strong signal the migration tracking table was
 * wiped (e.g. a restored backup). Given its own type so callers/loggers can
 * recognize the memoized cascade and keep repeated logs concise (#6260).
 */
export class MigrationSafetyAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationSafetyAbortError";
  }
}

/**
 * Memoized mass-migration abort (#6260). After a backup restore wipes the
 * migration tracking table, EVERY downstream `ensureDbInitialized()` re-opens
 * the DB and re-calls `runMigrations()`, which used to recompute the abort and
 * re-`console.error` the full banner 11+ times. Caching the thrown instance
 * (keyed by the exact message it would compute) lets repeated calls in the same
 * process throw the SAME instance and log a single concise line instead.
 */
let memoizedSafetyAbort: MigrationSafetyAbortError | null = null;

const fts5SupportCache = new WeakMap<SqliteAdapter, boolean>();

/**
 * Ensure the schema_migrations tracking table exists.
 */
async function ensureMigrationsTable(db: SqliteAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _omniroute_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function isOptionalFts5Migration(migration: { version: string; name: string }): boolean {
  return OPTIONAL_FTS5_MIGRATION_VERSIONS.has(migration.version);
}

async function supportsFts5(db: SqliteAdapter): Promise<boolean> {
  const cached = fts5SupportCache.get(db);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const probeTable = `__omniroute_fts5_probe_${crypto.randomUUID().replace(/-/g, "_")}`;
    await db.transaction(async () => {
      await db.exec(`CREATE VIRTUAL TABLE "${probeTable}" USING fts5(content);`);
      await db.exec(`DROP TABLE "${probeTable}";`);
    })();
    fts5SupportCache.set(db, true);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such module:\s*fts5/i.test(message)) {
      fts5SupportCache.set(db, false);
      return false;
    }
    throw error;
  }
}

async function isDeferredUnsupportedMigration(
  db: SqliteAdapter,
  migration: { version: string; name: string }
): Promise<boolean> {
  return isOptionalFts5Migration(migration) && !(await supportsFts5(db));
}

/**
 * Get all migration files sorted by version number.
 */
function getMigrationFiles(): Array<{ version: string; name: string; path: string }> {
  // The extra directories are an independent set: a missing core directory must not
  // make them vanish silently.
  if (!fs.existsSync(MIGRATIONS_DIR)) return getExtraMigrationFiles();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const match = filename.match(/^(\d+)_(.+)\.sql$/);
      if (!match) return null;
      return {
        version: match[1],
        name: match[2],
        path: path.join(MIGRATIONS_DIR, filename),
      };
    })
    .filter(Boolean) as Array<{ version: string; name: string; path: string }>;

  // Detect version collisions early: two files sharing the same numeric prefix
  // would otherwise be silently skipped by the runner (only the first applied
  // would record version=NNN in _omniroute_migrations; the rest would never run).
  // SUPERSEDED_DUPLICATE_MIGRATIONS lists legitimate "renamed" pairs and is OK.
  const byVersion = new Map<string, string[]>();
  for (const f of files) {
    if (!byVersion.has(f.version)) byVersion.set(f.version, []);
    byVersion.get(f.version)!.push(f.name);
  }
  const realCollisions: Array<{ version: string; names: string[] }> = [];
  for (const [version, names] of byVersion.entries()) {
    if (names.length <= 1) continue;
    const liveNames = names.filter(
      (name) =>
        !SUPERSEDED_DUPLICATE_MIGRATIONS.some((sup) => sup.version === version && sup.name === name)
    );
    if (liveNames.length > 1) {
      realCollisions.push({ version, names: liveNames });
    }
  }
  if (realCollisions.length > 0) {
    const summary = realCollisions
      .map((c) => `version=${c.version} → [${c.names.join(", ")}]`)
      .join("; ");
    throw new Error(
      `Migration version collision detected: ${summary}. ` +
        `Each migration file must have a unique numeric prefix. Rename one of the ` +
        `colliding files (and add a retroactive guard in isSchemaAlreadyApplied for ` +
        `DBs that already applied the old number). See _tasks/features-v3.8.4/9route/POST-MERGE-AUDIT.md.`
    );
  }

  // Extra directories registered via OMNIROUTE_EXTRA_MIGRATIONS_DIRS, appended
  // AFTER the numeric set so a distribution's own schema always lands on top of
  // the upstream one. Their versions are namespaced (`ee-134`), so they cannot
  // collide with a numeric slot, and every downstream consumer here — the applied
  // set, the gap reconciliation, the name-mismatch check — keys on the version
  // string and needs no further change. Empty and filesystem-free when unset.
  return [...files, ...getExtraMigrationFiles()];
}

function filterSupersededDuplicateMigrations(
  files: Array<{ version: string; name: string; path: string }>
): Array<{ version: string; name: string; path: string }> {
  return files.filter((file) => {
    const superseded = SUPERSEDED_DUPLICATE_MIGRATIONS.find(
      (migration) => migration.version === file.version && migration.name === file.name
    );
    if (!superseded) {
      return true;
    }

    const hasReplacement = files.some(
      (candidate) =>
        candidate.version === superseded.supersededByVersion &&
        candidate.name === superseded.supersededByName
    );
    if (!hasReplacement) {
      return true;
    }

    console.warn(
      `[Migration] Ignoring superseded duplicate migration ${file.version}_${file.name}; ` +
        `${superseded.supersededByVersion}_${superseded.supersededByName} is the canonical slot.`
    );
    return false;
  });
}

/**
 * Get list of already-applied migration versions.
 */
async function getAppliedVersions(db: SqliteAdapter): Promise<Set<string>> {
  const rows = (await db.prepare("SELECT version FROM _omniroute_migrations").all()) as Array<{
    version: string;
  }>;
  return new Set(rows.map((r) => r.version));
}

/**
 * Get applied migration records (version + name) for mismatch detection.
 */
async function getAppliedRecords(
  db: SqliteAdapter
): Promise<Array<{ version: string; name: string }>> {
  return (await db
    .prepare("SELECT version, name FROM _omniroute_migrations ORDER BY version")
    .all()) as Array<{
    version: string;
    name: string;
  }>;
}

async function hasTable(db: SqliteAdapter, tableName: string): Promise<boolean> {
  const row = (await db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
    .get(tableName)) as { name?: string } | undefined;
  return Boolean(row?.name);
}

async function hasColumn(
  db: SqliteAdapter,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const columns = (await db.prepare(`PRAGMA table_info(${tableName})`).all()) as Array<{
    name?: string;
  }>;
  return columns.some((column) => column.name === columnName);
}

async function ensureColumn(
  db: SqliteAdapter,
  tableName: string,
  columnName: string,
  ddl: string
): Promise<void> {
  if (!(await hasColumn(db, tableName, columnName))) {
    await db.exec(ddl);
  }
}

async function isSchemaAlreadyApplied(
  db: SqliteAdapter,
  migration: { version: string; name: string }
): Promise<boolean> {
  switch (migration.version) {
    case "003":
      return await hasColumn(db, "provider_nodes", "chat_path");
    case "095":
      return await hasColumn(db, "provider_nodes", "custom_headers_json");
    case "005":
      return await hasColumn(db, "combos", "system_message");
    case "007":
      return await hasColumn(db, "call_logs", "request_type");
    case "009":
      return await hasColumn(db, "call_logs", "requested_model");
    case "018":
      return (
        (await hasColumn(db, "call_logs", "tokens_cache_read")) &&
        (await hasColumn(db, "call_logs", "tokens_cache_creation")) &&
        (await hasColumn(db, "call_logs", "tokens_reasoning"))
      );
    case "020":
      return await hasColumn(db, "combos", "sort_order");
    case "021":
      return (
        (await hasColumn(db, "call_logs", "combo_step_id")) &&
        (await hasColumn(db, "call_logs", "combo_execution_key"))
      );
    case "023":
      return await hasColumn(db, "memories", "memory_id");
    case "025":
      return (
        (await hasColumn(db, "call_logs", "detail_state")) &&
        (await hasColumn(db, "call_logs", "request_summary"))
      );
    case "026":
      return await hasColumn(db, "call_logs", "cache_source");
    case "027":
      return await hasColumn(db, "skills", "mode");
    case "028":
      return (await hasTable(db, "batches")) && (await hasTable(db, "files"));
    case "029":
      return await hasColumn(db, "provider_connections", "max_concurrent");
    case "040":
      return await hasColumn(db, "proxy_registry", "source");
    case "041":
      if (migration.name === "session_account_affinity") {
        return await hasTable(db, "session_account_affinity");
      }
      return (
        (await hasColumn(db, "compression_analytics", "actual_prompt_tokens")) &&
        (await hasColumn(db, "compression_analytics", "actual_completion_tokens")) &&
        (await hasColumn(db, "compression_analytics", "actual_total_tokens")) &&
        (await hasColumn(db, "compression_analytics", "receipt_source")) &&
        (await hasColumn(db, "compression_analytics", "validation_fallback")) &&
        (await hasColumn(db, "compression_analytics", "output_mode"))
      );
    case "042":
      return (
        (await hasTable(db, "compression_combos")) &&
        (await hasTable(db, "compression_combo_assignments")) &&
        (await hasColumn(db, "compression_analytics", "compression_combo_id")) &&
        (await hasColumn(db, "compression_analytics", "engine"))
      );
    case "045":
      return await hasColumn(db, "call_logs", "tokens_compressed");
    case "053":
      return !(await hasColumn(db, "files", "status"));
    case "054":
      return await hasColumn(db, "usage_history", "service_tier");
    case "062":
      return await hasColumn(db, "usage_history", "combo_strategy");
    case "070":
      // Retroactive guard for webhooks-kind-metadata migration renumbered from 068
      // (collided with 068_free_proxies + 068_services). DBs that already applied
      // 068_webhooks_kind_metadata should not re-run as 070.
      return (
        (await hasColumn(db, "webhooks", "kind")) &&
        (await hasColumn(db, "webhooks", "metadata_encrypted"))
      );
    case "071":
      // Retroactive guard for embedded-services migration renumbered from 068
      // (originally collided with 068_free_proxies and 068_webhooks_kind_metadata).
      // DBs that already applied 068_services should not re-run as 071.
      return (
        (await hasColumn(db, "version_manager", "logs_buffer_path")) &&
        (await hasColumn(db, "version_manager", "provider_expose")) &&
        (await hasColumn(db, "version_manager", "last_sync_at"))
      );
    case "073":
      // Plan 21 D27 fix: guard memory_vec migration. Without this case, an
      // unmarked re-run of 073_memory_vec.sql would have its ALTER TABLE fail
      // mid-file and skip the CREATE INDEX that follows, leaving the index
      // missing on DBs that re-execute the script after a partial first run.
      return await hasColumn(db, "memories", "needs_reindex");
    case "085":
      // Retroactive guard for quota_pools migration renumbered from 077 → 085
      // (077 collided with 077_api_key_stream_default_mode). DBs that already
      // applied quota_pools under the old 077 number should not re-run as 085.
      return (await hasTable(db, "quota_pools")) && (await hasTable(db, "quota_allocations"));
    case "088":
      // Quota groups migration (renumbered 087 → 088 on merge into v3.8.8).
      // The table + column are already present when group_id exists on
      // quota_pools (ensures the backfill UPDATE also ran).
      return (
        (await hasTable(db, "quota_groups")) && (await hasColumn(db, "quota_pools", "group_id"))
      );
    case "089":
      // disable_non_public_models column (PR #3017, renumbered 077 → 089 to avoid
      // collision with 077_api_key_stream_default_mode on merge into v3.8.8).
      return await hasColumn(db, "api_keys", "disable_non_public_models");
    case "090":
      // plugin_metrics table (PR #2913, renumbered 077 → 090 to avoid
      // collision with 077_api_key_stream_default_mode on merge into v3.8.8).
      return await hasTable(db, "plugin_metrics");
    case "091":
      // plugin_analytics table (PR #2913). The PR's stray db/migrations version
      // was dropped on integration; this canonical migration creates the table
      // that recordPluginExecution()/getPluginAnalytics() rely on.
      return await hasTable(db, "plugin_analytics");
    case "117":
      // Proxy-pool rotation (#6365): the assignments table was rebuilt to add a
      // `position` column and drop UNIQUE(scope, scope_id). If `position` already
      // exists the rebuild ran — skip re-executing the rename/copy/drop, which
      // would fail on the missing proxy_assignments_pre117 table.
      return await hasColumn(db, "proxy_assignments", "position");
    case "137":
      // Phase 3.8 B 方案 services proxy columns. The ALTER TABLE statements in
      // 137_services_proxy.sql fail with "duplicate column" on a re-run, so the
      // migration is skipped wholesale once `proxied` exists.
      return await hasColumn(db, "services", "proxied");
    default:
      return false;
  }
}

async function applyApiKeyLifecycleMigration(db: SqliteAdapter): Promise<void> {
  await ensureColumn(
    db,
    "api_keys",
    "revoked_at",
    "ALTER TABLE api_keys ADD COLUMN revoked_at TEXT"
  );
  await ensureColumn(
    db,
    "api_keys",
    "expires_at",
    "ALTER TABLE api_keys ADD COLUMN expires_at TEXT"
  );
  await ensureColumn(
    db,
    "api_keys",
    "last_used_at",
    "ALTER TABLE api_keys ADD COLUMN last_used_at TEXT"
  );
  await ensureColumn(
    db,
    "api_keys",
    "key_prefix",
    "ALTER TABLE api_keys ADD COLUMN key_prefix TEXT"
  );
  await ensureColumn(
    db,
    "api_keys",
    "ip_allowlist",
    "ALTER TABLE api_keys ADD COLUMN ip_allowlist TEXT"
  );
  await ensureColumn(db, "api_keys", "scopes", "ALTER TABLE api_keys ADD COLUMN scopes TEXT");

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_at ON api_keys(revoked_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON api_keys(expires_at);
  `);
}

function isSearchRequestTypeMigration(migration: { version: string; name: string }): boolean {
  return migration.version === "007";
}

async function applySearchRequestTypeMigration(db: SqliteAdapter): Promise<void> {
  await ensureColumn(
    db,
    "call_logs",
    "request_type",
    "ALTER TABLE call_logs ADD COLUMN request_type TEXT DEFAULT NULL"
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_call_logs_request_type ON call_logs(request_type);"
  );
}

async function applyCompressionReceiptsMigration(db: SqliteAdapter): Promise<void> {
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_prompt_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_prompt_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_completion_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_completion_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_total_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_total_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_cache_read_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_cache_read_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_cache_write_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_cache_write_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "estimated_usd_saved",
    "ALTER TABLE compression_analytics ADD COLUMN estimated_usd_saved REAL"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "mcp_description_tokens_saved",
    "ALTER TABLE compression_analytics ADD COLUMN mcp_description_tokens_saved INTEGER DEFAULT 0"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "multimodal_skip_count",
    "ALTER TABLE compression_analytics ADD COLUMN multimodal_skip_count INTEGER DEFAULT 0"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "receipt_source",
    "ALTER TABLE compression_analytics ADD COLUMN receipt_source TEXT"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "validation_fallback",
    "ALTER TABLE compression_analytics ADD COLUMN validation_fallback INTEGER DEFAULT 0"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "output_mode",
    "ALTER TABLE compression_analytics ADD COLUMN output_mode TEXT"
  );

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_compression_analytics_request_id
      ON compression_analytics(request_id);
    CREATE INDEX IF NOT EXISTS idx_compression_analytics_receipt_source
      ON compression_analytics(receipt_source);
  `);
}

async function applyCompressionCombosMigration(
  db: SqliteAdapter,
  migrationPath: string
): Promise<void> {
  const sql = fs.readFileSync(migrationPath, "utf-8");
  await db.exec(sql);
  await ensureColumn(
    db,
    "compression_analytics",
    "compression_combo_id",
    "ALTER TABLE compression_analytics ADD COLUMN compression_combo_id TEXT"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "engine",
    "ALTER TABLE compression_analytics ADD COLUMN engine TEXT"
  );
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_compression_analytics_combo_engine
      ON compression_analytics(compression_combo_id, engine);
  `);
}

async function inferPhysicalSchemaBaseline(db: SqliteAdapter): Promise<{
  version: string;
  description: string;
} | null> {
  for (const sentinel of PHYSICAL_SCHEMA_SENTINELS) {
    if (await hasTable(db, sentinel.tableName)) {
      return {
        version: sentinel.version,
        description: sentinel.description,
      };
    }
  }

  const hasInitialSchema = (
    await Promise.all(INITIAL_SCHEMA_SENTINELS.map((tableName) => hasTable(db, tableName)))
  ).every(Boolean);
  if (hasInitialSchema) {
    return {
      version: "001",
      description: "initial schema tables",
    };
  }

  return null;
}

function getPlausiblePendingCount(
  files: Array<{ version: string; name: string; path: string }>,
  baselineVersion: string
): number {
  const baseline = Number.parseInt(baselineVersion, 10);
  return files.filter((file) => Number.parseInt(file.version, 10) > baseline).length;
}

/**
 * Detect migration name mismatches — when a migration version number
 * has been reused/renumbered with a different name. This is a strong signal
 * that the migration tracking is corrupted or migrations were renumbered.
 */
function detectNameMismatches(
  appliedRecords: Array<{ version: string; name: string }>,
  files: Array<{ version: string; name: string; path: string }>
): Array<{ version: string; appliedName: string; diskName: string }> {
  const appliedByName = new Map(appliedRecords.map((r) => [r.version, r.name]));
  const mismatches: Array<{ version: string; appliedName: string; diskName: string }> = [];

  for (const file of files) {
    const appliedName = appliedByName.get(file.version);
    if (appliedName && appliedName !== file.name) {
      mismatches.push({
        version: file.version,
        appliedName,
        diskName: file.name,
      });
    }
  }

  return mismatches;
}

async function reconcileRenumberedMigrations(
  db: SqliteAdapter,
  files: Array<{ version: string; name: string; path: string }>
): Promise<boolean> {
  let repaired = false;

  for (const compatibility of RENAMED_MIGRATION_COMPATIBILITY) {
    const hasTargetFile = files.some(
      (file) => file.version === compatibility.toVersion && file.name === compatibility.toName
    );
    const hasSourceFile = files.some(
      (file) => file.version === compatibility.fromVersion && file.name !== compatibility.fromName
    );

    if (!hasTargetFile || !hasSourceFile) {
      continue;
    }

    const legacyRow = (await db
      .prepare("SELECT version, name FROM _omniroute_migrations WHERE version = ? AND name = ?")
      .get(compatibility.fromVersion, compatibility.fromName)) as
      { version: string; name: string } | undefined;
    if (!legacyRow) {
      continue;
    }

    const targetRow = (await db
      .prepare("SELECT version FROM _omniroute_migrations WHERE version = ?")
      .get(compatibility.toVersion)) as { version: string } | undefined;

    const applyRepair = db.transaction(async () => {
      if (targetRow) {
        await db
          .prepare("DELETE FROM _omniroute_migrations WHERE version = ? AND name = ?")
          .run(compatibility.fromVersion, compatibility.fromName);
      } else {
        await db
          .prepare(
            "UPDATE _omniroute_migrations SET version = ?, name = ? WHERE version = ? AND name = ?"
          )
          .run(
            compatibility.toVersion,
            compatibility.toName,
            compatibility.fromVersion,
            compatibility.fromName
          );
      }
    });

    await applyRepair();
    repaired = true;
    console.warn(
      `[Migration] Reconciled renamed migration ${compatibility.fromVersion}_${compatibility.fromName} ` +
        `to ${compatibility.toVersion}_${compatibility.toName} to preserve pending migrations.`
    );

    // After the compat rewrite, verify the old version slot is now free.
    // A residual row (from a failed prior run, manual intervention, or edge-case
    // UPDATE conflict) at the old version would shadow a NEW migration file
    // placed at that version number — e.g. 028_create_files_and_batches.sql
    // would be skipped because getAppliedVersions() still sees version "028".
    const residualRow = (await db
      .prepare("SELECT version, name FROM _omniroute_migrations WHERE version = ?")
      .get(compatibility.fromVersion)) as { version: string; name: string } | undefined;
    if (residualRow) {
      console.warn(
        `[Migration] ⚠️  Residual row at version ${compatibility.fromVersion} ` +
          `(name: "${residualRow.name}") still present after compat rewrite — ` +
          `removing to unblock new migration at this version slot.`
      );
      await db
        .prepare("DELETE FROM _omniroute_migrations WHERE version = ?")
        .run(compatibility.fromVersion);
    }
  }

  return repaired;
}

async function rehomeLegacyVersionSlotMigrations(
  db: SqliteAdapter,
  files: Array<{ version: string; name: string; path: string }>
): Promise<boolean> {
  let repaired = false;
  const diskNamesByVersion = new Map(files.map((file) => [file.version, file.name]));

  for (const legacy of LEGACY_VERSION_SLOT_MIGRATIONS) {
    const diskName = diskNamesByVersion.get(legacy.version);
    if (!diskName || diskName === legacy.name) {
      continue;
    }

    const legacyRow = (await db
      .prepare("SELECT version, name FROM _omniroute_migrations WHERE version = ? AND name = ?")
      .get(legacy.version, legacy.name)) as { version: string; name: string } | undefined;
    if (!legacyRow) {
      continue;
    }

    const legacyVersion = `legacy-${legacy.version}-${legacy.name}`;
    const applyRepair = db.transaction(async () => {
      const existingLegacyRow = (await db
        .prepare("SELECT version FROM _omniroute_migrations WHERE version = ?")
        .get(legacyVersion)) as { version: string } | undefined;

      if (existingLegacyRow) {
        await db
          .prepare("DELETE FROM _omniroute_migrations WHERE version = ? AND name = ?")
          .run(legacy.version, legacy.name);
        return;
      }

      await db
        .prepare("UPDATE _omniroute_migrations SET version = ? WHERE version = ? AND name = ?")
        .run(legacyVersion, legacy.version, legacy.name);
    });

    await applyRepair();
    repaired = true;
    console.warn(
      `[Migration] Rehomed legacy migration ${legacy.version}_${legacy.name} ` +
        `to ${legacyVersion} so current ${legacy.version}_${diskName} can apply.`
    );
  }

  return repaired;
}

/**
 * Create a pre-migration backup of the SQLite database using VACUUM INTO.
 * Returns the backup path on success, null on failure.
 */
async function createPreMigrationBackup(db: SqliteAdapter): Promise<string | null> {
  try {
    const sqliteFile = db.name;
    if (!sqliteFile || sqliteFile === ":memory:") return null;

    const backupDir = path.join(path.dirname(sqliteFile), "db_backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `db_${timestamp}_pre-migration.sqlite`);
    const escapedBackupPath = backupPath.replace(/'/g, "''");

    await db.exec(`VACUUM INTO '${escapedBackupPath}'`);
    console.log(`[Migration] Pre-migration backup created: ${backupPath}`);
    return backupPath;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Migration] Failed to create pre-migration backup: ${message}`);
    return null;
  }
}

/**
 * Run all pending migrations in order.
 * Returns the number of migrations applied.
 *
 * Includes safety checks:
 * 1. Detects migration name mismatches (renumbering) and warns
 * 2. Aborts if too many pending migrations on an existing DB (likely wipe)
 * 3. Creates automatic backup before running any migrations
 */
export async function runMigrations(
  db: SqliteAdapter,
  options?: { isNewDb?: boolean }
): Promise<number> {
  const isNewDb = options?.isNewDb === true;
  await ensureMigrationsTable(db);

  const files = filterSupersededDuplicateMigrations(getMigrationFiles());
  await rehomeLegacyVersionSlotMigrations(db, files);
  await reconcileRenumberedMigrations(db, files);
  const applied = await getAppliedVersions(db);
  const appliedRecords = await getAppliedRecords(db);

  // ── Safety Check 1: Detect migration name mismatches (renumbering) ──
  const mismatches = detectNameMismatches(appliedRecords, files);
  if (mismatches.length > 0) {
    console.error(
      `[Migration] ⚠️  CRITICAL: ${mismatches.length} migration version(s) have been renumbered!`
    );
    for (const m of mismatches) {
      console.error(
        `  Version ${m.version}: applied as "${m.appliedName}" but disk has "${m.diskName}"`
      );
    }
    console.error(
      `[Migration] This indicates migrations were renumbered between releases, ` +
        `which can cause the migration runner to skip or re-run migrations incorrectly.`
    );
    console.error(
      `[Migration] The version-only tracking will skip these (version already applied), ` +
        `but please report this to the AI Gate maintainers.`
    );
  }

  // ── Gap Reconciliation: Identify non-contiguous missing migrations ──
  // Do not rely on any highest-version-applied heuristic. We must explicitly
  // iterate through all missing files on disk and apply them if they are missing
  // from the _omniroute_migrations table.
  const numericApplied = Array.from(applied)
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => !Number.isNaN(n));
  const highestApplied = numericApplied.length > 0 ? Math.max(...numericApplied) : 0;
  const pending = files.filter((f) => {
    const isMissing = !applied.has(f.version);
    if (isMissing && Number(f.version) < highestApplied) {
      console.warn(
        `[Migration] 🔄 RECONCILIATION: Found missing intermediate migration ` +
          `${f.version}_${f.name} (highest applied is ${highestApplied}). ` +
          `This gap will be back-filled to ensure schema integrity.`
      );
    }
    return isMissing;
  });
  const deferredUnsupported: Array<{ version: string; name: string }> = [];
  for (const migration of pending) {
    if (await isDeferredUnsupportedMigration(db, migration)) {
      deferredUnsupported.push(migration);
    }
  }
  const actionablePending = pending.filter(
    (migration) => !deferredUnsupported.some((deferred) => deferred.version === migration.version)
  );

  if (pending.length === 0) {
    return 0; // Nothing to do
  }

  if (deferredUnsupported.length > 0) {
    const summary = deferredUnsupported
      .map((migration) => `${migration.version}_${migration.name}`)
      .join(", ");
    console.warn(
      `[Migration] Deferring optional FTS5 migrations on driver ${db.driver}: ${summary}. ` +
        `Memory search will fall back until a SQLite driver with FTS5 support is available.`
    );
  }

  // ── Safety Check 2: Mass-migration detection (abort if existing DB + many migrations) ──
  // Skip in test environments where fresh DBs legitimately have many pending migrations.
  const isTestEnvironment = isAutomatedTestProcess();

  // #3416: resolve the threshold at call time so OMNIROUTE_MAX_PENDING_MIGRATIONS
  // can override the default (0 disables the check). The abort message below
  // interpolates this resolved value, so it auto-reflects any override.
  const maxPendingMigrations = resolveMaxPendingMigrations();

  if (
    !isTestEnvironment &&
    !isNewDb &&
    process.env.DISABLE_SQLITE_AUTO_BACKUP !== "true" &&
    maxPendingMigrations > 0 &&
    applied.size > 0 &&
    actionablePending.length > maxPendingMigrations
  ) {
    const physicalBaseline = await inferPhysicalSchemaBaseline(db);
    const plausiblePendingCount = physicalBaseline
      ? getPlausiblePendingCount(files, physicalBaseline.version)
      : null;

    if (plausiblePendingCount !== null && actionablePending.length <= plausiblePendingCount) {
      console.warn(
        `[Migration] Allowing ${actionablePending.length} pending migrations on an existing database ` +
          `because the physical schema only proves ${physicalBaseline?.version} ` +
          `(${physicalBaseline?.description}).`
      );
    } else {
      const schemaHint =
        physicalBaseline && plausiblePendingCount !== null
          ? ` Physical schema already shows ${physicalBaseline.version} ` +
            `(${physicalBaseline.description}), so at most ${plausiblePendingCount} pending ` +
            `migration(s) are expected from a legitimate upgrade.`
          : "";
      const bypassHint =
        ` To bypass this check (e.g. after restoring a backup where the migration ` +
        `tracking table was wiped), set OMNIROUTE_MAX_PENDING_MIGRATIONS=0 in your ` +
        `server.env or DATA_DIR/.env and restart.`;
      const msg =
        `[Migration] 🛑 ABORT: Detected ${actionablePending.length} pending migrations on an existing database ` +
        `(threshold is ${maxPendingMigrations}). ` +
        `This usually means the migration tracking table was accidentally wiped. ` +
        `Running all migrations from scratch will cause data loss or schema errors.` +
        schemaHint +
        bypassHint;

      // #6260: memoize so the cascade of downstream ensureDbInitialized() calls
      // that re-open the DB throw the SAME instance and only log once.
      if (memoizedSafetyAbort && memoizedSafetyAbort.message === msg) {
        console.error(
          `[Migration] 🛑 ABORT (repeat — see earlier detail): ` +
            `${actionablePending.length} pending > threshold ${maxPendingMigrations}. ` +
            `Set OMNIROUTE_MAX_PENDING_MIGRATIONS=0 to bypass.`
        );
        throw memoizedSafetyAbort;
      }
      console.error(msg);
      memoizedSafetyAbort = new MigrationSafetyAbortError(msg);
      throw memoizedSafetyAbort;
    }
  }

  // ── Safety Check 3: Pre-migration backup ──
  // Skip backup if it's a completely fresh database (0 applied and all pending)
  // or if running in tests (where AUTO_BACKUP might be disabled)
  if (applied.size > 0 && process.env.DISABLE_SQLITE_AUTO_BACKUP !== "true") {
    await createPreMigrationBackup(db);
  }

  let count = 0;

  for (const migration of pending) {
    if (await isDeferredUnsupportedMigration(db, migration)) {
      continue;
    }

    const applyMigration = db.transaction(async () => {
      if (await isSchemaAlreadyApplied(db, migration)) {
        console.warn(
          `[Migration] Skipped executing ${migration.version}_${migration.name} as schema changes are already present (Idempotency check).`
        );
      } else if (migration.version === "032") {
        await applyApiKeyLifecycleMigration(db);
      } else if (migration.version === "041" && migration.name === "compression_receipts") {
        await applyCompressionReceiptsMigration(db);
      } else if (migration.version === "042") {
        await applyCompressionCombosMigration(db, migration.path);
      } else {
        const sql = fs.readFileSync(migration.path, "utf-8");
        await db.exec(sql);
      }
      await db
        .prepare("INSERT INTO _omniroute_migrations (version, name) VALUES (?, ?)")
        .run(migration.version, migration.name);
    });

    try {
      await applyMigration();
      count++;
      console.log(`[Migration] Applied: ${migration.version}_${migration.name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // "duplicate column name" means the column already exists — end state achieved, mark applied.
      if (message.includes("duplicate column name")) {
        const applyMarkerOnly = db.transaction(async () => {
          await db
            .prepare("INSERT OR IGNORE INTO _omniroute_migrations (version, name) VALUES (?, ?)")
            .run(migration.version, migration.name);
        });
        await applyMarkerOnly();
        count++;
        console.log(
          `[Migration] Applied (column pre-exists): ${migration.version}_${migration.name}`
        );
      } else {
        console.error(`[Migration] FAILED: ${migration.version}_${migration.name} — ${message}`);
        throw err; // Re-throw to prevent DB from starting in inconsistent state
      }
    }
  }

  if (count > 0) {
    console.log(`[Migration] ${count} migration(s) applied successfully.`);
  }

  // After applying all migrations, insert default settings if we just ran migration 46
  try {
    if (appliedRecords.some((m) => m.name.startsWith("051_"))) {
      await insertDefaultDatabaseSettings(db);
    }
  } catch (error) {
    console.error("Error inserting default database settings:", error);
  }

  return count;
}

async function insertDefaultDatabaseSettings(db: SqliteAdapter) {
  const tx = db.transaction(async () => {
    // Insert all default settings
    for (const [section, values] of Object.entries(DEFAULT_DATABASE_SETTINGS)) {
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        await db
          .prepare("INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
          .run("databaseSettings", `${section}.${key}`, JSON.stringify(value));
      }
    }
  });

  // Run in an immediate transaction to avoid nested transactions
  try {
    await db.immediate(async () => {
      await tx();
    });
  } catch (error) {
    console.error("Transaction error inserting default settings:", error);
    throw error;
  }
}

/**
 * Get migration status for diagnostics.
 */
export async function getMigrationStatus(db: SqliteAdapter): Promise<{
  applied: Array<{ version: string; name: string; applied_at: string }>;
  pending: Array<{ version: string; name: string }>;
}> {
  await ensureMigrationsTable(db);

  const appliedRows = (await db
    .prepare("SELECT version, name, applied_at FROM _omniroute_migrations ORDER BY version")
    .all()) as Array<{ version: string; name: string; applied_at: string }>;

  const appliedVersions = new Set(appliedRows.map((r) => r.version));
  const allFiles = getMigrationFiles();
  const pending = allFiles.filter((f) => !appliedVersions.has(f.version));

  return { applied: appliedRows, pending };
}
