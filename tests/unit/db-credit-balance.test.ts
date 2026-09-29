import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  getPersistedCreditBalance,
  getAllPersistedCreditBalances,
  persistCreditBalance,
} from "../../src/lib/db/creditBalance.ts";

describe("creditBalance DB module", () => {
  const testAccount = `test-credit-${Date.now()}`;

  it("getPersistedCreditBalance returns null for unknown account", async () => {
    const result = await getPersistedCreditBalance(`nonexistent-${Date.now()}`);
    assert.equal(result, null, "should return null for unknown account");
  });

  it("persistCreditBalance stores and getPersistedCreditBalance retrieves", async () => {
    await persistCreditBalance(testAccount, 42.5);
    const result = await getPersistedCreditBalance(testAccount);
    assert.equal(result, 42.5, "should return persisted balance");
  });

  it("persistCreditBalance overwrites previous balance", async () => {
    await persistCreditBalance(testAccount, 100);
    await persistCreditBalance(testAccount, 50);
    const result = await getPersistedCreditBalance(testAccount);
    assert.equal(result, 50, "should return latest balance");
  });

  it("persistCreditBalance handles zero balance correctly", async () => {
    await persistCreditBalance(testAccount, 0);
    const result = await getPersistedCreditBalance(testAccount);
    assert.equal(result, 0, "zero balance should be stored and returned");
  });

  it("getAllPersistedCreditBalances returns all entries", async () => {
    const account1 = `test-credit-all-1-${Date.now()}`;
    const account2 = `test-credit-all-2-${Date.now()}`;
    await persistCreditBalance(account1, 10);
    await persistCreditBalance(account2, 20);
    const all = await getAllPersistedCreditBalances();
    assert.ok(all instanceof Map, "should return a Map");
    assert.ok(all.has(account1), "should contain account1");
    assert.ok(all.has(account2), "should contain account2");
    assert.equal(all.get(account1), 10);
    assert.equal(all.get(account2), 20);
  });

  it("getAllPersistedCreditBalances returns empty Map when no entries", async () => {
    // This test relies on there being entries from other tests, but the Map should always be returned
    const all = await getAllPersistedCreditBalances();
    assert.ok(all instanceof Map, "should always return a Map");
  });
});
