/**
 * Plugin DB module — CRUD operations for the plugins table.
 *
 * @module db/plugins
 */

import { getDbInstance, getAsyncDb } from "./core";
import { logger } from "../../../open-sse/utils/logger.ts";

const log = logger("DB_PLUGINS");

// ── Types ──

export interface PluginRow {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  license: string;
  main: string;
  source: string;
  tags: string; // JSON array
  status: "installed" | "active" | "inactive" | "error";
  enabled: number; // 0 | 1
  manifest: string; // JSON
  config: string; // JSON
  configSchema: string; // JSON
  hooks: string; // JSON array
  permissions: string; // JSON array
  pluginDir: string;
  errorMessage: string | null;
  installedAt: string;
  updatedAt: string;
  activatedAt: string | null;
}

export interface PluginCreateInput {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  main: string;
  source?: string;
  tags?: string[];
  status?: PluginRow["status"];
  enabled?: boolean;
  manifest: Record<string, unknown>;
  config?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  hooks?: string[];
  permissions?: string[];
  pluginDir: string;
}

// ── Helpers ──

function rowToPlugin(row: any): PluginRow {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    author: row.author,
    license: row.license,
    main: row.main,
    source: row.source,
    tags: row.tags,
    status: row.status,
    enabled: row.enabled,
    manifest: row.manifest,
    config: row.config,
    configSchema: row.config_schema,
    hooks: row.hooks,
    permissions: row.permissions,
    pluginDir: row.plugin_dir,
    errorMessage: row.error_message,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
  };
}

// ── CRUD ──

export async function insertPlugin(input: PluginCreateInput): Promise<PluginRow> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO plugins (
      id, name, version, description, author, license, main, source, tags,
      status, enabled, manifest, config, config_schema, hooks, permissions,
      plugin_dir, installed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.name,
      input.version,
      input.description ?? null,
      input.author ?? null,
      input.license ?? "MIT",
      input.main,
      input.source ?? "local",
      JSON.stringify(input.tags ?? []),
      input.status ?? "installed",
      input.enabled ? 1 : 0,
      JSON.stringify(input.manifest),
      JSON.stringify(input.config ?? {}),
      JSON.stringify(input.configSchema ?? {}),
      JSON.stringify(input.hooks ?? []),
      JSON.stringify(input.permissions ?? []),
      input.pluginDir,
      now,
      now
    );

  log.info("plugin.inserted", { id: input.id, name: input.name });
  const plugin = await getPluginByName(input.name);
  if (!plugin) {
    throw new Error(`Failed to retrieve plugin '${input.name}' after insertion`);
  }
  return plugin;
}

export async function getPluginById(id: string): Promise<PluginRow | null> {
  const db = await getAsyncDb();
  const row = await db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
  return row ? rowToPlugin(row) : null;
}

export async function getPluginByName(name: string): Promise<PluginRow | null> {
  const db = await getAsyncDb();
  const row = await db.prepare("SELECT * FROM plugins WHERE name = ?").get(name);
  return row ? rowToPlugin(row) : null;
}

export async function listPlugins(status?: PluginRow["status"]): Promise<PluginRow[]> {
  const db = await getAsyncDb();
  const rows = status
    ? await db.prepare("SELECT * FROM plugins WHERE status = ? ORDER BY name").all(status)
    : await db.prepare("SELECT * FROM plugins ORDER BY name").all();
  return rows.map(rowToPlugin);
}

export async function updatePluginStatus(
  name: string,
  status: PluginRow["status"],
  errorMessage?: string
): Promise<boolean> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();
  const activatedAt = status === "active" ? now : null;

  // `activated_at` records the most-recent activation timestamp and is intentionally
  // preserved on deactivation via COALESCE (activatedAt is null when status != "active").
  // Callers should treat it as "last activated at", not "currently active since".
  const result = await db
    .prepare(
      `UPDATE plugins SET status = ?, enabled = ?, error_message = ?,
       updated_at = ?, activated_at = COALESCE(?, activated_at)
       WHERE name = ?`
    )
    .run(status, status === "active" ? 1 : 0, errorMessage ?? null, now, activatedAt, name);

  if (result.changes > 0) {
    log.info("plugin.status_updated", { name, status });
  }
  return result.changes > 0;
}

export async function updatePluginConfig(
  name: string,
  config: Record<string, unknown>
): Promise<boolean> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();

  const result = await db
    .prepare("UPDATE plugins SET config = ?, updated_at = ? WHERE name = ?")
    .run(JSON.stringify(config), now, name);

  return result.changes > 0;
}

export async function deletePlugin(name: string): Promise<boolean> {
  const db = await getAsyncDb();
  const result = await db.prepare("DELETE FROM plugins WHERE name = ?").run(name);
  if (result.changes > 0) {
    log.info("plugin.deleted", { name });
  }
  return result.changes > 0;
}

export async function pluginExists(name: string): Promise<boolean> {
  const db = await getAsyncDb();
  const row = await db.prepare("SELECT 1 FROM plugins WHERE name = ?").get(name);
  return !!row;
}

// ── Analytics ──

export interface PluginExecutionRow {
  pluginName: string;
  hook: string;
  durationMs: number;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface PluginAnalyticsSummary {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
}

/**
 * Record a single plugin execution in plugin_analytics.
 */
export async function recordPluginExecution(
  pluginName: string,
  hook: string,
  durationMs: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const db = await getAsyncDb();
  await db
    .prepare(
      `INSERT INTO plugin_analytics (plugin_name, hook, duration_ms, success, error_message)
     VALUES (?, ?, ?, ?, ?)`
    )
    .run(pluginName, hook, durationMs, success ? 1 : 0, errorMessage ?? null);
}

/**
 * Return execution rows for a given plugin (most recent first).
 */
export async function getPluginAnalytics(pluginName: string): Promise<PluginExecutionRow[]> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare(
      `SELECT plugin_name, hook, duration_ms, success, error_message, created_at
       FROM plugin_analytics
       WHERE plugin_name = ?
       ORDER BY created_at DESC`
    )
    .all(pluginName)) as any[];
  return rows.map((r) => ({
    pluginName: r.plugin_name,
    hook: r.hook,
    durationMs: r.duration_ms,
    success: r.success === 1,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  }));
}

/**
 * Return aggregate stats for a given plugin.
 */
export async function getPluginAnalyticsSummary(
  pluginName: string
): Promise<PluginAnalyticsSummary> {
  const db = await getAsyncDb();
  const row = (await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successes,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
         AVG(duration_ms) AS avg_duration
       FROM plugin_analytics
       WHERE plugin_name = ?`
    )
    .get(pluginName)) as any;
  return {
    totalCalls: row?.total ?? 0,
    successCount: row?.successes ?? 0,
    failureCount: row?.failures ?? 0,
    avgDurationMs: row?.avg_duration ?? 0,
  };
}
