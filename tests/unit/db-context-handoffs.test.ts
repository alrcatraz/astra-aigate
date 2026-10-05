import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
  upsertHandoff,
  getHandoff,
  deleteHandoff,
  cleanupExpiredHandoffs,
  hasActiveHandoff,
} from "../../src/lib/db/contextHandoffs.ts";
import { getDbInstance, awaitDbMigrations } from "../../src/lib/db/core.ts";

describe("contextHandoffs", () => {
  const sessionId = `handoff-sess-${Date.now()}`;
  const comboName = "test-combo";

  before(async () => {
    // getDbInstance() kicks migrations off lazily; join the barrier before the
    // first query or context_handoffs may not exist yet.
    getDbInstance();
    await awaitDbMigrations();
  });

  const payload = {
    sessionId,
    comboName,
    fromAccount: "account-1",
    summary: "Test summary",
    keyDecisions: ["decision-1", "decision-2"],
    taskProgress: "50%",
    activeEntities: ["entity-1"],
    messageCount: 10,
    model: "gpt-4o",
    warningThresholdPct: 0.85,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  it("upsertHandoff stores without throwing", async () => {
    await upsertHandoff(payload);
  });

  it("getHandoff retrieves stored handoff", async () => {
    const result = await getHandoff(sessionId, comboName);
    assert.ok(result, "should return handoff");
    assert.equal(result!.sessionId, sessionId);
    assert.equal(result!.comboName, comboName);
    assert.deepEqual(result!.keyDecisions, ["decision-1", "decision-2"]);
  });

  it("hasActiveHandoff returns true for existing handoff", async () => {
    assert.equal(await hasActiveHandoff(sessionId, comboName), true);
  });

  it("upsertHandoff overwrites existing handoff", async () => {
    await upsertHandoff({ ...payload, summary: "Updated summary" });
    const result = await getHandoff(sessionId, comboName);
    assert.equal(result!.summary, "Updated summary");
  });

  it("deleteHandoff removes entry", async () => {
    const delSession = `del-handoff-${Date.now()}`;
    await upsertHandoff({ ...payload, sessionId: delSession });
    await deleteHandoff(delSession, comboName);
    assert.equal(await getHandoff(delSession, comboName), null);
  });

  it("cleanupExpiredHandoffs removes expired entries", async () => {
    const expiredSession = `expired-${Date.now()}`;
    await upsertHandoff({
      ...payload,
      sessionId: expiredSession,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await cleanupExpiredHandoffs();
    assert.equal(await getHandoff(expiredSession, comboName), null);
  });

  it("getHandoff returns null for unknown session", async () => {
    assert.equal(await getHandoff(`unknown-${Date.now()}`, comboName), null);
  });
});
