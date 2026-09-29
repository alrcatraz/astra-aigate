import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-db-agent-bridge-state-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const mod = await import("../../src/lib/db/agentBridgeState.ts");

async function resetStorage() {
  await core.resetDbInstanceDrained();

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
      break;
    } catch (error: any) {
      if ((error?.code === "EBUSY" || error?.code === "EPERM") && attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }

  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  core.getDbInstance();
  await core.awaitDbMigrations();
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("migration is idempotent — running getDbInstance twice does not throw", async () => {
  // First init
  const db1 = core.getDbInstance();
  assert.ok(db1);
  await core.resetDbInstanceDrained();

  // Second init — migrations should skip already-applied files
  const db2 = core.getDbInstance();
  assert.ok(db2);
  await core.awaitDbMigrations();
});

test("getAgentBridgeState returns null for unknown agent", async () => {
  const result = await mod.getAgentBridgeState("unknown-agent");
  assert.equal(result, null);
});

test("upsertAgentBridgeState creates a new row with defaults", async () => {
  await mod.upsertAgentBridgeState({ agent_id: "copilot" });
  const row = await mod.getAgentBridgeState("copilot");

  assert.ok(row);
  assert.equal(row.agent_id, "copilot");
  assert.equal(row.dns_enabled, false);
  assert.equal(row.cert_trusted, false);
  assert.equal(row.setup_completed, false);
  assert.equal(row.last_started_at, null);
  assert.equal(row.last_error, null);
});

test("upsertAgentBridgeState updates an existing row", async () => {
  await mod.upsertAgentBridgeState({ agent_id: "cursor" });
  await mod.upsertAgentBridgeState({ agent_id: "cursor", dns_enabled: true, cert_trusted: true });

  const row = await mod.getAgentBridgeState("cursor");
  assert.ok(row);
  assert.equal(row.dns_enabled, true);
  assert.equal(row.cert_trusted, true);
  assert.equal(row.setup_completed, false);
});

test("setLastStarted persists timestamp and auto-creates row if missing", async () => {
  const ts = new Date().toISOString();
  await mod.setLastStarted("kiro", ts);

  const row = await mod.getAgentBridgeState("kiro");
  assert.ok(row);
  assert.equal(row.last_started_at, ts);
});

test("setLastError persists error string and clears it with null", async () => {
  await mod.upsertAgentBridgeState({ agent_id: "codex" });
  await mod.setLastError("codex", "upstream timeout");

  let row = await mod.getAgentBridgeState("codex");
  assert.equal(row?.last_error, "upstream timeout");

  await mod.setLastError("codex", null);
  row = await mod.getAgentBridgeState("codex");
  assert.equal(row?.last_error, null);
});

test("getAllAgentBridgeStates returns all rows", async () => {
  await mod.upsertAgentBridgeState({ agent_id: "antigravity" });
  await mod.upsertAgentBridgeState({ agent_id: "zed" });

  const rows = await mod.getAllAgentBridgeStates();
  assert.ok(rows.length >= 2);
  const ids = rows.map((r) => r.agent_id);
  assert.ok(ids.includes("antigravity"));
  assert.ok(ids.includes("zed"));
});
