import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-db-domainstate-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const ds = await import("../../src/lib/db/domainState.ts");

async function resetStorage() {
  await core.resetDbInstanceDrained();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  core.getDbInstance();
  await core.awaitDbMigrations();
}

await resetStorage();

// ──────────────── Fallback Chains ────────────────

test("saveFallbackChain and loadFallbackChain round-trip", async () => {
  await resetStorage();
  const model = "gpt-4";
  const chain = [
    { provider: "openai", priority: 1, enabled: true },
    { provider: "anthropic", priority: 2, enabled: false },
  ];

  await ds.saveFallbackChain(model, chain);
  const loaded = await ds.loadFallbackChain(model);
  assert.deepEqual(loaded, chain);
});

test("loadFallbackChain returns null for missing model", async () => {
  await resetStorage();
  const result = await ds.loadFallbackChain("nonexistent");
  assert.equal(result, null);
});

test("loadAllFallbackChains returns all chains", async () => {
  await resetStorage();
  await ds.saveFallbackChain("model-a", [{ provider: "p1", priority: 1, enabled: true }]);
  await ds.saveFallbackChain("model-b", [{ provider: "p2", priority: 2, enabled: false }]);

  const all = await ds.loadAllFallbackChains();
  assert.ok("model-a" in all);
  assert.ok("model-b" in all);
  assert.equal((all["model-a"] as any[]).length, 1);
});

test("deleteFallbackChain removes a chain", async () => {
  await resetStorage();
  await ds.saveFallbackChain("to-delete", [{ provider: "p", priority: 1, enabled: true }]);
  assert.equal(await ds.deleteFallbackChain("to-delete"), true);
  assert.equal(await ds.loadFallbackChain("to-delete"), null);
});

test("deleteFallbackChain returns false when chain does not exist", async () => {
  await resetStorage();
  assert.equal(await ds.deleteFallbackChain("never-existed"), false);
});

test("deleteAllFallbackChains clears everything", async () => {
  await resetStorage();
  await ds.saveFallbackChain("a", [{ provider: "p", priority: 1, enabled: true }]);
  await ds.saveFallbackChain("b", [{ provider: "p", priority: 1, enabled: true }]);
  await ds.deleteAllFallbackChains();
  assert.deepEqual(await ds.loadAllFallbackChains(), {});
});

// ──────────────── Budgets ────────────────

test("saveBudget and loadBudget round-trip", async () => {
  await resetStorage();
  await ds.saveBudget("key-1", {
    dailyLimitUsd: 10,
    weeklyLimitUsd: 50,
    monthlyLimitUsd: 200,
    warningThreshold: 0.8,
    resetInterval: "daily",
    resetTime: "08:00",
    budgetResetAt: 1000,
    lastBudgetResetAt: 500,
    warningEmittedAt: 900,
    warningPeriodStart: 800,
  });

  const loaded = await ds.loadBudget("key-1");
  assert.ok(loaded !== null);
  assert.equal(loaded.dailyLimitUsd, 10);
  assert.equal(loaded.weeklyLimitUsd, 50);
  assert.equal(loaded.monthlyLimitUsd, 200);
  assert.equal(loaded.warningThreshold, 0.8);
  assert.equal(loaded.resetInterval, "daily");
  assert.equal(loaded.resetTime, "08:00");
  assert.equal(loaded.budgetResetAt, 1000);
  assert.equal(loaded.lastBudgetResetAt, 500);
  assert.equal(loaded.warningEmittedAt, 900);
  assert.equal(loaded.warningPeriodStart, 800);
});

test("loadBudget returns null for missing key", async () => {
  assert.equal(await ds.loadBudget("no-such-key"), null);
});

test("saveBudget with minimal fields uses defaults", async () => {
  await resetStorage();
  await ds.saveBudget("key-minimal", {});
  const loaded = await ds.loadBudget("key-minimal");
  assert.ok(loaded !== null);
  assert.equal(loaded.dailyLimitUsd, 0);
  assert.equal(loaded.warningThreshold, 0.8);
  assert.equal(loaded.resetInterval, "daily");
  assert.equal(loaded.resetTime, "00:00");
  assert.equal(loaded.budgetResetAt, null);
  assert.equal(loaded.lastBudgetResetAt, null);
});

test("loadAllBudgets returns all budget configs", async () => {
  await resetStorage();
  await ds.saveBudget("key-a", { dailyLimitUsd: 5 });
  await ds.saveBudget("key-b", { dailyLimitUsd: 10 });

  const all = await ds.loadAllBudgets();
  assert.equal(Object.keys(all).length, 2);
  assert.equal(all["key-a"].dailyLimitUsd, 5);
  assert.equal(all["key-b"].dailyLimitUsd, 10);
});

