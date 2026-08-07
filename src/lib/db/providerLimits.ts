import { getDbInstance, isBuildPhase, isCloud, getAsyncDb } from "./core";
import type { DatabaseAdapter } from "./adapters/types";

type JsonRecord = Record<string, unknown>;

interface StatementLike<TRow = unknown> {
  all: (...params: unknown[]) => TRow[];
  get: (...params: unknown[]) => TRow | undefined;
  run: (...params: unknown[]) => { changes?: number };
}

interface DbLike {
  prepare: <TRow = unknown>(sql: string) => StatementLike<TRow>;
  transaction: <T extends (...args: any[]) => unknown>(fn: T) => T;
}

interface KeyValueRow {
  key: string;
  value: string;
}

export interface ProviderLimitsCacheEntry {
  quotas: JsonRecord | null;
  plan: unknown;
  message: string | null;
  fetchedAt: string;
  source?: string | null;
  bankedResetCredits?: number;
}

const PROVIDER_LIMITS_CACHE_NAMESPACE = "providerLimitsCache";

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function normalizeCacheEntry(value: unknown): ProviderLimitsCacheEntry | null {
  const record = toRecord(value);
  if (!record) return null;

  const fetchedAt =
    typeof record.fetchedAt === "string" && record.fetchedAt.trim() ? record.fetchedAt : null;
  if (!fetchedAt) return null;

  const bankedResetCredits = Number(record.bankedResetCredits);

  return {
    quotas: toRecord(record.quotas),
    plan: record.plan ?? null,
    message: typeof record.message === "string" ? record.message : null,
    fetchedAt,
    source: typeof record.source === "string" ? record.source : null,
    ...(Number.isFinite(bankedResetCredits) ? { bankedResetCredits } : {}),
  };
}

export async function getProviderLimitsCache(
  connectionId: string
): Promise<ProviderLimitsCacheEntry | null> {
  if (isBuildPhase || isCloud) return null;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const row = (await db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(PROVIDER_LIMITS_CACHE_NAMESPACE, connectionId)) as KeyValueRow | undefined;
  if (!row?.value) return null;
  return normalizeCacheEntry(parseJson(row.value));
}

export async function getAllProviderLimitsCache(): Promise<
  Record<string, ProviderLimitsCacheEntry>
> {
  if (isBuildPhase || isCloud) return {};
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const rows = (await db
    .prepare("SELECT key, value FROM key_value WHERE namespace = ?")
    .all(PROVIDER_LIMITS_CACHE_NAMESPACE)) as KeyValueRow[];

  const result: Record<string, ProviderLimitsCacheEntry> = {};
  for (const row of rows) {
    const parsed = normalizeCacheEntry(parseJson(row.value));
    if (parsed) {
      result[row.key] = parsed;
    }
  }
  return result;
}

export async function setProviderLimitsCache(
  connectionId: string,
  entry: ProviderLimitsCacheEntry
): Promise<ProviderLimitsCacheEntry> {
  if (isBuildPhase || isCloud) return entry;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(PROVIDER_LIMITS_CACHE_NAMESPACE, connectionId, JSON.stringify(entry));
  return entry;
}

export async function setProviderLimitsCacheBatch(
  entries: Array<{ connectionId: string; entry: ProviderLimitsCacheEntry }>
): Promise<number> {
  if (isBuildPhase || isCloud || entries.length === 0) return 0;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const insert = await db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)"
  );
  const tx = db.transaction(
    (items: Array<{ connectionId: string; entry: ProviderLimitsCacheEntry }>) => {
      for (const item of items) {
        insert.run(PROVIDER_LIMITS_CACHE_NAMESPACE, item.connectionId, JSON.stringify(item.entry));
      }
    }
  );
  tx(entries);
  return entries.length;
}

export async function deleteProviderLimitsCache(connectionId: string): Promise<void> {
  if (isBuildPhase || isCloud) return;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db
    .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
    .run(PROVIDER_LIMITS_CACHE_NAMESPACE, connectionId);
}
