/**
 * db/quotaGroups.ts — CRUD for the quota_groups table.
 *
 * Quota groups are first-class entities that pool multiple quota pools
 * under a shared namespace. Pools reference groups via quota_pools.group_id.
 *
 * All SQL goes through prepared statements — never raw string interpolation.
 * Import getDbInstance from ./core (Hard Rule #5).
 */

import { getDbInstance, getAsyncDb } from "./core";
import type { DatabaseAdapter } from "./adapters/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuotaGroup {
  id: string;
  name: string;
  createdAt: string;
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

interface GroupRow {
  id: string;
  name: string;
  created_at: string;
}

function rowToGroup(row: GroupRow): QuotaGroup {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function makeId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new quota group with the given name.
 * Returns the newly created QuotaGroup row.
 */
export async function createGroup(name: string): Promise<QuotaGroup> {
  const id = makeId();
  const now = new Date().toISOString();

  await getDb()
    .prepare("INSERT INTO quota_groups (id, name, created_at) VALUES (?, ?, ?)")
    .run(id, name, now);

  return { id, name, createdAt: now };
}

/**
 * Get a single quota group by id.
 * Returns null if not found.
 */
export async function getGroup(id: string): Promise<QuotaGroup | null> {
  const row = (await getDb()
    .prepare<GroupRow>("SELECT id, name, created_at FROM quota_groups WHERE id = ?")
    .get(id)) as GroupRow | undefined;
  if (!row) return null;
  return rowToGroup(row);
}

/**
 * Convenience helper — returns just the group name, or null if not found.
 */
export async function getGroupName(id: string): Promise<string | null> {
  const row = (await getDb()
    .prepare<{ name: string }>("SELECT name FROM quota_groups WHERE id = ?")
    .get(id)) as { name: string } | undefined;
  return row ? row.name : null;
}

/**
 * List all quota groups, ordered by created_at ascending.
 */
export async function listGroups(): Promise<QuotaGroup[]> {
  const rows = (await getDb()
    .prepare<GroupRow>("SELECT id, name, created_at FROM quota_groups ORDER BY created_at ASC")
    .all()) as GroupRow[];
  return rows.map(rowToGroup);
}

/**
 * Rename an existing group.
 * Returns true if the row was updated, false if the group was not found.
 */
export async function renameGroup(id: string, name: string): Promise<boolean> {
  const result = await getDb()
    .prepare("UPDATE quota_groups SET name = ? WHERE id = ?")
    .run(name, id);
  return result.changes > 0;
}

/**
 * Delete a quota group by id.
 *
 * Throws if:
 * - The group is the protected seed 'group-demo' — it must always exist.
 * - Any quota_pools row still references this group via group_id — the caller
 *   must reassign or delete those pools first.
 *
 * Returns true if a row was deleted, false if the group was not found.
 */
export async function deleteGroup(id: string): Promise<boolean> {
  // Protect the seed group.
  if (id === "group-demo") {
    throw new Error(
      "Cannot delete the protected seed group 'group-demo'. Reassign its pools to another group first."
    );
  }

  // Guard: refuse deletion when pools still reference this group.
  const refRow = (await getDb()
    .prepare<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM quota_pools WHERE group_id = ?")
    .get(id)) as { cnt: number } | undefined;
  if (refRow && refRow.cnt > 0) {
    throw new Error(`Group '${id}' has pools; reassign or delete them first.`);
  }

  const result = await getDb().prepare("DELETE FROM quota_groups WHERE id = ?").run(id);
  return result.changes > 0;
}