test("saveBudgetResetLog and loadBudgetResetLogs", async () => {
  await resetStorage();
  await ds.saveBudget("budget-key", { dailyLimitUsd: 10 });

  const now = Date.now();
  await ds.saveBudgetResetLog({
    apiKeyId: "budget-key",
    resetInterval: "daily",
    previousSpend: 8,
    resetAt: now,
    nextResetAt: now + 86400000,
    periodStart: now - 86400000,
    periodEnd: now,
  });

  const logs = await ds.loadBudgetResetLogs("budget-key");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].previousSpend, 8);
  assert.equal(logs[0].resetInterval, "daily");

  const noLogs = await ds.loadBudgetResetLogs("no-such-key");
  assert.deepEqual(noLogs, []);
});

test("deleteBudget removes budget and reset logs", async () => {
  await resetStorage();
  await ds.saveBudget("del-key", { dailyLimitUsd: 10 });
  await ds.saveBudgetResetLog({
    apiKeyId: "del-key",
    resetInterval: "daily",
    previousSpend: 3,
    resetAt: 1,
    nextResetAt: 2,
    periodStart: 0,
    periodEnd: 1,
  });
  await ds.deleteBudget("del-key");
  assert.equal(await ds.loadBudget("del-key"), null);
  assert.deepEqual(await ds.loadBudgetResetLogs("del-key"), []);
});

// ──────────────── Cost History ────────────────

test("saveCostEntry and loadCostTotal", async () => {
  await resetStorage();
  await ds.saveCostEntry("cost-key", 1.5, 1000);
  await ds.saveCostEntry("cost-key", 2.5, 2000);
  await ds.saveCostEntry("cost-key", 3.0, 3000);

  const total = ds.loadCostTotal("cost-key", 1500);
  assert.equal(total, 5.5); // 2.5 + 3.0

  const all = ds.loadCostTotal("cost-key", 0);
  assert.equal(all, 7.0);
});

test("loadCostTotal returns 0 for no entries", () => {
  assert.equal(ds.loadCostTotal("no-key", 0), 0);
});

test("batchSaveCostEntries inserts multiple entries", async () => {
  await resetStorage();
  await ds.batchSaveCostEntries([
    { apiKeyId: "batch-key", cost: 1, timestamp: 100 },
    { apiKeyId: "batch-key", cost: 2, timestamp: 200 },
  ]);
  assert.equal(ds.loadCostTotal("batch-key", 0), 3);
});

test("batchSaveCostEntries skips empty array", () => {
  assert.doesNotThrow(() => ds.batchSaveCostEntries([]));
});

test("loadCostEntries returns entries in order", async () => {
  await resetStorage();
  await ds.saveCostEntry("ce-key", 1, 100);
  await ds.saveCostEntry("ce-key", 2, 200);
  await ds.saveCostEntry("ce-key", 3, 300);

  const entries = await ds.loadCostEntries("ce-key", 150);
  assert.equal(entries.length, 2);
  assert.equal((entries[0] as any).cost, 2);
  assert.equal((entries[1] as any).cost, 3);
});

test("loadCostEntriesInRange returns bounded entries", async () => {
  await resetStorage();
  await ds.saveCostEntry("range-key", 1, 100);
  await ds.saveCostEntry("range-key", 2, 200);
  await ds.saveCostEntry("range-key", 3, 300);

  const entries = await ds.loadCostEntriesInRange("range-key", 150, 250);
  assert.equal(entries.length, 1);
  assert.equal((entries[0] as any).cost, 2);
});

test("cleanOldCostEntries deletes old entries", async () => {
  await resetStorage();
  await ds.saveCostEntry("clean-key", 1, 100);
  await ds.saveCostEntry("clean-key", 2, 200);
  await ds.saveCostEntry("clean-key", 3, 300);

  const deleted = await ds.cleanOldCostEntries(250);
  assert.equal(deleted, 2); // entries at 100 and 200
  assert.equal(ds.loadCostTotal("clean-key", 0), 3);
});

test("deleteCostEntries removes all for key", async () => {
  await resetStorage();
  await ds.saveCostEntry("del-cost", 5, 100);
  await ds.saveCostEntry("del-cost", 10, 200);
  await ds.deleteCostEntries("del-cost");
  assert.equal(ds.loadCostTotal("del-cost", 0), 0);
});

test("deleteAllCostData wipes budgets and cost data", async () => {
  await resetStorage();
  await ds.saveBudget("wipe-key", { dailyLimitUsd: 10 });
  await ds.saveCostEntry("wipe-key", 5, 100);
  await ds.deleteAllCostData();
  assert.equal(await ds.loadBudget("wipe-key"), null);
  assert.equal(ds.loadCostTotal("wipe-key", 0), 0);
});

