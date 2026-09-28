/**
 * TASK AIG-AWAIT-01 — regression guard: the capability / token-limit API is
 * async (it reads the DB and the capability catalog) but call sites consumed it
 * synchronously. The consumer then received a Promise, read properties off it
 * (→ undefined) or compared it numerically (→ NaN), silently disabling combo
 * compression thresholds:
 *
 *   "Combo context limit: undefined (source=undefined)"
 *
 * This test pins the ASYNC contract at the unit level and adds a source guard
 * over chatCore.ts so a future edit cannot reintroduce a bare (un-awaited) call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-await-regression-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const contextManager = await import("../../open-sse/services/contextManager.ts");
const virtualFactory = await import("../../open-sse/services/autoCombo/virtualFactory.ts");

test.after(() => {
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Callers must receive a resolved value, never a pending Promise. */
function assertNotThenable(value: unknown, label: string): void {
  assert.ok(
    !(value !== null && typeof value === "object" && "then" in (value as object)),
    `${label} must be a resolved value, not a Promise`
  );
}

// ── 1. resolveComboContextLimit ─────────────────────────────────────────────

test("resolveComboContextLimit resolves to a finite limit (awaited)", async () => {
  const result = await contextManager.resolveComboContextLimit({
    provider: "gemini",
    model: "gemini-2.5-pro",
    comboTargetLimits: [32000, 1048576],
  });

  assertNotThenable(result, "resolveComboContextLimit()");
  assert.ok(Number.isFinite(result.limit), `limit must be finite, got ${result.limit}`);
  assert.equal(typeof result.source, "string");
  assert.equal(result.limit, 1048576);
  assert.equal(result.source, "target");
});

// ── 2. getComboTargetTokenLimit ─────────────────────────────────────────────

test("getComboTargetTokenLimit resolves to a positive finite number (awaited)", async () => {
  const limit = await contextManager.getComboTargetTokenLimit({
    modelStr: "anthropic/claude-sonnet-4-6",
  });

  assertNotThenable(limit, "getComboTargetTokenLimit()");
  assert.equal(typeof limit, "number");
  assert.ok(Number.isFinite(limit) && limit > 0, `limit must be positive, got ${limit}`);
});

// ── 3. Source guard: chatCore must await the async token-limit API ──────────

test("chatCore.ts awaits every getTokenLimit/resolveComboContextLimit call", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "open-sse/handlers/chatCore.ts"), "utf8");

  assert.doesNotMatch(
    src,
    /(?<!await\s)=\s*getTokenLimit\(/,
    "`= getTokenLimit(` must always be awaited in chatCore.ts"
  );
  assert.doesNotMatch(
    src,
    /(?<!await\s)=\s*resolveComboContextLimit\(/,
    "`= resolveComboContextLimit(` must always be awaited in chatCore.ts"
  );
  assert.doesNotMatch(
    src,
    /(?<!await\s)=\s*getComboTargetTokenLimit\(/,
    "`= getComboTargetTokenLimit(` must always be awaited in chatCore.ts"
  );
});

// ── 4. computeAdvertisedLimits (auto-combo catalog advertising) ─────────────

test("computeAdvertisedLimits advertises positive context/output limits (awaited)", async () => {
  const limits = await virtualFactory.computeAdvertisedLimits([
    { provider: "claude", model: "claude-sonnet-4-6" },
    { provider: "gemini", model: "gemini-2.5-pro" },
  ]);

  assertNotThenable(limits, "computeAdvertisedLimits()");
  assert.equal(limits.contextLength, 1048576);
  assert.ok(
    typeof limits.maxOutputTokens === "number" && limits.maxOutputTokens > 0,
    `maxOutputTokens must be positive, got ${limits.maxOutputTokens}`
  );
});
