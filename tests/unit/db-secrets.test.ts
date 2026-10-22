import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-db-secrets-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const secretsDb = await import("../../src/lib/db/secrets.ts");

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

test("getPersistedSecret returns null for missing keys", async () => {
  assert.equal(await secretsDb.getPersistedSecret("missing"), null);
});

test("persistSecret stores and reads secrets from the key_value table", async () => {
  await secretsDb.persistSecret("oauth_token", "secret-value");

  assert.equal(await secretsDb.getPersistedSecret("oauth_token"), "secret-value");
});

test("persistSecret does not overwrite an existing secret because storage is insert-only", async () => {
  await secretsDb.persistSecret("api_token", "first-value");
  await secretsDb.persistSecret("api_token", "second-value");

  assert.equal(await secretsDb.getPersistedSecret("api_token"), "first-value");
});

test("malformed persisted rows are treated as missing secrets", async () => {
  const db = core.getDbInstance();
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "secrets",
    "broken",
    "not-json"
  );

  assert.equal(await secretsDb.getPersistedSecret("broken"), null);
});
