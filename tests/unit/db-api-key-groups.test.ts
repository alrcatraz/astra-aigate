import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const core = await import("../../src/lib/db/core.ts");
before(async () => {
  core.getDbInstance();
  await core.awaitDbMigrations();
});

import {
  createKeyGroup,
  getKeyGroup,
  getAllKeyGroups,
  updateKeyGroup,
  deleteKeyGroup,
  addGroupPermission,
  getGroupPermissions,
  removeGroupPermission,
  addKeyToGroup,
  removeKeyFromGroup,
  getGroupMembers,
  getKeyGroupWithPermissions,
} from "../../src/lib/db/apiKeyGroups.ts";

describe("apiKeyGroups", () => {
  const groupName = `test-group-${Date.now()}`;

  it("createKeyGroup creates a group", async () => {
    const group = await createKeyGroup(groupName, "Test description");
    assert.ok(group.id, "should have id");
    assert.equal(group.name, groupName);
    assert.equal(group.description, "Test description");
  });

  it("getKeyGroup retrieves by id", async () => {
    const created = await createKeyGroup(`get-${Date.now()}`);
    const found = await getKeyGroup(created.id);
    assert.ok(found);
    assert.equal(found!.id, created.id);
  });

  it("getAllKeyGroups returns all groups", async () => {
    const all = await getAllKeyGroups();
    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 1);
  });

  it("updateKeyGroup updates name and description", async () => {
    const group = await createKeyGroup(`update-${Date.now()}`);
    await updateKeyGroup(group.id, { name: "updated-name", description: "updated-desc" });
    const found = await getKeyGroup(group.id);
    assert.equal(found!.name, "updated-name");
    assert.equal(found!.description, "updated-desc");
  });

  it("deleteKeyGroup removes group", async () => {
    const group = await createKeyGroup(`delete-${Date.now()}`);
    await deleteKeyGroup(group.id);
    assert.equal(await getKeyGroup(group.id), undefined);
  });

  it("addGroupPermission adds permission", async () => {
    const group = await createKeyGroup(`perm-${Date.now()}`);
    await addGroupPermission(group.id, "gpt-*", "allow");
    const perms = await getGroupPermissions(group.id);
    assert.ok(perms.length >= 1);
    assert.equal(perms[0].modelPattern, "gpt-*");
    assert.equal(perms[0].accessType, "allow");
  });

  it("removeGroupPermission removes permission", async () => {
    const group = await createKeyGroup(`rmperm-${Date.now()}`);
    await addGroupPermission(group.id, "claude-*", "allow");
    const perms = await getGroupPermissions(group.id);
    await removeGroupPermission(perms[0].id);
    assert.equal((await getGroupPermissions(group.id)).length, 0);
  });

  it("addKeyToGroup returns boolean (INSERT OR IGNORE)", async () => {
    const group = await createKeyGroup(`member-${Date.now()}`);
    const result = await addKeyToGroup("fake-key-id", group.id);
    assert.equal(typeof result, "boolean");
  });

  it("getGroupMembers returns array", async () => {
    const group = await createKeyGroup(`members-${Date.now()}`);
    const members = await getGroupMembers(group.id);
    assert.ok(Array.isArray(members));
  });

  it("removeKeyFromGroup returns boolean", async () => {
    const group = await createKeyGroup(`rmmember-${Date.now()}`);
    const result = await removeKeyFromGroup("nonexistent-key", group.id);
    assert.equal(typeof result, "boolean");
  });

  it("getKeyGroupWithPermissions returns group with permissions", async () => {
    const group = await createKeyGroup(`full-${Date.now()}`);
    await addGroupPermission(group.id, "test-*", "allow");
    const full = await getKeyGroupWithPermissions(group.id);
    assert.ok(full);
    assert.equal(full!.permissions.length, 1);
    assert.equal(typeof full!.memberCount, "number");
  });
});
