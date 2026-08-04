/**
 * @file 3.6c — auth_secret encryption at rest (STORAGE_ENCRYPTION_KEY set).
 *
 * Runs in its own process (node --test spawns one per file) so the
 * module-level `_staticKey` cache in encryption.ts derives from this file's
 * env. The passthrough counterpart lives in mcp-secret-passthrough.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const dataDir = mkdtempSync(join(tmpdir(), "mcp-secret-enc-"));
process.env.DATA_DIR = dataDir;
process.env.OMNIROUTE_MAX_PENDING_MIGRATIONS = "0";
process.env.STORAGE_ENCRYPTION_KEY = "test-key-3.6c-0123456789abcdef";

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function freshImport(modulePath: string) {
  return import(`${modulePath}?q=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function ensureMcpServersTable(db: { exec: (sql: string) => unknown }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_id TEXT NOT NULL DEFAULT 'custom',
    kind TEXT NOT NULL DEFAULT 'stdio',
    command TEXT, args TEXT, url TEXT,
    auth_type TEXT NOT NULL DEFAULT 'none',
    auth_secret TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    system INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    required_scope TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

test("3.6c createMcpServer encrypts auth_secret at rest (enc:v1: prefix)", async () => {
  const { getDbInstance } = await freshImport(join(root, "src/lib/db/core.ts"));
  const db = await getDbInstance();
  await ensureMcpServersTable(db);
  const { createMcpServer, getMcpServer } = await freshImport(
    join(root, "src/lib/db/mcpServers.ts")
  );
  await createMcpServer({
    id: "smoke-secret",
    name: "secret-endpoint",
    group_id: "custom",
    kind: "http",
    url: "http://127.0.0.1:9/mcp",
    auth_type: "bearer",
    auth_secret: "downstream-s3cret",
    enabled: true,
  } as {
    id: string;
    name: string;
    group_id: string;
    kind: string;
    url: string;
    auth_type: string;
    auth_secret: string;
    enabled: boolean;
  });
  const raw = await (
    await db.prepare("SELECT auth_secret FROM mcp_servers WHERE id = ?")
  ).get("smoke-secret");
  assert.ok(raw?.auth_secret, "auth_secret must be stored");
  assert.match(raw.auth_secret, /^enc:v1:/, "stored value must be encrypted (enc:v1: prefix)");
  assert.ok(!raw.auth_secret.includes("downstream-s3cret"), "plaintext must not appear at rest");
  const row = await getMcpServer("smoke-secret");
  assert.equal(row?.auth_secret, "downstream-s3cret", "read path must decrypt back to plaintext");
});

test("3.6c buildDownstreamHeaders maps auth_type to outbound headers", async () => {
  const { buildDownstreamHeaders } = await freshImport(join(root, "open-sse/mcp-server/bridge.ts"));
  const bearer = buildDownstreamHeaders({ auth_secret: "tok-1", auth_type: "bearer" } as {
    auth_secret: string;
    auth_type: string;
  });
  assert.deepEqual(bearer, { Authorization: "Bearer tok-1" });
  const header = buildDownstreamHeaders({ auth_secret: "tok-2", auth_type: "header" } as {
    auth_secret: string;
    auth_type: string;
  });
  assert.deepEqual(header, { "X-MCP-Api-Key": "tok-2" });
  const none = buildDownstreamHeaders({ auth_secret: null, auth_type: "bearer" } as {
    auth_secret: string | null;
    auth_type: string;
  });
  assert.deepEqual(none, {}, "no secret → no headers");
  const unsupported = buildDownstreamHeaders({ auth_secret: "tok-3", auth_type: "none" } as {
    auth_secret: string;
    auth_type: string;
  });
  assert.deepEqual(unsupported, {}, "auth_type none → no headers");
});
