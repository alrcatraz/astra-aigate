/**
 * @file 3.6d — audit callerId tracing (mcp_tool_audit.api_key_id).
 *
 * logToolCall takes an optional per-caller apiKeyId (callerId from
 * authInfo/session); when absent it falls back to the OMNIROUTE_API_KEY_ID
 * env. The mcp_* registry tools enable the withScopeEnforcement audit wrapper
 * so every management call is traced to its caller.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const dataDir = mkdtempSync(join(tmpdir(), "mcp-audit-"));
process.env.DATA_DIR = dataDir;
process.env.OMNIROUTE_MAX_PENDING_MIGRATIONS = "0";
delete process.env.OMNIROUTE_API_KEY_ID;

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function freshImport(modulePath: string) {
  return import(`${modulePath}?q=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function ensureAuditTable(db: { exec: (sql: string) => unknown }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS mcp_tool_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    input_hash TEXT,
    output_summary TEXT,
    duration_ms INTEGER,
    api_key_id TEXT,
    success INTEGER DEFAULT 1,
    error_code TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

test("3.6d logToolCall records the explicit per-caller apiKeyId", async () => {
  const { getDbInstance } = await freshImport(join(root, "src/lib/db/core.ts"));
  const db = await getDbInstance();
  await ensureAuditTable(db);
  const { logToolCall } = await freshImport(join(root, "open-sse/mcp-server/audit.ts"));
  await logToolCall(
    "mcp_register_server",
    { id: "a" },
    { ok: true },
    12,
    true,
    undefined,
    "key-42"
  );
  const row = await (
    await db.prepare("SELECT * FROM mcp_tool_audit WHERE tool_name = ?")
  ).get("mcp_register_server");
  assert.ok(row, "audit row must exist");
  assert.equal(row.api_key_id, "key-42", "per-caller apiKeyId must win");
  assert.equal(row.success, 1);
  assert.ok(
    !String(row.input_hash).includes("mcp_register_server"),
    "input is hashed, not plaintext"
  );
});

test("3.6d logToolCall falls back to OMNIROUTE_API_KEY_ID env", async () => {
  process.env.OMNIROUTE_API_KEY_ID = "env-key-7";
  const { getDbInstance } = await freshImport(join(root, "src/lib/db/core.ts"));
  const db = await getDbInstance();
  await ensureAuditTable(db);
  const { logToolCall } = await freshImport(join(root, "open-sse/mcp-server/audit.ts"));
  await logToolCall("omniroute_get_health", {}, { ok: true }, 3, true);
  const row = await (
    await db.prepare("SELECT api_key_id FROM mcp_tool_audit WHERE tool_name = ?")
  ).get("omniroute_get_health");
  assert.equal(row?.api_key_id, "env-key-7", "env fallback applies when no explicit caller");
});

test("3.6d failure path logs with error_code and caller", async () => {
  const { getDbInstance } = await freshImport(join(root, "src/lib/db/core.ts"));
  const db = await getDbInstance();
  await ensureAuditTable(db);
  const { logToolCall } = await freshImport(join(root, "open-sse/mcp-server/audit.ts"));
  await logToolCall(
    "mcp_unregister_server",
    { id: "x" },
    null,
    5,
    false,
    "scope_denied:missing_scopes",
    "key-9"
  );
  const row = await (
    await db.prepare("SELECT * FROM mcp_tool_audit WHERE error_code IS NOT NULL")
  ).get();
  assert.ok(row);
  assert.equal(row.success, 0);
  assert.equal(row.api_key_id, "key-9");
  assert.match(row.error_code, /^scope_denied/);
});
