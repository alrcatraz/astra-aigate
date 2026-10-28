/**
 * The per-connection quota-limit policy gate must honour window scope.
 *
 * Regression: with one per-connection cutoff configured for a model window
 * (`monthly:kimi-k3`), every request on that connection was blocked — the gate
 * iterated the configured window list without asking whether the window
 * belonged to the requested model, and the caller then persisted a
 * connection-wide `rateLimitedUntil` at the window's reset, taking the whole
 * connection out of rotation for a month.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateQuotaLimitPolicy } from "../../src/sse/services/auth.ts";
import { __clearForTests, setQuotaCache } from "../../src/domain/quotaCache.ts";

const RESET = new Date(Date.now() + 6 * 3600_000).toISOString();

function connection(windows: string[], thresholdPercent = 90) {
  return {
    id: "conn-scope",
    providerSpecificData: {
      limitPolicy: { enabled: true, thresholdPercent, windows },
    },
  } as never;
}

test.afterEach(() => {
  __clearForTests();
});

test("a model-scoped window does not gate sibling models", () => {
  setQuotaCache("conn-scope", "opencode-go", {
    "monthly:kimi-k3": {
      remainingPercentage: 1,
      resetAt: RESET,
      scope: "model",
      model: "kimi-k3",
    },
  });

  const siblings = evaluateQuotaLimitPolicy(
    "opencode-go",
    connection(["monthly:kimi-k3"]),
    "qwen3.8-flash"
  );
  assert.equal(siblings.blocked, false, "sibling model must not be blocked");

  const owner = evaluateQuotaLimitPolicy("opencode-go", connection(["monthly:kimi-k3"]), "kimi-k3");
  assert.equal(owner.blocked, true, "the owning model is blocked");
  assert.equal(owner.modelScoped, true);
});

test("account windows still gate every model", () => {
  setQuotaCache("conn-scope", "opencode-go", {
    weekly: { remainingPercentage: 0, resetAt: RESET, scope: "account" },
  });

  for (const model of ["qwen3.8-flash", "kimi-k3", null]) {
    const result = evaluateQuotaLimitPolicy("opencode-go", connection(["weekly"]), model);
    assert.equal(result.blocked, true, `account window must gate ${model}`);
    assert.equal(result.modelScoped, false);
  }
});

test("a mixed block is reported as connection-wide", () => {
  setQuotaCache("conn-scope", "opencode-go", {
    weekly: { remainingPercentage: 2, resetAt: RESET, scope: "account" },
    "monthly:kimi-k3": { remainingPercentage: 1, resetAt: RESET, scope: "model", model: "kimi-k3" },
  });

  const result = evaluateQuotaLimitPolicy(
    "opencode-go",
    connection(["weekly", "monthly:kimi-k3"]),
    "kimi-k3"
  );
  assert.equal(result.blocked, true);
  assert.equal(result.modelScoped, false, "an account window is involved");
});
