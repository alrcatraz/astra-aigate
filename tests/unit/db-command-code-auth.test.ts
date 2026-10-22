import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-command-code-auth-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const coreDb = await import("../../src/lib/db/core.ts");
const commandCodeAuthDb = await import("../../src/lib/db/commandCodeAuth.ts");

async function resetStorage() {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  coreDb.getDbInstance();
  await coreDb.awaitDbMigrations();
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("status lookup expires stale pending command-code auth sessions", async () => {
  const stateHash = commandCodeAuthDb.hashCommandCodeAuthState("expired-state");
  const session = await commandCodeAuthDb.createPendingCommandCodeAuthSession({
    stateHash,
    expiresAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(session.status, "pending");

  const status = await commandCodeAuthDb.getCommandCodeAuthSessionSafeStatus(stateHash);

  assert.equal(status?.status, "expired");
  assert.equal(status?.stateHash, stateHash);
});

test("consume returns the received api key once and marks the session applied", async () => {
  const stateHash = commandCodeAuthDb.hashCommandCodeAuthState("received-state");
  await commandCodeAuthDb.createPendingCommandCodeAuthSession({
    stateHash,
    expiresAt: "2999-01-01T00:00:00.000Z",
  });

  const received = await commandCodeAuthDb.markCommandCodeAuthSessionReceived({
    stateHash,
    apiKey: "sk-test-command-code",
    metadata: { userId: "user-1", userName: "Test User" },
  });

  assert.equal(received?.status, "received");
  assert.equal(received?.metadata?.userId, "user-1");

  const consumed = await commandCodeAuthDb.consumeCommandCodeAuthSecret(stateHash);

  assert.equal(consumed?.apiKey, "sk-test-command-code");
  assert.equal(consumed?.status, "applied");

  assert.equal(await commandCodeAuthDb.consumeCommandCodeAuthSecret(stateHash), null);
  assert.equal(
    (await commandCodeAuthDb.getCommandCodeAuthSessionSafeStatus(stateHash))?.status,
    "applied"
  );
});
