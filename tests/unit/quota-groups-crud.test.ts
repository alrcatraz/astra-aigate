/**
 * tests/unit/quota-groups-crud.test.ts
 *
 * Task B2 — quotaGroups DB module CRUD.
 *
 * Coverage:
 * - createGroup → getGroup returns it; getGroupName returns the name.
 * - listGroups includes the seeded 'group-demo' + the newly created one.
 * - renameGroup changes the name (getGroup + getGroupName reflect the new name).
 * - deleteGroup with NO pools → returns true.
 * - deleteGroup of a group WITH a pool → throws /pools/i.
 * - deleteGroup('group-demo') → throws (protected seed group).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── DB harness (mirrors quota-groups-migration.test.ts) ──────────────────────
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-quota-groups-crud-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const groupsDb = await import("../../src/lib/db/quotaGroups.ts");
const poolsDb = await import("../../src/lib/db/quotaPools.ts");

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

// ── B2.1: createGroup / getGroup / getGroupName ───────────────────────────────

test("createGroup returns a QuotaGroup with id, name, createdAt", async () => {
  const group = await groupsDb.createGroup("My Test Group");

  assert.ok(group.id, "id should be set");
  assert.equal(group.name, "My Test Group");
  assert.ok(group.createdAt, "createdAt should be set");
});

test("getGroup returns the group after creation", async () => {
  const created = await groupsDb.createGroup("Findable Group");
  const found = await groupsDb.getGroup(created.id);

  assert.ok(found, "getGroup should find the group");
  assert.equal(found!.id, created.id);
  assert.equal(found!.name, "Findable Group");
  assert.ok(found!.createdAt);
});

test("getGroup returns null for unknown id", async () => {
  const result = await groupsDb.getGroup("nonexistent-id");
  assert.equal(result, null);
});

test("getGroupName returns the name for a known group", async () => {
  const group = await groupsDb.createGroup("Name Test Group");
  const name = await groupsDb.getGroupName(group.id);
  assert.equal(name, "Name Test Group");
});

test("getGroupName returns null for unknown id", async () => {
  const result = await groupsDb.getGroupName("does-not-exist");
  assert.equal(result, null);
});

// ── B2.2: listGroups ──────────────────────────────────────────────────────────

test("listGroups includes the seeded group-demo row", async () => {
  // Trigger migrations by getting a DB handle.
  const groups = await groupsDb.listGroups();

  const demo = groups.find((g) => g.id === "group-demo");
  assert.ok(demo, "group-demo should appear in listGroups");
  assert.equal(demo!.name, "GroupDemo");
});

test("listGroups includes both seeded group-demo and a newly created group", async () => {
  const created = await groupsDb.createGroup("New List Group");
  const groups = await groupsDb.listGroups();

  const ids = groups.map((g) => g.id);
  assert.ok(ids.includes("group-demo"), "group-demo should be in the list");
  assert.ok(ids.includes(created.id), "newly created group should be in the list");
  assert.ok(groups.length >= 2, "list should have at least 2 entries");
});

test("listGroups is ordered by created_at ascending", async () => {
  // group-demo was seeded first; any new group comes after.
  await groupsDb.createGroup("After Demo");
  const groups = await groupsDb.listGroups();

  const demoIdx = groups.findIndex((g) => g.id === "group-demo");
  assert.ok(demoIdx >= 0, "group-demo should be in the list");
  // The seeded group-demo should appear at some position; newer groups after.
  const afterIdx = groups.findIndex((g) => g.name === "After Demo");
  assert.ok(afterIdx > demoIdx, "newly created group should appear after group-demo");
});

// ── B2.3: renameGroup ─────────────────────────────────────────────────────────

test("renameGroup changes the group name", async () => {
  const group = await groupsDb.createGroup("Original Name");
  const result = await groupsDb.renameGroup(group.id, "Renamed Name");

  assert.equal(result, true, "renameGroup should return true on success");

  const updated = await groupsDb.getGroup(group.id);
  assert.ok(updated, "group should still exist after rename");
  assert.equal(updated!.name, "Renamed Name");
});

test("renameGroup returns false for non-existent id", async () => {
  const result = await groupsDb.renameGroup("ghost-id", "New Name");
  assert.equal(result, false);
});

test("getGroupName returns updated name after renameGroup", async () => {
  const group = await groupsDb.createGroup("Before Rename");
  await groupsDb.renameGroup(group.id, "After Rename");
  assert.equal(await groupsDb.getGroupName(group.id), "After Rename");
});

// ── B2.4: deleteGroup ─────────────────────────────────────────────────────────

test("deleteGroup with no pools returns true and removes the group", async () => {
  const group = await groupsDb.createGroup("Empty Group");
  const result = await groupsDb.deleteGroup(group.id);

  assert.equal(result, true, "deleteGroup should return true");
  assert.equal(await groupsDb.getGroup(group.id), null, "group should no longer exist");
});

test("deleteGroup returns false for non-existent id", async () => {
  const result = await groupsDb.deleteGroup("ghost-group");
  assert.equal(result, false);
});

test("deleteGroup throws when a pool still references the group", async () => {
  const group = await groupsDb.createGroup("Group With Pool");

  // Create a pool referencing this group.
  await poolsDb.createPool({
    connectionId: "conn-in-group",
    name: "Blocking Pool",
    groupId: group.id,
  });

  await assert.rejects(
    () => groupsDb.deleteGroup(group.id),
    /pools/i,
    "deleteGroup should throw a message mentioning pools"
  );

  // Group should still exist.
  const stillThere = await groupsDb.getGroup(group.id);
  assert.ok(stillThere, "group should still exist after failed delete");
});

test("deleteGroup('group-demo') throws (protected seed group)", async () => {
  await assert.rejects(
    () => groupsDb.deleteGroup("group-demo"),
    /group-demo/i,
    "deleteGroup should throw for the protected group-demo id"
  );
});
