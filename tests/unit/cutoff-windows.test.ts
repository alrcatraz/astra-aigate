/**
 * The cutoff modal must offer every window the provider registers, not only the
 * ones that currently return a percentage — otherwise the family wildcards
 * (`5h:*`, `weekly:*`, `monthly:*`) that govern per-model windows are impossible
 * to configure from the dashboard.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCutoffWindows,
  cutoffWindowLabel,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/cutoffWindows.ts";

test("observed windows come first, in order, and are not duplicated", () => {
  const out = buildCutoffWindows(
    [{ name: "window_5h" }, { name: "window_monthly" }],
    ["window_monthly", "window_weekly", "5h:*"]
  );
  assert.deepEqual(
    out.map((o) => o.key),
    ["window_5h", "window_monthly", "window_weekly", "5h:*"]
  );
});

test("registered-only wildcard families are exposed with a readable label", () => {
  const out = buildCutoffWindows([{ name: "window_5h" }], ["5h:*", "weekly:*", "monthly:*"]);
  assert.deepEqual(
    out.map((o) => o.displayName),
    ["window_5h", "5h — all models", "weekly — all models", "monthly — all models"]
  );
});

test("credits windows and blank names are skipped", () => {
  const out = buildCutoffWindows(
    [{ name: "credits", isCredits: true }, { name: "" }, { name: "weekly" }],
    ["", "weekly"]
  );
  assert.deepEqual(
    out.map((o) => o.key),
    ["weekly"]
  );
});

test("labels", () => {
  assert.equal(cutoffWindowLabel("5h:*"), "5h — all models");
  assert.equal(cutoffWindowLabel("window_weekly"), "window_weekly");
});
