import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-domain-lockout-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const lockoutPolicy = await import("../../src/domain/lockoutPolicy.ts");

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

const originalDateNow = Date.now;

test.beforeEach(async () => {
  Date.now = originalDateNow;
  await resetStorage();
});

test.after(async () => {
  Date.now = originalDateNow;
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("checkLockout starts unlocked and locks after reaching the configured threshold", async () => {
  let now = 1_000;
  Date.now = () => now;

  const id = "lockout-threshold";
  const config = {
    maxAttempts: 3,
    lockoutDurationMs: 500,
    attemptWindowMs: 200,
  };

  assert.deepEqual(await lockoutPolicy.checkLockout(id, config), {
    locked: false,
    attempts: 0,
  });

  assert.deepEqual(await lockoutPolicy.recordFailedAttempt(id, config), { locked: false });
  now += 50;
  assert.deepEqual(await lockoutPolicy.recordFailedAttempt(id, config), { locked: false });
  now += 50;
  assert.deepEqual(await lockoutPolicy.recordFailedAttempt(id, config), {
    locked: true,
    remainingMs: 500,
  });

  const locked = await lockoutPolicy.checkLockout(id, config);
  assert.equal(locked.locked, true);
  assert.equal(locked.attempts, 3);
  assert.equal(locked.remainingMs, 500);
});

test("expired lockouts are cleared and stale attempts outside the window are pruned", async () => {
  let now = 10_000;
  Date.now = () => now;

  const id = "lockout-expiry";
  const config = {
    maxAttempts: 2,
    lockoutDurationMs: 100,
    attemptWindowMs: 50,
  };

  await lockoutPolicy.recordFailedAttempt(id, config);
  now += 60;
  assert.deepEqual(await lockoutPolicy.recordFailedAttempt(id, config), { locked: false });

  now += 10;
  assert.deepEqual(await lockoutPolicy.recordFailedAttempt(id, config), {
    locked: true,
    remainingMs: 100,
  });

  now += 120;
  assert.deepEqual(await lockoutPolicy.checkLockout(id, config), {
    locked: false,
    attempts: 0,
  });
});

test("recordSuccess and forceUnlock remove tracked identifiers", async () => {
  const config = {
    maxAttempts: 1,
    lockoutDurationMs: 1_000,
    attemptWindowMs: 1_000,
  };

  await lockoutPolicy.recordFailedAttempt("unlock-success", config);
  assert.equal((await lockoutPolicy.checkLockout("unlock-success", config)).locked, true);
  await lockoutPolicy.recordSuccess("unlock-success");
  assert.deepEqual(await lockoutPolicy.checkLockout("unlock-success", config), {
    locked: false,
    attempts: 0,
  });

  await lockoutPolicy.recordFailedAttempt("unlock-force", config);
  assert.equal((await lockoutPolicy.checkLockout("unlock-force", config)).locked, true);
  await lockoutPolicy.forceUnlock("unlock-force");
  assert.deepEqual(await lockoutPolicy.checkLockout("unlock-force", config), {
    locked: false,
    attempts: 0,
  });
});

test("getLockedIdentifiers returns active lockouts and filters expired ones", async () => {
  let now = 20_000;
  Date.now = () => now;

  const shortConfig = {
    maxAttempts: 1,
    lockoutDurationMs: 50,
    attemptWindowMs: 500,
  };
  const longConfig = {
    maxAttempts: 1,
    lockoutDurationMs: 500,
    attemptWindowMs: 500,
  };

  await lockoutPolicy.recordFailedAttempt("expired-id", shortConfig);
  await lockoutPolicy.recordFailedAttempt("active-id", longConfig);
  now += 100;

  const locked = await lockoutPolicy.getLockedIdentifiers();

  assert.ok(locked.some((entry) => entry.identifier === "active-id"));
  assert.ok(!locked.some((entry) => entry.identifier === "expired-id"));
  assert.ok(locked.find((entry) => entry.identifier === "active-id").remainingMs > 0);
});
