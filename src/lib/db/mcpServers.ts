/**
 * Database module: MCP Servers (Phase 3 gateway registry)
 * CRUD operations for the mcp_servers table. One row per MCP endpoint
 * exposed by the AI Gate gateway.
 *
 * Conventions:
 * - `kind` is pure connection semantics: builtin | stdio | http
 * - `system=1` preset rows (aigate-*) can be disabled but never deleted
 * - `auth_secret` is encrypted at rest via encryption.ts (encrypt/decrypt)
 */

import { getDbInstance } from "./core";
import { encrypt, decrypt } from "./encryption";
import crypto from "crypto";

export type McpServerKind = "builtin" | "stdio" | "http";
export type McpAuthType = "none" | "bearer" | "header";
export type McpSource = "manual" | "marketplace";

export interface McpServer {
  id: string;
  name: string;
  group_id: string;
  kind: McpServerKind;
  command: string | null;
  args: string | null;
  url: string | null;
  auth_type: McpAuthType;
  /** Decrypted downstream credential (null when none / undecryptable). */
  auth_secret: string | null;
  enabled: boolean;
  system: boolean;
  source: McpSource;
  required_scope: string | null;
  created_at: string;
  updated_at: string;
}

interface McpServerRow {
  id: string;
  name: string;
  group_id: string;
  kind: string;
  command: string | null;
  args: string | null;
  url: string | null;
  auth_type: string;
  auth_secret: string | null;
  enabled: number;
  system: number;
  source: string;
  required_scope: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMcpServer(row: McpServerRow): McpServer {
  return {
    ...row,
    kind: (row.kind as McpServerKind) || "builtin",
    auth_type: (row.auth_type as McpAuthType) || "none",
    source: (row.source as McpSource) || "manual",
    enabled: row.enabled === 1,
    system: row.system === 1,
    auth_secret: decrypt(row.auth_secret) ?? null,
  };
}

export interface McpServerInput {
  id?: string;
  name: string;
  group_id?: string;
  kind: McpServerKind;
  command?: string | null;
  args?: string | null;
  url?: string | null;
  auth_type?: McpAuthType;
  auth_secret?: string | null;
  enabled?: boolean;
  system?: boolean;
  source?: McpSource;
  required_scope?: string | null;
}

/** Generate a stable id from a slug (lowercase, hyphens). */
export function slugifyMcpServerId(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `mcp-${crypto.randomBytes(4).toString("hex")}`
  );
}

export async function listMcpServers(options?: {
  includeDisabled?: boolean;
  groupId?: string;
}): Promise<McpServer[]> {
  const db = getDbInstance();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!options?.includeDisabled) clauses.push("enabled = 1");
  if (options?.groupId) {
    clauses.push("group_id = ?");
    params.push(options.groupId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await db
    .prepare(`SELECT * FROM mcp_servers ${where} ORDER BY system DESC, created_at ASC`)
    .all(...params)) as McpServerRow[];
  return rows.map(rowToMcpServer);
}

export async function getMcpServer(id: string): Promise<McpServer | null> {
  const db = getDbInstance();
  const row = (await db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id)) as
    McpServerRow | undefined;
  return row ? rowToMcpServer(row) : null;
}

export async function createMcpServer(input: McpServerInput): Promise<McpServer> {
  const db = getDbInstance();
  const id = input.id ?? slugifyMcpServerId(input.name);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO mcp_servers
        (id, name, group_id, kind, command, args, url, auth_type, auth_secret,
         enabled, system, source, required_scope, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.group_id ?? "custom",
      input.kind,
      input.command ?? null,
      input.args ?? null,
      input.url ?? null,
      input.auth_type ?? "none",
      encrypt(input.auth_secret ?? null) ?? null,
      input.enabled === false ? 0 : 1,
      input.system === true ? 1 : 0,
      input.source ?? "manual",
      input.required_scope ?? null,
      now,
      now
    );
  const created = await getMcpServer(id);
  if (!created) throw new Error(`mcp_servers insert failed for id ${id}`);
  return created;
}

export async function updateMcpServer(
  id: string,
  patch: Partial<McpServerInput>
): Promise<McpServer | null> {
  const db = getDbInstance();
  const existing = await getMcpServer(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.group_id !== undefined) push("group_id", patch.group_id);
  if (patch.kind !== undefined) push("kind", patch.kind);
  if (patch.command !== undefined) push("command", patch.command ?? null);
  if (patch.args !== undefined) push("args", patch.args ?? null);
  if (patch.url !== undefined) push("url", patch.url ?? null);
  if (patch.auth_type !== undefined) push("auth_type", patch.auth_type);
  if (patch.auth_secret !== undefined)
    push("auth_secret", encrypt(patch.auth_secret ?? null) ?? null);
  if (patch.enabled !== undefined) push("enabled", patch.enabled ? 1 : 0);
  if (patch.source !== undefined) push("source", patch.source);
  if (patch.required_scope !== undefined) push("required_scope", patch.required_scope ?? null);

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  await db.prepare(`UPDATE mcp_servers SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getMcpServer(id);
}

export async function setMcpServerEnabled(id: string, enabled: boolean): Promise<McpServer | null> {
  return updateMcpServer(id, { enabled });
}

/** Delete a custom (non-system) registration. System presets are refuse-to-delete. */
export async function deleteMcpServer(id: string): Promise<boolean> {
  const db = getDbInstance();
  const existing = await getMcpServer(id);
  if (!existing) return false;
  if (existing.system)
    throw new Error(`system MCP server "${id}" cannot be deleted (disable instead)`);
  const result = await db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  return (result as unknown as { changes: number }).changes > 0;
}
