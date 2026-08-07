/**
 * CLI Tool State Persistence
 *
 * Stores last-configured timestamps and initial config snapshots
 * for CLI tools in the key_value table.
 *
 * Namespaces:
 *   - cliToolLastConfig: ISO timestamp of last configuration
 *   - cliToolInitialConfig: JSON snapshot of pre-AI Gate configuration
 *
 * @module lib/db/cliToolState
 */

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
}

interface KeyValueRow {
  key: string;
  value: string;
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

// ──────────────── Last Configured Timestamp ────────────────

/**
 * Save last-configured timestamp for a CLI tool.
 */
export async function saveCliToolLastConfigured(
  toolId: string,
  timestamp: string = new Date().toISOString()
): Promise<void> {
  if (isBuildPhase || isCloud) return;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run("cliToolLastConfig", toolId, JSON.stringify(timestamp));
}

/**
 * Get last-configured timestamp for a CLI tool.
 * @returns ISO timestamp string or null if never configured.
 */
export async function getCliToolLastConfigured(toolId: string): Promise<string | null> {
  if (isBuildPhase || isCloud) return null;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const row = await db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("cliToolLastConfig", toolId);
  if (!row) return null;
  const parsed = parseJsonValue((row as KeyValueRow).value);
  return typeof parsed === "string" ? parsed : null;
}

/**
 * Get all CLI tool last-configured timestamps.
 * @returns Record<toolId, ISO timestamp>
 */
export async function getAllCliToolLastConfigured(): Promise<Record<string, string>> {
  if (isBuildPhase || isCloud) return {};
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const rows = (await db
    .prepare("SELECT key, value FROM key_value WHERE namespace = ?")
    .all("cliToolLastConfig")) as KeyValueRow[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    const parsed = parseJsonValue(row.value);
    if (typeof parsed === "string") {
      result[row.key] = parsed;
    }
  }
  return result;
}

/**
 * Delete last-configured timestamp for a CLI tool.
 */
export async function deleteCliToolLastConfigured(toolId: string): Promise<void> {
  if (isBuildPhase || isCloud) return;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db
    .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
    .run("cliToolLastConfig", toolId);
}

// ──────────────── Initial Config Snapshot ────────────────

/**
 * Save the initial (pre-AI Gate) config snapshot for a CLI tool.
 * Only saves if no snapshot exists yet (first-time only).
 * @returns true if saved, false if snapshot already exists.
 */
export async function saveCliToolInitialConfig(
  toolId: string,
  config: JsonRecord
): Promise<boolean> {
  if (isBuildPhase || isCloud) return false;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  // Only save if not already stored
  const existing = await db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("cliToolInitialConfig", toolId);
  if (existing) return false;

  await db
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)")
    .run("cliToolInitialConfig", toolId, JSON.stringify(config));
  return true;
}

/**
 * Get the initial config snapshot for a CLI tool.
 * @returns Config object or null if no snapshot exists.
 */
export async function getCliToolInitialConfig(toolId: string): Promise<JsonRecord | null> {
  if (isBuildPhase || isCloud) return null;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  const row = await db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("cliToolInitialConfig", toolId);
  if (!row) return null;
  const parsed = parseJsonValue((row as KeyValueRow).value);
  return toRecord(parsed);
}

/**
 * Delete the initial config snapshot for a CLI tool.
 */
export async function deleteCliToolInitialConfig(toolId: string): Promise<void> {
  if (isBuildPhase || isCloud) return;
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db
    .prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?")
    .run("cliToolInitialConfig", toolId);
}
