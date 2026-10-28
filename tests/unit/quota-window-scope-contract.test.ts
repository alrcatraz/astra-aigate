/**
 * Window-scope contract: a window declares whether it gates the whole
 * connection or a single model. Name-based inference is only the legacy path —
 * these tests pin that an explicit scope always wins, because a per-model
 * window named `5h:<model>` would otherwise be read as an account window by the
 * `window_`/`5h` prefix heuristic and would block every sibling model.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  windowAppliesToModel,
  windowBaseName,
  windowThresholdAliases,
} from "../../open-sse/services/quotaPreflight.ts";

test("explicit account scope always applies, whatever the window name looks like", () => {
  const info = { percentUsed: 0.9, scope: "account" as const };
  assert.equal(windowAppliesToModel("5h", "qwen3.8-flash", info), true);
  assert.equal(windowAppliesToModel("model-something-else", "qwen3.8-flash", info), true);
  assert.equal(windowAppliesToModel("deepseek-v4.1-flash", "qwen3.8-flash", info), true);
});

test("explicit model scope applies only to its own model, even with a generic-looking name", () => {
  const info = { percentUsed: 0.9, scope: "model" as const, model: "qwen3.8-flash" };
  assert.equal(windowAppliesToModel("5h:qwen3.8-flash", "qwen3.8-flash", info), true);
  assert.equal(windowAppliesToModel("5h:qwen3.8-flash", "opencode-go/qwen3.8-flash", info), true);
  assert.equal(windowAppliesToModel("5h:qwen3.8-flash", "deepseek-v4.1-flash", info), false);
  // a bare `5h` name must NOT leak to siblings when the scope says model
  assert.equal(windowAppliesToModel("5h", "deepseek-v4.1-flash", info), false);
});

test("model scope without a model filter applies (nothing to discriminate)", () => {
  const info = { percentUsed: 0.9, scope: "model" as const, model: "qwen3.8-flash" };
  assert.equal(windowAppliesToModel("5h:qwen3.8-flash", null, info), true);
  assert.equal(windowAppliesToModel("5h:qwen3.8-flash", "", info), true);
});

test("legacy heuristic is preserved when no scope is declared", () => {
  assert.equal(windowAppliesToModel("weekly", "opencode-go/deepseek-v4.1-flash"), true);
  assert.equal(windowAppliesToModel("credits", "anything"), true);
  assert.equal(windowAppliesToModel("deepseek-v4-flash-vision-exp", "deepseek-flash"), false);
});

test("base name and threshold aliases", () => {
  assert.equal(windowBaseName("5h:qwen3.8-flash"), "5h");
  assert.equal(windowBaseName("weekly"), "weekly");
  assert.deepEqual(windowThresholdAliases("5h:qwen3.8-flash"), ["5h:qwen3.8-flash", "5h:*", "5h"]);
  assert.deepEqual(windowThresholdAliases("monthly"), ["monthly"]);
});
