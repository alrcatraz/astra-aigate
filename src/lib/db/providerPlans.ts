/**
 * db/providerPlans.ts — CRUD for provider_plans table.
 *
 * Stores per-connection quota dimension plans (manual overrides or auto-
 * detected). dimensions_json is a JSON-serialized QuotaDimension[] array.
 * getPlan() and listPlans() parse it back to objects on read.
 *
 * All SQL is via prepared statements (Hard Rule #5).
 * Part of: Group B — Quota Sharing Engine (plan 22, frente F2).
 */

import { getDbInstance, getAsyncDb } from "./core";
import type { DatabaseAdapter } from "./adapters/types";

// ---------------------------------------------------------------------------
// Local type shapes (aligned with src/lib/quota/dimensions.ts — merged by F7)
// ---------------------------------------------------------------------------

type QuotaUnit = "percent" | "requests" | "tokens" | "usd";
type QuotaWindow = "5h" | "hourly" | "daily" | "weekly" | "monthly";

export interface QuotaDimension {
  unit: QuotaUnit;
  window: QuotaWindow;
  limit: number;
}

export interface ProviderPlan {
  connectionId: string | null;
  provider: string;
  dimensions: QuotaDimension[];
  source: "auto" | "manual";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface StatementLike<TRow = unknown> {
  all: (...params: unknown[]) => TRow[];
  get: (...params: unknown[]) => TRow | undefined;
  run: (...params: unknown[]) => { changes: number };
}

interface DbLike {
  prepare: <TRow = unknown>(sql: string) => StatementLike<TRow>;
}

function getDb(): DbLike {
  return getAsyncDb() as unknown as DbLike;
}

interface PlanRow {
  connection_id: string;
  provider: string;
  dimensions_json: string;
  source: string;
  updated_at: string;
}

function rowToPlan(row: PlanRow): ProviderPlan {
  let dimensions: QuotaDimension[] = [];
  try {
    dimensions = JSON.parse(row.dimensions_json) as QuotaDimension[];
  } catch {
    // Malformed JSON — return empty dimensions rather than throwing
    dimensions = [];
  }
  return {
    connectionId: row.connection_id,
    provider: row.provider,
    dimensions,
    source: row.source as "auto" | "manual",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the plan for a specific provider connection, or null if not found.
 * Parses dimensions_json into a typed QuotaDimension array.
 */
export async function getPlan(connectionId: string): Promise<ProviderPlan | null> {
  const row = await getDb()
    .prepare<PlanRow>(
      `SELECT connection_id, provider, dimensions_json, source, updated_at
       FROM provider_plans WHERE connection_id = ?`
    )
    .get(connectionId);
  if (!row) return null;
  return rowToPlan(row);
}

/**
 * List all provider plans stored in the DB.
 */
export async function listPlans(): Promise<ProviderPlan[]> {
  const rows = await getDb()
    .prepare<PlanRow>(
      `SELECT connection_id, provider, dimensions_json, source, updated_at
       FROM provider_plans ORDER BY provider ASC`
    )
    .all();
  return rows.map(rowToPlan);
}

/**
 * Upsert a provider plan. If a row for connectionId already exists it is
 * replaced (ON CONFLICT DO UPDATE). Serializes dimensions to JSON.
 *
 * @param connectionId Unique provider connection identifier.
 * @param provider     Provider name (e.g. "codex", "kimi").
 * @param dimensions   Array of QuotaDimension objects.
 * @param source       "auto" = detected at runtime; "manual" = operator config.
 */
export async function upsertPlan(
  connectionId: string,
  provider: string,
  dimensions: QuotaDimension[],
  source: "auto" | "manual"
): Promise<void> {
  const now = new Date().toISOString();
  const dimensionsJson = JSON.stringify(dimensions);

  await getDb()
    .prepare(
      `INSERT INTO provider_plans (connection_id, provider, dimensions_json, source, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(connection_id)
       DO UPDATE SET
         provider = excluded.provider,
         dimensions_json = excluded.dimensions_json,
         source = excluded.source,
         updated_at = excluded.updated_at`
    )
    .run(connectionId, provider, dimensionsJson, source, now);
}

/**
 * Delete the plan for a connection (clears override, falls back to auto/catalog).
 * Returns true if a row was deleted, false if not found.
 */
export async function deletePlan(connectionId: string): Promise<boolean> {
  const result = await getDb()
    .prepare("DELETE FROM provider_plans WHERE connection_id = ?")
    .run(connectionId);
  return result.changes > 0;
}
