/**
 * One evaluation path for quota cutoffs.
 *
 * Regression: `preflightQuota` carried its own copy of the per-window loop, so
 * the model-scope filter added to `quotaWindowCutoffResult` never ran in
 * production — a per-model cutoff still blocked every model on the connection,
 * and blocked siblings were told the blocking window belonged to another model.
 * These tests pin the shared path and the model filter it applies.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  preflightQuota,
  registerQuotaFetcher,
  type QuotaInfo,
} from "../../open-sse/services/quotaPreflight.ts";

const MODEL_WINDOW: QuotaInfo = {
  used: 99,
  total: 100,
  percentUsed: 0.99,
  resetAt: "2026-11-22T06:08:40.000Z",
  windows: {
    "monthly:kimi-k3": {
      percentUsed: 0.99,
      resetAt: "2026-11-22T06:08:40.000Z",
      scope: "model",
      model: "kimi-k3",
    },
    window_monthly: {
      percentUsed: 0.31,
      resetAt: "2026-11-22T06:08:40.000Z",
      scope: "account",
    },
  },
};

const thresholds = {
  resolveMinRemainingPercent: (window: string | null) =>
    window && window.startsWith("monthly:") ? 100 : 2,
  resolveWarnRemainingPercent: () => 20,
};

test.beforeEach(() => {
  registerQuotaFetcher("scope-check", async () => MODEL_WINDOW);
});

test("a model window blocks its own model and names the window", async () => {
  const result = await preflightQuota(
    "scope-check",
    "conn-1",
    { requestedModel: "kimi-k3" },
    thresholds
  );
  assert.equal(result.proceed, false);
  assert.equal(result.windowScope, "model");
  assert.match(result.window ?? "", /kimi-k3/);
});

test("the same model window does not block a sibling model", async () => {
  const result = await preflightQuota(
    "scope-check",
    "conn-1",
    { requestedModel: "opencode-go/qwen3.8-flash" },
    thresholds
  );
  assert.equal(
    result.proceed,
    true,
    "sibling must pass: the only blocked window belongs to kimi-k3"
  );
});

test("without a requested model every window applies (legacy callers)", async () => {
  const result = await preflightQuota("scope-check", "conn-1", {}, thresholds);
  assert.equal(result.proceed, false);
});
