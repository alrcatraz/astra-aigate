/**
 * db/featureFlags.ts — Feature flag DB overrides.
 *
 * Stores per-flag override values in the key_value table under the
 * "feature_flags" namespace. When an override is present it takes precedence
 * over the process environment variable of the same name.
 */

import { FEATURE_FLAG_DEFINITIONS } from "@/shared/constants/featureFlagDefinitions";
import { getDbInstance, getAsyncDb } from "./core";
import type { RawSyncDb } from "./adapters/types";

const NAMESPACE = "feature_flags";

/**
 * Returns all feature flag overrides as a key→value map.
 */
export async function getFeatureFlagOverrides(): Promise<Record<string, string>> {
  const db = getAsyncDb();
  const rows = (await db
    .prepare("SELECT key, value FROM key_value WHERE namespace = ?")
    .all(NAMESPACE)) as Array<{ key: string; value: string }>;

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Returns the override value for a single flag, or undefined if no override
 * is stored.
 *
 * Kept synchronous because callers (guardrail paths) are on a sync chain.
 * SQLite mode reads the live DB via the sync handle; PostgreSQL has no
 * synchronous driver, so sync reads are unavailable there — returns
 * undefined (env fallback), matching pre-PG behaviour for non-sqlite backends.
 */
export function getFeatureFlagOverride(key: string): string | undefined {
  try {
    const db = getAsyncDb() as unknown as { raw: RawSyncDb };
    const row = db.raw
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get(NAMESPACE, key) as { value: string } | undefined;
    return row?.value;
  } catch {
    return undefined;
  }
}

/**
 * Persists (or replaces) an override for a single flag.
 */
export function setFeatureFlagOverride(key: string, value: string): void {
  const definition = FEATURE_FLAG_DEFINITIONS.find((d) => d.key === key);
  if (!definition) {
    throw new Error(`Unknown feature flag key: ${key}`);
  }
  if (
    definition.type === "enum" &&
    definition.enumValues &&
    !definition.enumValues.includes(value)
  ) {
    throw new Error(
      `Invalid value "${value}" for enum flag ${key}. Allowed: ${definition.enumValues.join(", ")}`
    );
  }
  const db = getAsyncDb() as unknown as { raw: RawSyncDb };
  db.raw
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(NAMESPACE, key, value);
}

/**
 * Removes the override for a single flag, restoring env-var / default
 * behaviour.
 */
export async function removeFeatureFlagOverride(key: string): Promise<void> {
  const db = getAsyncDb() as unknown as { raw: RawSyncDb };
  await db.raw.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run(NAMESPACE, key);
}

/**
 * Removes all stored feature flag overrides.
 */
export async function clearAllFeatureFlagOverrides(): Promise<void> {
  const db = getAsyncDb() as unknown as { raw: RawSyncDb };
  await db.raw.prepare("DELETE FROM key_value WHERE namespace = ?").run(NAMESPACE);
}
