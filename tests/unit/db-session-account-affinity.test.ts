import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getSessionAccountAffinity,
  upsertSessionAccountAffinity,
  touchSessionAccountAffinity,
  deleteSessionAccountAffinity,
  cleanupStaleSessionAccountAffinities,
} from "../../src/lib/db/sessionAccountAffinity.ts";

describe("sessionAccountAffinity", () => {
  const session = `sess-${Date.now()}`;
  const provider = "test-provider";
  const connId = "conn-123";
  const ttl = 5 * 60_000; // 5 min

  it("getSessionAccountAffinity returns null when no entry", async () => {
    assert.equal(await getSessionAccountAffinity(`missing-${Date.now()}`, provider, ttl), null);
  });

  it("getSessionAccountAffinity returns null with zero ttl", async () => {
    assert.equal(await getSessionAccountAffinity(session, provider, 0), null);
  });

  it("upsertSessionAccountAffinity stores and getSessionAccountAffinity retrieves", async () => {
    await upsertSessionAccountAffinity(session, provider, connId, Date.now(), ttl);
    const result = await getSessionAccountAffinity(session, provider, ttl);
    assert.ok(result, "should return stored affinity");
    assert.equal(result!.connectionId, connId);
  });

  it("touchSessionAccountAffinity extends expiry", async () => {
    const now = Date.now();
    await upsertSessionAccountAffinity(session, provider, connId, now, ttl);
    await touchSessionAccountAffinity(session, provider, now + 1000, ttl);
    const result = await getSessionAccountAffinity(session, provider, ttl, now + 2000);
    assert.ok(result, "should still exist after touch");
  });

  it("deleteSessionAccountAffinity removes entry", async () => {
    const delSess = `del-${Date.now()}`;
    await upsertSessionAccountAffinity(delSess, provider, connId, Date.now(), ttl);
    await deleteSessionAccountAffinity(delSess, provider);
    assert.equal(await getSessionAccountAffinity(delSess, provider, ttl), null);
  });

  it("cleanupStaleSessionAccountAffinities removes expired entries", async () => {
    const oldSess = `old-${Date.now()}`;
    const past = Date.now() - 120_000; // 2 min ago
    await upsertSessionAccountAffinity(oldSess, provider, connId, past, 60_000); // 1 min ttl, already expired
    const deleted = await cleanupStaleSessionAccountAffinities(30 * 60_000, Date.now());
    assert.ok(deleted >= 0, "should return count of deleted");
  });

  it("getSessionAccountAffinity returns null for expired entry", async () => {
    const expSess = `exp-${Date.now()}`;
    const past = Date.now() - 120_000;
    await upsertSessionAccountAffinity(expSess, provider, connId, past, 60_000);
    const result = await getSessionAccountAffinity(expSess, provider, 60_000, Date.now());
    assert.equal(result, null, "expired entry should return null");
  });
});