// ──────────────── Lockout State ────────────────

test("saveLockoutState and loadLockoutState round-trip", async () => {
  await resetStorage();
  await ds.saveLockoutState("user-1", { attempts: [100, 200, 300], lockedUntil: 9999999999999 });
  const loaded = await ds.loadLockoutState("user-1");
  assert.ok(loaded !== null);
  assert.deepEqual(loaded.attempts, [100, 200, 300]);
  assert.equal(loaded.lockedUntil, 9999999999999);
});

test("loadLockoutState returns null for missing identifier", async () => {
  assert.equal(await ds.loadLockoutState("no-such"), null);
});

test("saveLockoutState with null lockedUntil", async () => {
  await resetStorage();
  await ds.saveLockoutState("not-locked", { attempts: [], lockedUntil: null });
  const loaded = await ds.loadLockoutState("not-locked");
  assert.ok(loaded !== null);
  assert.deepEqual(loaded.attempts, []);
  assert.equal(loaded.lockedUntil, null);
});

test("deleteLockoutState removes state", async () => {
  await resetStorage();
  await ds.saveLockoutState("del-lock", { attempts: [1], lockedUntil: null });
  await ds.deleteLockoutState("del-lock");
  assert.equal(await ds.loadLockoutState("del-lock"), null);
});

test("loadAllLockedIdentifiers returns only currently locked", async () => {
  await resetStorage();
  await ds.saveLockoutState("locked-now", { attempts: [1], lockedUntil: Date.now() + 3600000 });
  await ds.saveLockoutState("expired", { attempts: [1], lockedUntil: Date.now() - 3600000 });
  await ds.saveLockoutState("no-lock", { attempts: [], lockedUntil: null });

  const locked = await ds.loadAllLockedIdentifiers();
  assert.equal(locked.length, 1);
  assert.equal(locked[0].identifier, "locked-now");
});

// ──────────────── Circuit Breakers ────────────────

test("saveCircuitBreakerState and loadCircuitBreakerState round-trip", async () => {
  await resetStorage();
  await ds.saveCircuitBreakerState("cb-1", {
    state: "OPEN",
    failureCount: 5,
    lastFailureTime: 1000,
    options: { timeout: 30000 },
  });

  const loaded = await ds.loadCircuitBreakerState("cb-1");
  assert.ok(loaded !== null);
  assert.equal(loaded.state, "OPEN");
  assert.equal(loaded.failureCount, 5);
  assert.equal(loaded.lastFailureTime, 1000);
  assert.deepEqual(loaded.options, { timeout: 30000 });
});

test("loadCircuitBreakerState returns null for missing name", async () => {
  assert.equal(await ds.loadCircuitBreakerState("no-such"), null);
});

test("saveCircuitBreakerState without options", async () => {
  await resetStorage();
  await ds.saveCircuitBreakerState("cb-simple", {
    state: "CLOSED",
    failureCount: 0,
    lastFailureTime: null,
  });
  const loaded = await ds.loadCircuitBreakerState("cb-simple");
  assert.ok(loaded !== null);
  assert.equal(loaded.state, "CLOSED");
  assert.equal(loaded.failureCount, 0);
  assert.equal(loaded.lastFailureTime, null);
  assert.equal(loaded.options, null);
});

test("loadAllCircuitBreakerStates returns all", async () => {
  await resetStorage();
  await ds.saveCircuitBreakerState("cb-a", {
    state: "HALF_OPEN",
    failureCount: 2,
    lastFailureTime: 500,
  });
  await ds.saveCircuitBreakerState("cb-b", {
    state: "CLOSED",
    failureCount: 0,
    lastFailureTime: null,
  });

  const all = await ds.loadAllCircuitBreakerStates();
  assert.equal(all.length, 2);
  const names = all.map((r: any) => r.name).sort();
  assert.deepEqual(names, ["cb-a", "cb-b"]);
});

test("deleteCircuitBreakerState removes state", async () => {
  await resetStorage();
  await ds.saveCircuitBreakerState("del-cb", {
    state: "OPEN",
    failureCount: 1,
    lastFailureTime: 100,
  });
  await ds.deleteCircuitBreakerState("del-cb");
  assert.equal(await ds.loadCircuitBreakerState("del-cb"), null);
});

test("deleteAllCircuitBreakerStates clears everything", async () => {
  await resetStorage();
  await ds.saveCircuitBreakerState("a", { state: "OPEN", failureCount: 1, lastFailureTime: 100 });
  await ds.saveCircuitBreakerState("b", {
    state: "CLOSED",
    failureCount: 0,
    lastFailureTime: null,
  });
  await ds.deleteAllCircuitBreakerStates();
  assert.deepEqual(await ds.loadAllCircuitBreakerStates(), []);
});
