import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { addXp, getXp } from "../../../src/lib/db/gamification";
import { calculateLevel } from "../../../src/lib/gamification/xp";
import { getDbInstance, awaitDbMigrations } from "../../../src/lib/db/core";

describe("DB Gamification — addXp level computation", () => {
  before(async () => {
    // getDbInstance() kicks migrations off lazily; join the barrier before the
    // first query or user_levels / xp_audit_log may not exist yet.
    getDbInstance();
    await awaitDbMigrations();
  });

  it("sets correct level for large initial XP", async () => {
    const testKey = `test-addxp-level-${Date.now()}`;
    await addXp(testKey, "invite_redeem", 50000);

    const xp = await getXp(testKey);
    assert.ok(xp);
    assert.equal(xp.currentLevel, calculateLevel(50000));

    // Cleanup
    const db = getDbInstance();
    db.prepare("DELETE FROM user_levels WHERE api_key_id = ?").run(testKey);
    db.prepare("DELETE FROM xp_audit_log WHERE api_key_id = ?").run(testKey);
  });

  it("sets level 1 for small initial XP", async () => {
    const testKey = `test-addxp-small-${Date.now()}`;
    await addXp(testKey, "request", 1);

    const xp = await getXp(testKey);
    assert.ok(xp);
    assert.equal(xp.currentLevel, 1);

    // Cleanup
    const db = getDbInstance();
    db.prepare("DELETE FROM user_levels WHERE api_key_id = ?").run(testKey);
    db.prepare("DELETE FROM xp_audit_log WHERE api_key_id = ?").run(testKey);
  });
});
