import { normalizeComboStep } from "@/lib/combos/steps";
import { tableExists } from "./core";

import type { SqliteAdapter } from "./adapters/types";
type SqliteDatabase = SqliteAdapter;
type JsonRecord = Record<string, unknown>;

export type DbHealthIssueType =
  "integrity_check_failed" | "broken_reference" | "stale_snapshot" | "invalid_state";

export interface DbHealthIssue {
  type: DbHealthIssueType;
  table: string;
  description: string;
  count: number;
}

export interface DbHealthCheckResult {
  isHealthy: boolean;
  issues: DbHealthIssue[];
  repairedCount: number;
  backupCreated: boolean;
  autoRepair: boolean;
  checkedAt: string;
}

interface RunDbHealthCheckOptions {
  autoRepair?: boolean;
  createBackupBeforeRepair?: () => boolean | Promise<boolean>;
  expectedSchemaVersion?: string;
  /**
   * Skip `PRAGMA quick_check` during this run.
   * Set via env var `OMNIROUTE_SKIP_DB_HEALTHCHECK=1`.
   * On slow storage (HDD under I/O contention) quick_check can block the
   * Node.js event loop for minutes. The DB is implicitly validated by
   * opening it, applying the schema, and running migrations — if corruption
   * existed, those operations would fail first.
   */
  skipIntegrityCheck?: boolean;
}

