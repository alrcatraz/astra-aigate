/** Persists and retrieves the model list synced from embedded services (9router, etc.). */

import { getDbInstance, getAsyncDb } from "./core";

const NAMESPACE = "serviceModels";

export interface ServiceModel {
  id: string;
  name?: string;
  object?: string;
  owned_by?: string;
  created?: number;
  available?: boolean;
  [key: string]: unknown;
}

export async function getServiceModels(tool: string): Promise<ServiceModel[]> {
  const db = getAsyncDb();
  const row = (await db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(NAMESPACE, tool)) as { value: string } | undefined;
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persist a new model list for a tool, with soft-delete pruning.
 *
 * Models present in the new payload are UPSERTed with `available: true`.
 * Models that were previously stored but are missing from the new payload
 * are marked `available: false` (not deleted — preserves history).
 */
export async function saveServiceModels(tool: string, models: ServiceModel[]): Promise<void> {
  const db = getAsyncDb();

  // Load existing stored models to compute the diff.
  const existing = await getServiceModels(tool);
  const incomingIds = new Set(models.map((m) => m.id));

  // Mark incoming models as available, and pruned ones as unavailable.
  const incomingWithFlag: ServiceModel[] = models.map((m) => ({ ...m, available: true }));
  const pruned: ServiceModel[] = existing
    .filter((m) => !incomingIds.has(m.id))
    .map((m) => ({ ...m, available: false }));

  const merged = [...incomingWithFlag, ...pruned];

  if (merged.length === 0) {
    await db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run(NAMESPACE, tool);
  } else {
    await db
      .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
      .run(NAMESPACE, tool, JSON.stringify(merged));
  }
}

/**
 * Mark all stored models for a tool as unavailable.
 * Called when the supervisor transitions to stopped or error state so the
 * model catalog reflects that none of the models are currently reachable.
 */
export async function markAllUnavailable(tool: string): Promise<void> {
  const existing = await getServiceModels(tool);
  if (existing.length === 0) return;
  const db = getAsyncDb();
  const updated: ServiceModel[] = existing.map((m) => ({ ...m, available: false }));
  await db
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run(NAMESPACE, tool, JSON.stringify(updated));
}
