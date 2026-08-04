/**
 * @file 3.6c — auth_secret passthrough (no STORAGE_ENCRYPTION_KEY = dev mode).
 *
 * Separate process from mcp-secret-encryption.test.ts on purpose: encryption.ts
 * caches the derived key at module level, so this file must load with the env
 * unset from the start.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const dataDir = mkdtempSync(join(tmpdir(), "mcp-secret-plain-"));
process.env.DATA_DIR = dataDir;
process.env.OMNIROUTE_MAX_PENDING_MIGRATIONS = "0";
delete process.env.STORAGE_ENCRYPTION_KEY;

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

test("3.6c passthrough mode stores plaintext without STORAGE_ENCRYPTION_KEY", async () => {
  const { getDbInstance } = await freshImport(join(root, "src/lib/db/core.ts"));
  const db = await getDbInstance();
  await ensureMcpServersTable(db);
  const { createMcpServer, getMcpServer } = await freshImport(
    join(root, "src/lib/db/mcpServers.ts")
  );
  await createMcpServer({
    id: "smoke-plain",
    name: "plain-endpoint",
    group_id: "custom",
    kind: "http",
    url: "http://127.0.0.1:9/mcp",
    auth_type: "bearer",
    auth_secret: "visible-secret",
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
  ).get("smoke-plain");
  assert.equal(raw?.auth_secret, "visible-secret", "dev passthrough stores plaintext");
  const row = await getMcpServer("smoke-plain");
  assert.equal(row?.auth_secret, "visible-secret");
});
