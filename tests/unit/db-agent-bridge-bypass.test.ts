import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-db-agent-bridge-bypass-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const mod = await import("../../src/lib/db/agentBridgeBypass.ts");

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

const DEFAULT_PATTERNS = [
  "*.googleapis.com",
  "*.gstatic.com",
  "accounts.google.com",
  "login.microsoftonline.com",
];

test("getAllBypassPatterns returns empty array when table is empty", async () => {
  const rows = await mod.getAllBypassPatterns();
  assert.deepEqual(rows, []);
});

test("seedDefaultBypassPatterns inserts default patterns with source=default", async () => {
  await mod.seedDefaultBypassPatterns(DEFAULT_PATTERNS);

  const rows = await mod.getAllBypassPatterns();
  assert.equal(rows.length, DEFAULT_PATTERNS.length);

  for (const row of rows) {
    assert.equal(row.source, "default");
    assert.ok(DEFAULT_PATTERNS.includes(row.pattern));
  }
});

test("seedDefaultBypassPatterns is idempotent — calling twice does not duplicate", async () => {
  await mod.seedDefaultBypassPatterns(DEFAULT_PATTERNS);
  await mod.seedDefaultBypassPatterns(DEFAULT_PATTERNS);

  const rows = await mod.getAllBypassPatterns();
  assert.equal(rows.length, DEFAULT_PATTERNS.length);
});

test("getUserBypassPatterns returns only user patterns", async () => {
  await mod.seedDefaultBypassPatterns(DEFAULT_PATTERNS);
  await mod.replaceUserBypassPatterns(["*.internal.example.com", "localhost"]);

  const userPatterns = await mod.getUserBypassPatterns();
  assert.equal(userPatterns.length, 2);
  assert.ok(userPatterns.includes("*.internal.example.com"));
  assert.ok(userPatterns.includes("localhost"));

  // Defaults should not appear in user patterns
  for (const p of DEFAULT_PATTERNS) {
    assert.ok(!userPatterns.includes(p));
  }
});

test("replaceUserBypassPatterns replaces only user entries — defaults untouched", async () => {
  await mod.seedDefaultBypassPatterns(DEFAULT_PATTERNS);
  await mod.replaceUserBypassPatterns(["custom.host.1"]);
  await mod.replaceUserBypassPatterns(["custom.host.2", "custom.host.3"]);

  const allRows = await mod.getAllBypassPatterns();
  const defaultRows = allRows.filter((r) => r.source === "default");
  const userRows = allRows.filter((r) => r.source === "user");

  assert.equal(defaultRows.length, DEFAULT_PATTERNS.length);
  assert.equal(userRows.length, 2);

  const userPatterns = userRows.map((r) => r.pattern);
  assert.ok(!userPatterns.includes("custom.host.1"), "old user pattern must be replaced");
  assert.ok(userPatterns.includes("custom.host.2"));
  assert.ok(userPatterns.includes("custom.host.3"));
});

test("replaceUserBypassPatterns with empty array clears all user patterns", async () => {
  await mod.seedDefaultBypassPatterns(DEFAULT_PATTERNS);
  await mod.replaceUserBypassPatterns(["temp.host"]);
  await mod.replaceUserBypassPatterns([]);

  const userPatterns = await mod.getUserBypassPatterns();
  assert.equal(userPatterns.length, 0);

  // Defaults remain
  const allRows = await mod.getAllBypassPatterns();
  assert.equal(allRows.length, DEFAULT_PATTERNS.length);
});

test("getAllBypassPatterns returns both default and user patterns", async () => {
  await mod.seedDefaultBypassPatterns(["*.example.com"]);
  await mod.replaceUserBypassPatterns(["custom.host"]);

  const allRows = await mod.getAllBypassPatterns();
  assert.equal(allRows.length, 2);

  const sources = new Set(allRows.map((r) => r.source));
  assert.ok(sources.has("default"));
  assert.ok(sources.has("user"));
});
