/**
 * Database module: AgentBridgeMappings
 * CRUD operations for agent_bridge_mappings table.
 */

import { getDbInstance, getAsyncDb } from "./core";
import type { AgentBridgeMappingRow } from "./_rowTypes";

export async function getMappingsForAgent(agentId: string): Promise<AgentBridgeMappingRow[]> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare(
      "SELECT agent_id, source_model, target_model, updated_at FROM agent_bridge_mappings WHERE agent_id = ? ORDER BY source_model ASC"
    )
    .all(agentId)) as AgentBridgeMappingRow[];
  return rows;
}

export async function setMappings(
  agentId: string,
  mappings: Array<{ source: string; target: string }>
): Promise<void> {
  const db = await getAsyncDb();
  const now = new Date().toISOString();

  const deleteStmt = await db.prepare("DELETE FROM agent_bridge_mappings WHERE agent_id = ?");
  const insertStmt = await db.prepare(
    `INSERT INTO agent_bridge_mappings (agent_id, source_model, target_model, updated_at)
     VALUES (?, ?, ?, ?)`
  );

  const runTransaction = db.transaction(() => {
    deleteStmt.run(agentId);
    for (const mapping of mappings) {
      insertStmt.run(agentId, mapping.source, mapping.target, now);
    }
  });

  runTransaction();
}

export async function deleteMapping(agentId: string, source: string): Promise<void> {
  const db = await getAsyncDb();
  await db
    .prepare("DELETE FROM agent_bridge_mappings WHERE agent_id = ? AND source_model = ?")
    .run(agentId, source);
}
