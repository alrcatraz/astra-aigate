import { getAsyncDb } from "@/lib/db/core.ts";
import type { DatabaseAdapter } from "@/lib/db/adapters/types";

export interface CloudAgentTaskRow {
  id: string;
  provider_id: string;
  external_id: string | null;
  status: string;
  prompt: string;
  source: string;
  options: string;
  result: string | null;
  activities: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function createCloudAgentTaskTable(): Promise<void> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_agent_tasks (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      prompt TEXT NOT NULL,
      source TEXT NOT NULL,
      options TEXT DEFAULT '{}',
      result TEXT,
      activities TEXT DEFAULT '[]',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cloud_agent_tasks_provider
    ON cloud_agent_tasks(provider_id)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cloud_agent_tasks_status
    ON cloud_agent_tasks(status)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cloud_agent_tasks_created
    ON cloud_agent_tasks(created_at DESC)
  `);
}

export async function insertCloudAgentTask(task: CloudAgentTaskRow): Promise<void> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db
    .prepare(
      `
    INSERT INTO cloud_agent_tasks (
      id, provider_id, external_id, status, prompt, source,
      options, result, activities, error, created_at, updated_at, completed_at
    ) VALUES (
      @id, @provider_id, @external_id, @status, @prompt, @source,
      @options, @result, @activities, @error, @created_at, @updated_at, @completed_at
    )
  `
    )
    .run(task);
}

// Whitelist of allowed columns for update operations
const ALLOWED_UPDATE_COLUMNS = new Set([
  "status",
  "prompt",
  "source",
  "options",
  "result",
  "activities",
  "error",
  "completed_at",
]);

export async function updateCloudAgentTask(
  id: string,
  updates: Partial<Omit<CloudAgentTaskRow, "id">>
): Promise<void> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;

  // Validate keys against whitelist to prevent SQL injection
  const validUpdates: Partial<Omit<CloudAgentTaskRow, "id">> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (ALLOWED_UPDATE_COLUMNS.has(key)) {
      (validUpdates as Record<string, unknown>)[key] = value;
    }
  }

  const fields = Object.keys(validUpdates)
    .map((key) => `${key} = @${key}`)
    .join(", ");

  if (!fields) return; // No valid updates

  await db
    .prepare(
      `
    UPDATE cloud_agent_tasks
    SET ${fields}, updated_at = datetime('now')
    WHERE id = @id
  `
    )
    .run({ id, ...validUpdates });
}

export async function getCloudAgentTaskById(id: string): Promise<CloudAgentTaskRow | null> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  return (await db
    .prepare("SELECT * FROM cloud_agent_tasks WHERE id = ?")
    .get(id)) as CloudAgentTaskRow | null;
}

export async function getCloudAgentTasksByProvider(
  providerId: string,
  limit = 50
): Promise<CloudAgentTaskRow[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  return (await db
    .prepare(
      "SELECT * FROM cloud_agent_tasks WHERE provider_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(providerId, limit)) as CloudAgentTaskRow[];
}

export async function getCloudAgentTasksByStatus(
  status: string,
  limit = 50
): Promise<CloudAgentTaskRow[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  return (await db
    .prepare("SELECT * FROM cloud_agent_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?")
    .all(status, limit)) as CloudAgentTaskRow[];
}

export async function getAllCloudAgentTasks(limit = 100): Promise<CloudAgentTaskRow[]> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  return (await db
    .prepare("SELECT * FROM cloud_agent_tasks ORDER BY created_at DESC LIMIT ?")
    .all(limit)) as CloudAgentTaskRow[];
}

export async function deleteCloudAgentTask(id: string): Promise<void> {
  const db = getAsyncDb() as unknown as DatabaseAdapter;
  await db.prepare("DELETE FROM cloud_agent_tasks WHERE id = ?").run(id);
}
