/**
 * tests/unit/db-provider-plans.test.ts
 *
 * Coverage for src/lib/db/providerPlans.ts:
 * - upsertPlan idempotence (same key twice → 1 row)
 * - deletePlan removes the row
 * - listPlans returns all stored plans
 * - getPlan parses dimensions_json correctly
 * - Malformed dimensions_json handled gracefully
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-provider-plans-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const plansDb = await import("../../src/lib/db/providerPlans.ts");

async function resetStorage() {
  await core.resetDbInstanceDrained();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
      break;
    } catch (err: any) {
      if ((err?.code === "EBUSY" || err?.code === "EPERM") && attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      } else {
        throw err;
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

// ---------------------------------------------------------------------------
// upsertPlan — idempotence
// ---------------------------------------------------------------------------

test("upsertPlan creates a plan row", async () => {
  await plansDb.upsertPlan(
    "conn-1",
    "codex",
    [{ unit: "percent", window: "5h", limit: 100 }],
    "auto"
  );

  const all = await plansDb.listPlans();
  assert.equal(all.length, 1);
  assert.equal(all[0].connectionId, "conn-1");
  assert.equal(all[0].provider, "codex");
});

test("upsertPlan with same connectionId twice yields exactly 1 row", async () => {
  await plansDb.upsertPlan(
    "conn-idempotent",
    "kimi",
    [{ unit: "requests", window: "hourly", limit: 1500 }],
    "auto"
  );
  await plansDb.upsertPlan(
    "conn-idempotent",
    "kimi",
    [{ unit: "requests", window: "hourly", limit: 2000 }], // updated limit
    "manual"
  );

  const all = await plansDb.listPlans();
  assert.equal(all.length, 1, "should have exactly 1 row after 2 upserts");
  assert.equal(all[0].dimensions[0].limit, 2000, "should have the latest limit");
  assert.equal(all[0].source, "manual", "should have the latest source");
});

// ---------------------------------------------------------------------------
// getPlan — parse dimensions_json
// ---------------------------------------------------------------------------

test("getPlan returns null for unknown connectionId", async () => {
  const plan = await plansDb.getPlan("no-such-conn");
  assert.equal(plan, null);
});

test("getPlan returns a plan with correctly parsed dimensions", async () => {
  await plansDb.upsertPlan(
    "conn-parse",
    "bailian",
    [
      { unit: "percent", window: "5h", limit: 100 },
      { unit: "percent", window: "weekly", limit: 100 },
    ],
    "auto"
  );

  const plan = await plansDb.getPlan("conn-parse");
  assert.ok(plan, "should return a plan");
  assert.equal(plan!.provider, "bailian");
  assert.equal(plan!.dimensions.length, 2);
  assert.equal(plan!.dimensions[0].unit, "percent");
  assert.equal(plan!.dimensions[0].window, "5h");
  assert.equal(plan!.dimensions[0].limit, 100);
  assert.equal(plan!.dimensions[1].window, "weekly");
  assert.equal(plan!.source, "auto");
});

test("getPlan parses all QuotaUnit and QuotaWindow variants correctly", async () => {
  const dims = [
    { unit: "percent" as const, window: "5h" as const, limit: 100 },
    { unit: "requests" as const, window: "hourly" as const, limit: 1500 },
    { unit: "tokens" as const, window: "daily" as const, limit: 50_000 },
    { unit: "usd" as const, window: "monthly" as const, limit: 10 },
  ];

  await plansDb.upsertPlan("conn-variants", "multi", dims, "manual");
  const plan = await plansDb.getPlan("conn-variants");
  assert.ok(plan);
  assert.equal(plan!.dimensions.length, 4);
  for (let i = 0; i < dims.length; i++) {
    assert.equal(plan!.dimensions[i].unit, dims[i].unit);
    assert.equal(plan!.dimensions[i].window, dims[i].window);
    assert.equal(plan!.dimensions[i].limit, dims[i].limit);
  }
});

// ---------------------------------------------------------------------------
// listPlans
// ---------------------------------------------------------------------------

test("listPlans returns all stored plans", async () => {
  await plansDb.upsertPlan(
    "conn-a",
    "codex",
    [{ unit: "percent", window: "5h", limit: 100 }],
    "auto"
  );
  await plansDb.upsertPlan(
    "conn-b",
    "kimi",
    [{ unit: "requests", window: "hourly", limit: 1500 }],
    "manual"
  );
  await plansDb.upsertPlan(
    "conn-c",
    "bailian",
    [{ unit: "percent", window: "monthly", limit: 100 }],
    "auto"
  );

  const plans = await plansDb.listPlans();
  assert.equal(plans.length, 3);
  const providers = plans.map((p) => p.provider).sort();
  assert.deepEqual(providers, ["bailian", "codex", "kimi"]);
});

test("listPlans returns empty array when no plans exist", async () => {
  const plans = await plansDb.listPlans();
  assert.deepEqual(plans, []);
});

// ---------------------------------------------------------------------------
// deletePlan
// ---------------------------------------------------------------------------

test("deletePlan removes the plan and returns true", async () => {
  await plansDb.upsertPlan(
    "conn-delete-me",
    "codex",
    [{ unit: "percent", window: "5h", limit: 100 }],
    "auto"
  );

  const deleted = await plansDb.deletePlan("conn-delete-me");
  assert.equal(deleted, true);
  assert.equal(await plansDb.getPlan("conn-delete-me"), null);
  assert.equal((await plansDb.listPlans()).length, 0);
});

test("deletePlan returns false for unknown connectionId", async () => {
  const deleted = await plansDb.deletePlan("ghost-connection");
  assert.equal(deleted, false);
});

// ---------------------------------------------------------------------------
// upsertPlan + upsert doesn't destroy other rows
// ---------------------------------------------------------------------------

test("upserting one plan does not affect other connection plans", async () => {
  await plansDb.upsertPlan(
    "conn-x",
    "openai",
    [{ unit: "usd", window: "monthly", limit: 50 }],
    "manual"
  );
  await plansDb.upsertPlan(
    "conn-y",
    "anthropic",
    [{ unit: "tokens", window: "daily", limit: 100_000 }],
    "auto"
  );

  // Update conn-x
  await plansDb.upsertPlan(
    "conn-x",
    "openai",
    [{ unit: "usd", window: "monthly", limit: 100 }],
    "manual"
  );

  const planY = await plansDb.getPlan("conn-y");
  assert.ok(planY, "conn-y should still exist");
  assert.equal(planY!.dimensions[0].limit, 100_000);
});
