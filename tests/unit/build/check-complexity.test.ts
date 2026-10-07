// tests/unit/build/check-complexity.test.ts
// TDD test for check-complexity.mjs: the complexity ratchet must scan the SAME first-party
// scope documented in eslint.complexity.config.mjs `files` and in complexity-baseline.json
// (src + open-sse + bin). Task 6A.11 re-baselined the count claiming bin/electron coverage,
// but ESLINT_ARGS only passed src+open-sse — a fake-green gap (a god-function added under
// bin/ would pass the gate unseen). This test locks the scan scope to the documented one.
// 2026-10-05: electron/ dropped — this fork has no electron desktop target (OmniRoute upstream
// did), the dir does not exist, and ESLint 9 aborts on a positional dir with no matching files
// ("No files matching the pattern electron"), crashing the complexity-ratchets gate. electron/
// contributed 0 violations (only an ignored types.d.ts), so the baseline count is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { ESLINT_ARGS } from "../../../scripts/check/check-complexity.mjs";

test("check-complexity scans the full documented scope (src, open-sse, bin)", () => {
  assert.ok(
    ESLINT_ARGS.includes("bin"),
    "ESLINT_ARGS must include 'bin' — a new god-function under bin/ must not pass the gate green"
  );
  assert.ok(
    !ESLINT_ARGS.includes("electron"),
    "ESLINT_ARGS must NOT include 'electron' — the dir does not exist in this fork and ESLint 9 aborts on a positional dir with no matching files"
  );
  assert.ok(ESLINT_ARGS.includes("src"), "ESLINT_ARGS must include 'src'");
  assert.ok(ESLINT_ARGS.includes("open-sse"), "ESLINT_ARGS must include 'open-sse'");
});
