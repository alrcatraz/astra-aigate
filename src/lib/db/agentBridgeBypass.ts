/**
 * Database module: AgentBridgeBypass
 * CRUD + seed for agent_bridge_bypass table.
 */

import { getDbInstance, getAsyncDb } from "./core.ts";
import type { AgentBridgeBypassRow } from "./_rowTypes.ts";

// SQLite rows have source as plain string
interface AgentBridgeBypassDbRow {
  pattern: string;
  source: string;
  created_at: string;
}

function mapRow(row: AgentBridgeBypassDbRow): AgentBridgeBypassRow {
  return {
    pattern: row.pattern,
    source: row.source as "default" | "user",
    created_at: row.created_at,
  };
}

export async function getAllBypassPatterns(): Promise<AgentBridgeBypassRow[]> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare(
      "SELECT pattern, source, created_at FROM agent_bridge_bypass ORDER BY source ASC, pattern ASC"
    )
    .all()) as AgentBridgeBypassDbRow[];
  return rows.map(mapRow);
}

export async function getUserBypassPatterns(): Promise<string[]> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare("SELECT pattern FROM agent_bridge_bypass WHERE source = 'user' ORDER BY pattern ASC")
    .all()) as Array<{ pattern: string }>;
  return rows.map((r) => r.pattern);
}

export async function replaceUserBypassPatterns(patterns: string[]): Promise<void> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();

  const deleteUserStmt = await db.prepare("DELETE FROM agent_bridge_bypass WHERE source = 'user'");
  const insertStmt = await db.prepare(
    `INSERT INTO agent_bridge_bypass (pattern, source, created_at) VALUES (?, 'user', ?)`
  );

  const runTransaction = db.transaction(() => {
    deleteUserStmt.run();
    for (const pattern of patterns) {
      insertStmt.run(pattern, now);
    }
  });

  runTransaction();
}

/**
 * Seeds default bypass patterns — idempotent.
 * Only inserts a pattern if it does not already exist in the table.
 * Called at app boot by the AgentBridge manager (F3 will wire this).
 */
export async function seedDefaultBypassPatterns(defaults: string[]): Promise<void> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();

  const insertIfMissing = await db.prepare(
    `INSERT OR IGNORE INTO agent_bridge_bypass (pattern, source, created_at) VALUES (?, 'default', ?)`
  );

  const runTransaction = db.transaction(() => {
    for (const pattern of defaults) {
      insertIfMissing.run(pattern, now);
    }
  });

  runTransaction();
}
