import { getAsyncDb } from "./core";

export type ModelCapabilityOverrideKey = "max_token";

export interface ModelCapabilityOverride {
  provider: string;
  modelId: string;
  target: string;
  key: ModelCapabilityOverrideKey;
  value: number;
  refreshedAt: string;
}

interface OverrideRow {
  provider: string;
  model_id: string;
  override_key: string;
  override_value: string;
  refreshed_at: string;
}

function isSupportedKey(value: unknown): value is ModelCapabilityOverrideKey {
  return value === "max_token";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Drop the process-level capability memo after an override write.
 *
 * `modelCapabilities.ts` imports this module, so a static import back would
 * create a cycle; a runtime dynamic import keeps the dependency one-way.
 */
async function invalidateCapabilityCache(): Promise<void> {
  try {
    const caps = await import("../modelCapabilities");
    caps.invalidateResolvedCapabilityCache();
  } catch {
    // Capability cache is optional (e.g. tree-shaken callers); a failed lookup
    // must never block the override write itself.
  }
}

export function parseModelOverrideTarget(
  target: unknown
): { provider: string; modelId: string } | null {
  const raw = typeof target === "string" ? target.trim() : "";
  const slashIndex = raw.indexOf("/");
  if (slashIndex <= 0 || slashIndex === raw.length - 1) return null;

  const provider = raw.slice(0, slashIndex).trim();
  const modelId = raw.slice(slashIndex + 1).trim();
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

function toOverride(row: OverrideRow): ModelCapabilityOverride | null {
  if (!isSupportedKey(row.override_key)) return null;

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(row.override_value);
  } catch {
    return null;
  }

  if (!isPositiveInteger(parsedValue)) return null;

  return {
    provider: row.provider,
    modelId: row.model_id,
    target: `${row.provider}/${row.model_id}`,
    key: row.override_key,
    value: parsedValue,
    refreshedAt: row.refreshed_at,
  };
}

export async function getModelCapabilityOverride(
  provider: string | null | undefined,
  modelId: string | null | undefined,
  key: ModelCapabilityOverrideKey
): Promise<number | null> {
  const target = parseModelOverrideTarget(`${provider || ""}/${modelId || ""}`);
  if (!target || !isSupportedKey(key)) return null;

  try {
    const row = (await getAsyncDb()
      .prepare(
        "SELECT provider, model_id, override_key, override_value, refreshed_at " +
          "FROM model_capability_overrides WHERE provider = ? AND model_id = ? AND override_key = ?"
      )
      .get(target.provider, target.modelId, key)) as OverrideRow | undefined;
    const override = row ? toOverride(row) : null;
    return override?.value ?? null;
  } catch {
    return null;
  }
}

export async function setModelCapabilityOverride(
  target: string,
  key: ModelCapabilityOverrideKey,
  value: number
): Promise<boolean> {
  const parsedTarget = parseModelOverrideTarget(target);
  if (!parsedTarget || !isSupportedKey(key) || !isPositiveInteger(value)) return false;

  await getAsyncDb()
    .prepare(
      "INSERT OR REPLACE INTO model_capability_overrides " +
        "(provider, model_id, override_key, override_value, refreshed_at) " +
        "VALUES (?, ?, ?, ?, datetime('now'))"
    )
    .run(parsedTarget.provider, parsedTarget.modelId, key, JSON.stringify(value));
  await invalidateCapabilityCache();
  return true;
}

export async function removeModelCapabilityOverride(
  target: string,
  key: ModelCapabilityOverrideKey
): Promise<boolean> {
  const parsedTarget = parseModelOverrideTarget(target);
  if (!parsedTarget || !isSupportedKey(key)) return false;

  const info = await getAsyncDb()
    .prepare(
      "DELETE FROM model_capability_overrides " +
        "WHERE provider = ? AND model_id = ? AND override_key = ?"
    )
    .run(parsedTarget.provider, parsedTarget.modelId, key);
  if (info.changes > 0) await invalidateCapabilityCache();
  return info.changes > 0;
}

export async function listModelCapabilityOverrides(): Promise<ModelCapabilityOverride[]> {
  try {
    const rows = (await getAsyncDb()
      .prepare(
        "SELECT provider, model_id, override_key, override_value, refreshed_at " +
          "FROM model_capability_overrides ORDER BY refreshed_at DESC"
      )
      .all()) as OverrideRow[];
    return rows.map(toOverride).filter((entry): entry is ModelCapabilityOverride => entry !== null);
  } catch {
    return [];
  }
}
