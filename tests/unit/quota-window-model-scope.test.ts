import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateQuotaCutoff,
  windowAppliesToModel,
} from "@omniroute/open-sse/services/quotaPreflight.ts";

// Some providers expose one quota window per model id (e.g. deepseek's
// `deepseek-v4-flash-vision-exp`). Gating the whole connection on a sibling
// model's exhausted window strands every other model on that provider, so the
// cutoff must only consider generic account windows plus the target's own
// model-scoped window.

const thresholds = {
  resolveMinRemainingPercent: (window: string | null) =>
    window && window.startsWith("window_") ? 15 : 2,
  resolveWarnRemainingPercent: () => 20,
};

test("model-scoped window of a sibling model does not block", () => {
  const quota = {
    windows: {
      "deepseek-v4-flash-vision-exp": { percentUsed: 1, resetAt: null },
      credits_cny: { percentUsed: 0.1, resetAt: null },
    },
  };
  const decision = evaluateQuotaCutoff(quota as never, thresholds as never, "deepseek-flash");
  assert.equal(decision.proceed, true);
});

test("the target's own model-scoped window still blocks", () => {
  const quota = {
    windows: { "deepseek-v4-flash-vision-exp": { percentUsed: 1, resetAt: null } },
  };
  const decision = evaluateQuotaCutoff(
    quota as never,
    thresholds as never,
    "deepseek-v4-flash-vision-exp"
  );
  assert.equal(decision.proceed, false);
});

test("generic account windows always apply, whatever the model", () => {
  const quota = { windows: { window_weekly: { percentUsed: 0.9, resetAt: null } } };
  const decision = evaluateQuotaCutoff(quota as never, thresholds as never, "qwen3.8-flash");
  assert.equal(decision.proceed, false);
});

test("no model filter keeps the historical behaviour", () => {
  const quota = {
    windows: { "deepseek-v4-flash-vision-exp": { percentUsed: 1, resetAt: null } },
  };
  assert.equal(evaluateQuotaCutoff(quota as never, thresholds as never).proceed, false);
});

test("windowAppliesToModel handles provider-prefixed ids and generic windows", () => {
  assert.equal(windowAppliesToModel("weekly", "opencode-go/deepseek-v4.1-flash"), true);
  assert.equal(windowAppliesToModel("credits", "anything"), true);
  assert.equal(
    windowAppliesToModel("deepseek-v4.1-flash", "opencode-go/deepseek-v4.1-flash"),
    true
  );
  assert.equal(windowAppliesToModel("deepseek-v4-flash-vision-exp", "deepseek-flash"), false);
});
