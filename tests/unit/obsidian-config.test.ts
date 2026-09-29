import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-obsidian-config-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const coreDb = await import("../../src/lib/db/core.ts");
const {
  getApiKeyContextSource,
  setApiKeyContextSource,
  deleteApiKeyContextSource,
  listApiKeyContextSources,
} = await import("../../src/lib/db/apiKeyContextSources.ts");
const { getObsidianConfigForApiKey, setObsidianToken, setObsidianBaseUrl } =
  await import("../../src/lib/db/obsidian.ts");

async function resetStorage() {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  coreDb.getDbInstance();
  await coreDb.awaitDbMigrations();
}

function createTestApiKey(id: string, name: string) {
  const db = coreDb.getDbInstance();
  db.prepare(
    "INSERT OR IGNORE INTO api_keys (id, name, key, machine_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name, `sk-test-${id}`, "test-machine", "[]", new Date().toISOString());
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("apiKeyContextSources: returns null for unknown apiKeyId", async () => {
  const result = await getApiKeyContextSource("unknown-id", "obsidian");
  assert.equal(result, null);
});

test("apiKeyContextSources: stores and retrieves per-key config", async () => {
  createTestApiKey("key-1", "Test Key 1");
  await setApiKeyContextSource("key-1", "obsidian", {
    baseUrl: "http://10.0.0.1:27123",
    token: "test-token-123",
    vaultPath: "/test/path",
    enabled: true,
  });
  const result = await getApiKeyContextSource("key-1", "obsidian");
  assert.ok(result);
  assert.equal(result.baseUrl, "http://10.0.0.1:27123");
  assert.equal(result.token, "test-token-123");
  assert.equal(result.vaultPath, "/test/path");
  assert.equal(result.enabled, true);
  assert.equal(result.sourceType, "obsidian");
});

test("apiKeyContextSources: upsert updates existing config", async () => {
  createTestApiKey("key-2", "Test Key 2");
  await setApiKeyContextSource("key-2", "obsidian", { token: "v1", enabled: true });
  const first = await getApiKeyContextSource("key-2", "obsidian");
  assert.equal(first?.token, "v1");

  await setApiKeyContextSource("key-2", "obsidian", { token: "v2", baseUrl: "http://new:27123" });
  const second = await getApiKeyContextSource("key-2", "obsidian");
  assert.equal(second?.token, "v2");
  assert.equal(second?.baseUrl, "http://new:27123");
});

test("apiKeyContextSources: returns null when disabled", async () => {
  createTestApiKey("key-3", "Test Key 3");
  await setApiKeyContextSource("key-3", "obsidian", { token: "tok", enabled: false });
  const result = await getApiKeyContextSource("key-3", "obsidian");
  assert.equal(result, null);
});

test("apiKeyContextSources: delete removes config", async () => {
  createTestApiKey("key-4", "Test Key 4");
  await setApiKeyContextSource("key-4", "obsidian", { token: "tok", enabled: true });
  await deleteApiKeyContextSource("key-4", "obsidian");
  const result = await getApiKeyContextSource("key-4", "obsidian");
  assert.equal(result, null);
});

test("apiKeyContextSources: list returns all sources for a key", async () => {
  createTestApiKey("key-5", "Test Key 5");
  await setApiKeyContextSource("key-5", "obsidian", { token: "obs", enabled: true });
  await setApiKeyContextSource("key-5", "notion", { token: "not", enabled: true });
  const results = await listApiKeyContextSources("key-5");
  assert.equal(results.length, 2);
  const types = results.map((r) => r.sourceType).sort();
  assert.deepEqual(types, ["notion", "obsidian"]);
});

test("getObsidianConfigForApiKey: falls back to global when no per-key config", async () => {
  await setObsidianToken("global-token-123");
  await setObsidianBaseUrl("http://127.0.0.1:27123");

  const config = await getObsidianConfigForApiKey("nonexistent-key");
  assert.equal(config.source, "global");
  assert.equal(config.token, "global-token-123");
  assert.equal(config.baseUrl, "http://127.0.0.1:27123");
});

test("getObsidianConfigForApiKey: falls back to global for null/undefined keyId", async () => {
  await setObsidianToken("global-token-456");
  await setObsidianBaseUrl("http://127.0.0.1:27123");

  const c1 = await getObsidianConfigForApiKey(null);
  assert.equal(c1.source, "global");
  assert.equal(c1.token, "global-token-456");

  const c2 = await getObsidianConfigForApiKey(undefined);
  assert.equal(c2.source, "global");
});

test("getObsidianConfigForApiKey: uses per-key config when available", async () => {
  createTestApiKey("key-perkey", "Per-Key Test");
  await setObsidianToken("global-token-789");
  await setObsidianBaseUrl("http://127.0.0.1:27123");

  await setApiKeyContextSource("key-perkey", "obsidian", {
    baseUrl: "http://10.0.0.1:27123",
    token: "per-key-token",
    vaultPath: "/custom/path",
    enabled: true,
  });

  const config = await getObsidianConfigForApiKey("key-perkey");
  assert.equal(config.source, "api_key");
  assert.equal(config.token, "per-key-token");
  assert.equal(config.baseUrl, "http://10.0.0.1:27123");
  assert.equal(config.vaultPath, "/custom/path");
});

test("getObsidianConfigForApiKey: per-key without baseUrl falls back to global baseUrl", async () => {
  createTestApiKey("key-nobase", "No BaseUrl Test");
  await setObsidianToken("global-token-abc");
  await setObsidianBaseUrl("http://global:27123");

  await setApiKeyContextSource("key-nobase", "obsidian", {
    token: "per-key-only",
    enabled: true,
  });

  const config = await getObsidianConfigForApiKey("key-nobase");
  assert.equal(config.source, "api_key");
  assert.equal(config.token, "per-key-only");
  assert.equal(config.baseUrl, "http://global:27123");
});

test("getObsidianConfigForApiKey: disabled per-key falls back to global", async () => {
  createTestApiKey("key-disabled", "Disabled Test");
  await setObsidianToken("global-token-def");
  await setObsidianBaseUrl("http://127.0.0.1:27123");

  await setApiKeyContextSource("key-disabled", "obsidian", {
    token: "disabled-token",
    enabled: false,
  });

  const config = await getObsidianConfigForApiKey("key-disabled");
  assert.equal(config.source, "global");
  assert.equal(config.token, "global-token-def");
});