interface ComboRow {
  id: string;
  name: string;
  data: string;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ComboRepairResult {
  issueCount: number;
  repairedCount: number;
}

interface QuotaSnapshotRow {
  id?: number;
  provider?: string | null;
  connection_id?: string | null;
  created_at?: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function toTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseJsonRecord(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

async function hasRows(db: SqliteDatabase, table: string): Promise<boolean> {
  // PG-aware existence check (shared helper delegates to information_schema in
  // PG mode; bare sqlite_master does not exist there).
  return tableExists(table, db);
}

async function hasProviderConnection(db: SqliteDatabase, connectionId: string): Promise<boolean> {
  const row = (await db
    .prepare("SELECT 1 AS ok FROM provider_connections WHERE id = ? LIMIT 1")
    .get(connectionId)) as { ok?: number } | undefined;
  return row?.ok === 1;
}

function isValidIsoTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  return !Number.isNaN(Date.parse(value));
}

function buildRepairNote(message: string, checkedAt: string): string {
  return `[db-health:${checkedAt}] ${message}`;
}

function buildDisabledCombo(row: ComboRow, checkedAt: string): JsonRecord {
  const now = checkedAt;
  return {
    id: row.id,
    name: row.name,
    version: 2,
    strategy: "priority",
    models: [],
    config: {},
    isActive: false,
    isHidden: false,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    createdAt: row.created_at || now,
    updatedAt: now,
    repairNote: buildRepairNote("Combo payload was rebuilt after invalid JSON was detected.", now),
  };
}

function normalizeComboModels(models: unknown): unknown[] {
  return Array.isArray(models) ? models : [];
}

async function repairComboRows(
  db: SqliteDatabase,
  rows: ComboRow[],
  checkedAt: string,
  options: { autoRepair: boolean }
): Promise<ComboRepairResult> {
  if (rows.length === 0) return { issueCount: 0, repairedCount: 0 };

  const existingComboNames = new Set(rows.map((row) => row.name));
  let issueCount = 0;
  let repairedCount = 0;

  const updateComboStmt = db.prepare("UPDATE combos SET data = ?, updated_at = ? WHERE id = ?");

  for (const row of rows) {
    const parsed = parseJsonRecord(row.data);
    if (!parsed) {
      issueCount += 1;
      if (options.autoRepair) {
        const repaired = buildDisabledCombo(row, checkedAt);
        updateComboStmt.run(JSON.stringify(repaired), checkedAt, row.id);
        repairedCount += 1;
      }
      continue;
    }

    const currentModels = normalizeComboModels(parsed.models);
    if (currentModels.length === 0) continue;

    const nextModels: unknown[] = [];
    let removedSteps = 0;
    let clearedConnectionPins = 0;
    let normalizedLegacyComboRefs = 0;

    for (const [index, rawStep] of currentModels.entries()) {
      if (!isRecord(rawStep)) {
        if (typeof rawStep === "string") {
          const normalizedStep = normalizeComboStep(rawStep, {
            comboName: row.name,
            index,
            allCombos: existingComboNames,
          });
          if (normalizedStep?.kind === "combo-ref") {
            if (
              normalizedStep.comboName === row.name ||
              !existingComboNames.has(normalizedStep.comboName)
            ) {
              removedSteps += 1;
              continue;
            }
            nextModels.push(normalizedStep);
            normalizedLegacyComboRefs += 1;
            continue;
          }
        }
        nextModels.push(rawStep);
        continue;
      }

      if (rawStep.kind === "combo-ref") {
        const comboName = toTrimmedString(rawStep.comboName);
        if (!comboName || comboName === row.name || !existingComboNames.has(comboName)) {
          removedSteps += 1;
          continue;
        }
        nextModels.push(rawStep);
        continue;
      }

      const connectionId = toTrimmedString(rawStep.connectionId);
      if (connectionId && !(await hasProviderConnection(db, connectionId))) {
        const repairedStep = { ...rawStep };
        delete repairedStep.connectionId;
        nextModels.push(repairedStep);
        clearedConnectionPins += 1;
        continue;
      }

      nextModels.push(rawStep);
    }

    if (removedSteps === 0 && clearedConnectionPins === 0 && normalizedLegacyComboRefs === 0) {
      continue;
    }

    issueCount += removedSteps + clearedConnectionPins + normalizedLegacyComboRefs;
    if (!options.autoRepair) continue;

    const nextCombo = {
      ...parsed,
      models: nextModels,
      updatedAt: checkedAt,
      repairNote: buildRepairNote(
        [
          removedSteps > 0 ? `${removedSteps} broken combo step(s) removed.` : null,
          clearedConnectionPins > 0
            ? `${clearedConnectionPins} missing connection pin(s) cleared.`
            : null,
          normalizedLegacyComboRefs > 0
            ? `${normalizedLegacyComboRefs} legacy combo ref step(s) canonicalized.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
        checkedAt
      ),
      ...(nextModels.length === 0 ? { isActive: false } : {}),
    };

    await updateComboStmt.run(JSON.stringify(nextCombo), checkedAt, row.id);
    repairedCount += removedSteps + clearedConnectionPins + normalizedLegacyComboRefs;
  }

  return { issueCount, repairedCount };
}

async function getBrokenQuotaSnapshotRowIds(db: SqliteDatabase): Promise<number[]> {
  if (!(await hasRows(db, "quota_snapshots"))) return [];

  const brokenRowIds = new Set<number>();
  const rows = (await db
    .prepare("SELECT id, provider, connection_id, created_at FROM quota_snapshots")
    .all()) as QuotaSnapshotRow[];

  for (const row of rows) {
    const connectionId = toTrimmedString(row.connection_id);
    const missingConnection = !!connectionId && !hasProviderConnection(db, connectionId);
    const invalidTimestamp = !isValidIsoTimestamp(row.created_at);
    if ((missingConnection || invalidTimestamp) && typeof row.id === "number") {
      brokenRowIds.add(row.id);
    }
  }

  return Array.from(brokenRowIds);
}

async function countOrphanQuotaSnapshots(db: SqliteDatabase): Promise<number> {
  return (await getBrokenQuotaSnapshotRowIds(db)).length;
}

async function repairQuotaSnapshots(db: SqliteDatabase): Promise<number> {
  if (!(await hasRows(db, "quota_snapshots"))) return 0;
  const brokenRowIds = await getBrokenQuotaSnapshotRowIds(db);
  if (brokenRowIds.length === 0) return 0;

  const deleteByRowId = db.prepare("DELETE FROM quota_snapshots WHERE id = ?");
  let repaired = 0;
  for (const rowId of brokenRowIds) {
    repaired += (await deleteByRowId.run(rowId)).changes;
  }
  return repaired;
}

async function countOrphanDomainRows(
  db: SqliteDatabase,
  table: "domain_budgets" | "domain_cost_history"
) {
  if (!(await hasRows(db, table))) return 0;
  const row = (await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM ${table}
       WHERE api_key_id NOT IN (SELECT id FROM api_keys)`
    )
    .get()) as { count?: number } | undefined;
  return row?.count || 0;
}

async function repairOrphanDomainRows(
  db: SqliteDatabase,
  table: "domain_budgets" | "domain_cost_history"
): Promise<number> {
  if (!(await hasRows(db, table))) return 0;
  return (
    await db.prepare(`DELETE FROM ${table} WHERE api_key_id NOT IN (SELECT id FROM api_keys)`).run()
  ).changes;
}

async function countInvalidJsonRows(
  db: SqliteDatabase,
  table: "domain_fallback_chains" | "domain_lockout_state" | "domain_circuit_breakers",
  column: "chain" | "attempts" | "options"
): Promise<number> {
  if (!(await hasRows(db, table))) return 0;
  const rows = (await db.prepare(`SELECT ${column} FROM ${table}`).all()) as Array<
    Record<string, unknown>
  >;
  let invalid = 0;
  for (const row of rows) {
    const raw = row[column];
    if (raw == null && column === "options") continue;
    if (typeof raw !== "string") {
      invalid += 1;
      continue;
    }
    try {
      JSON.parse(raw);
    } catch {
      invalid += 1;
    }
  }
  return invalid;
}

async function repairInvalidJsonRows(
  db: SqliteDatabase,
  table: "domain_fallback_chains" | "domain_lockout_state" | "domain_circuit_breakers",
  column: "chain" | "attempts" | "options"
): Promise<number> {
  if (!(await hasRows(db, table))) return 0;

  const rows = (await db.prepare(`SELECT rowid, ${column} FROM ${table}`).all()) as Array<{
    rowid: number;
    [key: string]: unknown;
  }>;

  const deleteByRowId = db.prepare(`DELETE FROM ${table} WHERE rowid = ?`);
  const clearOptionsByRowId = db.prepare(
    "UPDATE domain_circuit_breakers SET options = NULL WHERE rowid = ?"
  );
  let repaired = 0;

  for (const row of rows) {
    const raw = row[column];
    if (raw == null && table === "domain_circuit_breakers") {
      continue;
    }
    if (typeof raw !== "string") {
      if (table === "domain_circuit_breakers") {
        repaired += (await clearOptionsByRowId.run(row.rowid)).changes;
        continue;
      }
      await deleteByRowId.run(row.rowid);
      repaired += 1;
      continue;
    }
    try {
      JSON.parse(raw);
    } catch {
      if (table === "domain_circuit_breakers") {
        repaired += (await clearOptionsByRowId.run(row.rowid)).changes;
        continue;
      }
      await deleteByRowId.run(row.rowid);
      repaired += 1;
    }
  }

  return repaired;
}

async function getSchemaVersionIssueCount(
  db: SqliteDatabase,
  expectedSchemaVersion: string
): Promise<number> {
  if (!(await hasRows(db, "db_meta"))) return 0;
  const row = (await db.prepare("SELECT value FROM db_meta WHERE key = 'schema_version'").get()) as
    { value?: string | null } | undefined;
  const current = typeof row?.value === "string" ? row.value : null;
  return current === expectedSchemaVersion ? 0 : 1;
}

async function repairSchemaVersion(
  db: SqliteDatabase,
  expectedSchemaVersion: string
): Promise<number> {
  if (!(await hasRows(db, "db_meta"))) return 0;
  return (
    await db
      .prepare("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('schema_version', ?)")
      .run(expectedSchemaVersion)
  ).changes;
}

export async function runDbHealthCheck(
  db: SqliteDatabase,
  options: RunDbHealthCheckOptions = {}
): Promise<DbHealthCheckResult> {
  const autoRepair = options.autoRepair === true;
  const expectedSchemaVersion = options.expectedSchemaVersion || "1";
  const checkedAt = new Date().toISOString();
  const issues: DbHealthIssue[] = [];
  let repairedCount = 0;
  let backupCreated = false;
  let backupAttempted = false;

  const ensureBackupBeforeRepair = async () => {
    if (!autoRepair || backupAttempted || typeof options.createBackupBeforeRepair !== "function") {
      return;
    }
    backupAttempted = true;
    backupCreated = await options.createBackupBeforeRepair();
  };

  // Use quick_check instead of integrity_check on startup — integrity_check
  // does a full page-by-page scan that can take minutes on a fragmented WAL,
  // causing 7+ minute boot times. quick_check still catches corruption but
  // skips deep index verification, reducing I/O to seconds.
  // Skip entirely when skipIntegrityCheck is set (env OMNIROUTE_SKIP_DB_HEALTHCHECK=1).
  if (!options.skipIntegrityCheck) {
    const integrityCheck = (await db.pragma("quick_check")) as Array<{ quick_check?: string }>;
    if (integrityCheck[0]?.quick_check !== "ok") {
      issues.push({
        type: "integrity_check_failed",
        table: "sqlite",
        description: "SQLite integrity_check returned a non-ok status.",
        count: 1,
      });
    }
  }

  if (await hasRows(db, "combos")) {
    const comboRows = (await db
      .prepare(
        "SELECT id, name, data, sort_order, created_at, updated_at FROM combos ORDER BY name COLLATE NOCASE ASC"
      )
      .all()) as ComboRow[];
    const comboRepair = await repairComboRows(db, comboRows, checkedAt, { autoRepair });
    if (comboRepair.issueCount > 0) {
      issues.push({
        type: "broken_reference",
        table: "combos",
        description:
          "Combos contained broken combo references, legacy combo refs, invalid JSON, or pinned connections that no longer exist.",
        count: comboRepair.issueCount,
      });
      if (autoRepair) {
        await ensureBackupBeforeRepair();
        repairedCount += comboRepair.repairedCount;
      }
    }
  }

  const orphanQuotaCount = await countOrphanQuotaSnapshots(db);
  if (orphanQuotaCount > 0) {
    issues.push({
      type: "stale_snapshot",
      table: "quota_snapshots",
      description:
        "Quota snapshots referenced missing connections or contained invalid timestamps.",
      count: orphanQuotaCount,
    });
    if (autoRepair) {
      await ensureBackupBeforeRepair();
      repairedCount += await repairQuotaSnapshots(db);
    }
  }

  const orphanBudgets = await countOrphanDomainRows(db, "domain_budgets");
  if (orphanBudgets > 0) {
    issues.push({
      type: "broken_reference",
      table: "domain_budgets",
      description: "Domain budgets referenced API keys that no longer exist.",
      count: orphanBudgets,
    });
    if (autoRepair) {
      await ensureBackupBeforeRepair();
      repairedCount += await repairOrphanDomainRows(db, "domain_budgets");
    }
  }

  const orphanCostHistory = await countOrphanDomainRows(db, "domain_cost_history");
  if (orphanCostHistory > 0) {
    issues.push({
      type: "broken_reference",
      table: "domain_cost_history",
      description: "Domain cost history referenced API keys that no longer exist.",
      count: orphanCostHistory,
    });
    if (autoRepair) {
      await ensureBackupBeforeRepair();
      repairedCount += await repairOrphanDomainRows(db, "domain_cost_history");
    }
  }

  const invalidFallbackChains = await countInvalidJsonRows(db, "domain_fallback_chains", "chain");
  if (invalidFallbackChains > 0) {
    issues.push({
      type: "invalid_state",
      table: "domain_fallback_chains",
      description: "Fallback chain rows contained invalid JSON payloads.",
      count: invalidFallbackChains,
    });
    if (autoRepair) {
      await ensureBackupBeforeRepair();
      repairedCount += await repairInvalidJsonRows(db, "domain_fallback_chains", "chain");
    }
  }

  const invalidLockoutState = await countInvalidJsonRows(db, "domain_lockout_state", "attempts");
  if (invalidLockoutState > 0) {
    issues.push({
      type: "invalid_state",
      table: "domain_lockout_state",
      description: "Lockout state rows contained invalid JSON payloads.",
      count: invalidLockoutState,
    });
    if (autoRepair) {
      await ensureBackupBeforeRepair();
      repairedCount += await repairInvalidJsonRows(db, "domain_lockout_state", "attempts");
    }
  }

  const invalidBreakerOptions = await countInvalidJsonRows(
    db,
    "domain_circuit_breakers",
    "options"
  );
  if (invalidBreakerOptions > 0) {
    issues.push({
      type: "invalid_state",
      table: "domain_circuit_breakers",
      description: "Circuit breaker option payloads were invalid JSON.",
      count: invalidBreakerOptions,
    });
    if (autoRepair) {
      await ensureBackupBeforeRepair();
      repairedCount += await repairInvalidJsonRows(db, "domain_circuit_breakers", "options");
    }
  }

  const schemaVersionIssues = await getSchemaVersionIssueCount(db, expectedSchemaVersion);
  if (schemaVersionIssues > 0) {
    issues.push({
      type: "invalid_state",
      table: "db_meta",
      description: `db_meta.schema_version did not match expected version ${expectedSchemaVersion}.`,
      count: schemaVersionIssues,
    });
    if (autoRepair) {
      await ensureBackupBeforeRepair();
      repairedCount += await repairSchemaVersion(db, expectedSchemaVersion);
    }
  }

  return {
    isHealthy: issues.length === 0,
    issues,
    repairedCount,
    backupCreated,
    autoRepair,
    checkedAt,
  };
}
