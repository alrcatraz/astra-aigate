import fs from "node:fs";

import { DEFAULT_DATABASE_SETTINGS, type DatabaseSettings } from "@/types/databaseSettings";

import { backupDbFile } from "./backup";
import {
  DATA_DIR,
  SQLITE_FILE,
  applyDatabaseOptimizationSettings,
  getDbInstance,
  getAsyncDb,
} from "./core";
import { invalidateDbCache } from "./readCache";
import { getDatabaseStats } from "./stats";
import { getState as getVacuumSchedulerState, refreshVacuumScheduler } from "./vacuumScheduler";

const DATABASE_SETTINGS_NAMESPACE = "databaseSettings";

export type UserDatabaseSettings = Omit<DatabaseSettings, "location" | "stats">;
type DatabaseSettingsSection = keyof UserDatabaseSettings;

const DATABASE_SETTINGS_SECTIONS = Object.keys(
  DEFAULT_DATABASE_SETTINGS
) as DatabaseSettingsSection[];

const LEGACY_FLAT_KEYS: {
  [TSection in DatabaseSettingsSection]: Partial<
    Record<keyof UserDatabaseSettings[TSection] & string, string[]>
  >;
} = {
  logs: {
    detailedLogsEnabled: ["detailedLogsEnabled"],
    callLogPipelineEnabled: ["callLogPipelineEnabled"],
    maxDetailSizeKb: ["maxDetailSizeKb"],
    ringBufferSize: ["ringBufferSize"],
  },
  backup: {
    autoBackupEnabled: ["autoBackupEnabled"],
    autoBackupFrequency: ["autoBackupFrequency"],
    keepLastNBackups: ["keepLastNBackups"],
  },
  cache: {
    semanticCacheEnabled: ["semanticCacheEnabled"],
    semanticCacheMaxSize: ["semanticCacheMaxSize"],
    semanticCacheTTL: ["semanticCacheTTL"],
    promptCacheEnabled: ["promptCacheEnabled"],
    promptCacheStrategy: ["promptCacheStrategy"],
    alwaysPreserveClientCache: ["alwaysPreserveClientCache"],
    modelCatalogCacheTtlMs: ["modelCatalogCacheTtlMs"],
  },
  retention: {
    quotaSnapshots: ["quotaSnapshots"],
    compressionAnalytics: ["compressionAnalytics"],
    mcpAudit: ["mcpAudit"],
    a2aEvents: ["a2aEvents"],
    callLogs: ["callLogs"],
    usageHistory: ["usageHistory"],
    memoryEntries: ["memoryEntries"],
    domainCostHistory: ["domainCostHistory"],
    compressionCacheStats: ["compressionCacheStats"],
    xpAuditLog: ["xpAuditLog"],
    compressionRunTelemetry: ["compressionRunTelemetry"],
    autoCleanupEnabled: ["autoCleanupEnabled"],
  },
  aggregation: {
    enabled: ["aggregationEnabled", "enabled"],
    rawDataRetentionDays: ["rawDataRetentionDays"],
    granularity: ["granularity"],
  },
  optimization: {
    autoVacuumMode: ["autoVacuumMode"],
    scheduledVacuum: ["scheduledVacuum"],
    vacuumHour: ["vacuumHour"],
    pageSize: ["pageSize"],
    cacheSize: ["cacheSize"],
    optimizeOnStartup: ["optimizeOnStartup"],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneDefaultSettings(): UserDatabaseSettings {
  return structuredClone(DEFAULT_DATABASE_SETTINGS) as UserDatabaseSettings;
}

function parseStoredValue(rawValue: unknown): unknown {
  if (typeof rawValue !== "string") return rawValue;

  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function toBooleanSetting(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return !Number.isNaN(value) && value !== 0;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function normalizeOptimizationSettings(settings: UserDatabaseSettings) {
  const fallback = DEFAULT_DATABASE_SETTINGS.optimization.cacheSize;
  const numericCacheSize = Number(settings.optimization.cacheSize);
  settings.optimization.cacheSize =
    Number.isFinite(numericCacheSize) && numericCacheSize > 0
      ? Math.min(1000000, Math.floor(numericCacheSize))
      : fallback;
}

async function readNamespace(namespace: string): Promise<Record<string, unknown>> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare("SELECT key, value FROM key_value WHERE namespace = ?")
    .all(namespace)) as Array<{ key: string; value: string }>;

  const values: Record<string, unknown> = {};
  for (const row of rows) {
    values[row.key] = parseStoredValue(row.value);
  }
  return values;
}

function mergeSectionObject(
  target: UserDatabaseSettings,
  section: DatabaseSettingsSection,
  value: unknown
) {
  if (!isRecord(value)) return;

  const sectionTarget = target[section] as Record<string, unknown>;
  const defaultSection = DEFAULT_DATABASE_SETTINGS[section] as Record<string, unknown>;

  for (const key of Object.keys(defaultSection)) {
    if (value[key] !== undefined) {
      sectionTarget[key] = value[key];
    }
  }
}

function mergeTopLevelSections(target: UserDatabaseSettings, values: Record<string, unknown>) {
  for (const section of DATABASE_SETTINGS_SECTIONS) {
    mergeSectionObject(target, section, values[section]);
  }
}

function mergeRuntimeLogSettings(target: UserDatabaseSettings, values: Record<string, unknown>) {
  const pipelineEnabled = toBooleanSetting(values.call_log_pipeline_enabled);
  if (pipelineEnabled !== null) {
    target.logs.callLogPipelineEnabled = pipelineEnabled;
  }

  const legacyDetailedEnabled = toBooleanSetting(values.detailed_logs_enabled);
  if (legacyDetailedEnabled !== null) {
    target.logs.detailedLogsEnabled = legacyDetailedEnabled;
  }
}

function mergeDatabaseSettingsNamespace(
  target: UserDatabaseSettings,
  values: Record<string, unknown>
) {
  for (const section of DATABASE_SETTINGS_SECTIONS) {
    const defaultSection = DEFAULT_DATABASE_SETTINGS[section] as Record<string, unknown>;
    const sectionTarget = target[section] as Record<string, unknown>;
    const flatAliases = LEGACY_FLAT_KEYS[section] as Partial<Record<string, string[]>>;

    for (const key of Object.keys(defaultSection)) {
      for (const alias of flatAliases[key] ?? []) {
        if (values[alias] !== undefined) {
          sectionTarget[key] = values[alias];
        }
      }

      const nestedKey = `${section}.${key}`;
      if (values[nestedKey] !== undefined) {
        sectionTarget[key] = values[nestedKey];
      }
    }
  }
}

function getWalSizeBytes(): number {
  if (!SQLITE_FILE) return 0;

  try {
    const walPath = `${SQLITE_FILE}-wal`;
    return fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  } catch {
    return 0;
  }
}

async function getSchemaVersion(): Promise<number> {
  const db = await getAsyncDb();

  try {
    const row = (await db
      .prepare("SELECT MAX(CAST(version AS INTEGER)) AS version FROM _omniroute_migrations")
      .get()) as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

async function getFreelistCount(): Promise<number> {
  try {
    return (await getAsyncDb().pragma("freelist_count", { simple: true })) as number;
  } catch {
    return 0;
  }
}

async function getIntegrityCheck(): Promise<"ok" | "error" | null> {
  try {
    const result = (await getAsyncDb().pragma("quick_check", { simple: true })) as string;
    return result === "ok" ? "ok" : "error";
  } catch {
    return null;
  }
}

export async function getUserDatabaseSettings(): Promise<UserDatabaseSettings> {
  const settings = cloneDefaultSettings();
  const mainSettings = await readNamespace("settings");
  const databaseSettingsValue = mainSettings[DATABASE_SETTINGS_NAMESPACE];

  if (isRecord(databaseSettingsValue)) {
    mergeTopLevelSections(settings, databaseSettingsValue);
  }

  mergeTopLevelSections(settings, mainSettings);
  mergeDatabaseSettingsNamespace(settings, await readNamespace(DATABASE_SETTINGS_NAMESPACE));
  mergeRuntimeLogSettings(settings, mainSettings);
  normalizeOptimizationSettings(settings);

  return settings;
}

export async function getDatabaseSettings(): Promise<DatabaseSettings> {
  const dbStats = await getDatabaseStats();
  const vacuumState = await getVacuumSchedulerState();

  return {
    ...(await getUserDatabaseSettings()),
    location: {
      databasePath: SQLITE_FILE ?? ":memory:",
      dataDir: DATA_DIR,
      walSizeBytes: getWalSizeBytes(),
      schemaVersion: await getSchemaVersion(),
    },
    stats: {
      databaseSizeBytes: dbStats.totalSize,
      pageCount: dbStats.pageCount,
      freelistCount: await getFreelistCount(),
      lastVacuumAt:
        vacuumState.lastRunAt !== null ? new Date(vacuumState.lastRunAt).toISOString() : null,
      lastOptimizationAt: null,
      integrityCheck: await getIntegrityCheck(),
    },
  };
}

export async function updateDatabaseSettings(
  updates: Partial<UserDatabaseSettings>
): Promise<UserDatabaseSettings> {
  const nextSettings = await getUserDatabaseSettings();
  const optimizationUpdated = (await updates.optimization) !== undefined;

  for (const section of DATABASE_SETTINGS_SECTIONS) {
    if (updates[section] !== undefined) {
      mergeSectionObject(nextSettings, section, updates[section]);
    }
  }
  normalizeOptimizationSettings(nextSettings);

  const db = await getAsyncDb();
  const insert = await db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)"
  );
  const settingsInsert = await db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('settings', ?, ?)"
  );

  const requestedLogs = (await updates.logs) as Partial<UserDatabaseSettings["logs"]> | undefined;
  const pipelineEnabled = requestedLogs?.callLogPipelineEnabled;
  const detailedEnabled = requestedLogs?.detailedLogsEnabled;

  const tx = await db.transaction(async () => {
    for (const section of DATABASE_SETTINGS_SECTIONS) {
      const sectionValues = nextSettings[section] as Record<string, unknown>;

      for (const [key, value] of Object.entries(sectionValues)) {
        await insert.run(DATABASE_SETTINGS_NAMESPACE, `${section}.${key}`, JSON.stringify(value));
      }
    }

    if (pipelineEnabled !== undefined) {
      await settingsInsert.run(
        "call_log_pipeline_enabled",
        JSON.stringify(Boolean(pipelineEnabled))
      );
    }
  });
  await tx();

  backupDbFile("pre-write");
  invalidateDbCache("settings");
  if (optimizationUpdated) {
    await applyDatabaseOptimizationSettings(nextSettings.optimization);
    await refreshVacuumScheduler();
  }

  return nextSettings;
}
