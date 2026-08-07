/**
 * Plugin Metrics DB module — per-plugin hook execution tracking.
 *
 * STATUS: The `plugin_metrics` table (migration 090) is a reserved aggregate table.
 * `recordPluginMetric` is currently NOT called from any production code path — the
 * per-execution row store is `plugin_analytics` (migration 091, read by the
 * `plugin_executions` MCP tool). `plugin_metrics` is intended for future aggregate
 * rollups (e.g. bumping per-(plugin, event) counters from `recordPluginExecution`),
 * but that write path has not been wired yet. Do NOT remove the migration — it is
 * harmless and reserves the schema for the planned rollup feature.
 *
 * @module db/pluginMetrics
 */

import { getAsyncDb } from "./core";
import type { RawSyncDb } from "./adapters/types";

// Sync view of the shared DB singleton (see featureFlags.ts for the same
// pattern). These helpers sit in the synchronous call stack.
function syncDb(): RawSyncDb {
  return getAsyncDb() as unknown as RawSyncDb;
}

export interface PluginMetricRow {
  pluginName: string;
  event: string;
  calls: number;
  errors: number;
  totalDurationMs: number;
  lastCalledAt: string | null;
}

function rowToMetric(row: Record<string, unknown>): PluginMetricRow {
  return {
    pluginName: row.plugin_name as string,
    event: row.event as string,
    calls: row.calls as number,
    errors: row.errors as number,
    totalDurationMs: row.total_duration_ms as number,
    lastCalledAt: row.last_called_at as string | null,
  };
}

/**
 * Record a hook execution metric. Uses UPSERT to increment counters.
 */
export function recordPluginMetric(
  pluginName: string,
  event: string,
  durationMs: number,
  isError: boolean
): void {
  try {
    const db = syncDb();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO plugin_metrics (plugin_name, event, calls, errors, total_duration_ms, last_called_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(plugin_name, event) DO UPDATE SET
        calls = calls + 1,
        errors = errors + excluded.errors,
        total_duration_ms = total_duration_ms + excluded.total_duration_ms,
        last_called_at = excluded.last_called_at`
    ).run(pluginName, event, isError ? 1 : 0, durationMs, now);
  } catch {
    // Best-effort: DB hiccup should never break hook execution
  }
}

/**
 * Get plugin metrics, optionally filtered by plugin name.
 */
export async function getPluginMetrics(pluginName?: string): Promise<PluginMetricRow[]> {
  try {
    const db = syncDb();
    const rows = pluginName
      ? ((await db
          .prepare("SELECT * FROM plugin_metrics WHERE plugin_name = ? ORDER BY event")
          .all(pluginName)) as Record<string, unknown>[])
      : ((await db
          .prepare("SELECT * FROM plugin_metrics ORDER BY plugin_name, event")
          .all()) as Record<string, unknown>[]);
    return rows.map(rowToMetric);
  } catch {
    return [];
  }
}

/**
 * Clear plugin metrics, optionally filtered by plugin name.
 */
export async function clearPluginMetrics(pluginName?: string): Promise<number> {
  const db = syncDb();
  const result = pluginName
    ? await db.prepare("DELETE FROM plugin_metrics WHERE plugin_name = ?").run(pluginName)
    : await db.prepare("DELETE FROM plugin_metrics").run();
  return result.changes;
}
