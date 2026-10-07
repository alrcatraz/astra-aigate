// tests/unit/dmxapi-combo-window-128k-fix.test.ts
//
// Regression guard: dmxapi-cn combos collapsing to a 128K context window.
//
// dmxapi-cn is an aggregator with no models.dev channel, so
// getSyncedCapability("dmxapi-cn", <id>) misses its own rows and falls back
// through SYNCED_CAPABILITY_FALLBACK_ALIASES. deepseek-v4.1-flash and
// mimo-v2.6-flash existed in NONE of the original four fallback channels
// (zhipuai/zai/alibaba/deepseek), and MODEL_SPECS had no entries either —
// both layers missed, the id fell to DEFAULT_LIMITS (128000), and every combo
// containing it computed combo-min = 128K: proactive compression fired at
// ~84K tokens and over-window requests were rejected (HTTP 400).
//
// Two independent layers now cover the lookup (this test pins both):
//   1. SYNCED_CAPABILITY_FALLBACK_ALIASES extended with aihubmix /
//      alibaba-token-plan / alibaba-cn — channels verified (2026-08-21 vs
//      2026-09-28 syncs) to carry the affected ids at 1M.
//   2. MODEL_SPECS entries for the three ids — a pure, sync-independent
//      backstop so a future models.dev channel reshuffle cannot regress this.
//
// Fixtures mirror the real production rows (read from the synced DB).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-dmxapi-ctx-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const modelSpecs = await import("../../src/shared/constants/modelSpecs.ts");
const { computeComboContextLength } = await import("../../src/lib/combos/comboContext.ts");

// Real rows from the 2026-09-28 sync (production storage.sqlite, read-only).
const REAL_SYNCED_DATA = {
  aihubmix: {
    "deepseek-v4.1-flash": {
      tool_call: true,
      reasoning: true,
      attachment: true,
      structured_output: true,
      temperature: true,
      modalities_input: JSON.stringify(["text", "image"]),
      modalities_output: JSON.stringify(["text"]),
      knowledge_cutoff: "2025-05",
      release_date: "2026-09-10",
      last_updated: "2026-09-10",
      status: null,
      family: "deepseek-flash",
      open_weights: true,
      limit_context: 1000000,
      limit_input: null,
      limit_output: 384000,
      interleaved_field: "reasoning_content",
    },
    "mimo-v2.6-flash": {
      tool_call: true,
      reasoning: true,
      attachment: true,
      structured_output: null,
      temperature: true,
      modalities_input: JSON.stringify(["text", "image", "audio", "video"]),
      modalities_output: JSON.stringify(["text"]),
      knowledge_cutoff: null,
      release_date: "2026-09-22",
      last_updated: "2026-09-22",
      status: null,
      family: "mimo",
      open_weights: true,
      limit_context: 1048576,
      limit_input: null,
      limit_output: 131072,
      interleaved_field: "reasoning_content",
    },
    "qwen3.8-flash": {
      tool_call: true,
      reasoning: true,
      attachment: true,
      structured_output: true,
      temperature: null,
      modalities_input: JSON.stringify(["text", "image", "video"]),
      modalities_output: JSON.stringify(["text"]),
      knowledge_cutoff: null,
      release_date: "2026-08-26",
      last_updated: "2026-08-26",
      status: null,
      family: "qwen",
      open_weights: false,
      limit_context: 1000000,
      limit_input: null,
      limit_output: 131072,
      interleaved_field: "reasoning_content",
    },
  },
  deepseek: {
    "deepseek-flash": {
      tool_call: true,
      reasoning: true,
      attachment: true,
      structured_output: true,
      temperature: true,
      modalities_input: JSON.stringify(["text", "image"]),
      modalities_output: JSON.stringify(["text"]),
      knowledge_cutoff: "2025-05",
      release_date: "2026-09-10",
      last_updated: "2026-09-10",
      status: null,
      family: "deepseek-flash",
      open_weights: true,
      limit_context: 1000000,
      limit_input: null,
      limit_output: 393216,
      interleaved_field: "reasoning_content",
    },
  },
};

before(async () => {
  // saveModelsDevCapabilities truncates the table first — seed every channel
  // this test needs in a single call.
  await modelsDevSync.saveModelsDevCapabilities(REAL_SYNCED_DATA);
});

after(async () => {
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe("dmxapi-cn synced-capability fallback (extended channels)", () => {
  it("deepseek-v4.1-flash resolves 1M/384K via aihubmix (was: 0/4 channels → null)", async () => {
    const cap = await modelsDevSync.getSyncedCapability("dmxapi-cn", "deepseek-v4.1-flash");
    assert.ok(cap, "expected the extended fallback list to find the aihubmix row");
    assert.equal(cap?.limit_context, 1000000);
    assert.equal(cap?.limit_output, 384000);
  });

  it("mimo-v2.6-flash resolves 1048576/131072 (was: 0/4 channels → null)", async () => {
    const cap = await modelsDevSync.getSyncedCapability("dmxapi-cn", "mimo-v2.6-flash");
    assert.ok(cap, "expected the extended fallback list to find the aihubmix row");
    assert.equal(cap?.limit_context, 1048576);
    assert.equal(cap?.limit_output, 131072);
  });

  it("qwen3.8-flash resolves 1M/131072 (was: alibaba-only hit; now two sources)", async () => {
    const cap = await modelsDevSync.getSyncedCapability("dmxapi-cn", "qwen3.8-flash");
    assert.ok(cap);
    assert.equal(cap?.limit_context, 1000000);
    assert.equal(cap?.limit_output, 131072);
  });

  it("direct provider lookup unchanged (regression)", async () => {
    const cap = await modelsDevSync.getSyncedCapability("aihubmix", "deepseek-v4.1-flash");
    assert.ok(cap);
    assert.equal(cap?.limit_context, 1000000);
  });

  it("unknown model under dmxapi-cn still returns null (regression)", async () => {
    const cap = await modelsDevSync.getSyncedCapability("dmxapi-cn", "no-such-model");
    assert.equal(cap, null);
  });
});

describe("MODEL_SPECS backstop (sync-independent layer)", () => {
  it("getCanonicalModelSpecId returns the exact ids (no prefix candidate existed)", () => {
    assert.equal(modelSpecs.getCanonicalModelSpecId("deepseek-v4.1-flash"), "deepseek-v4.1-flash");
    assert.equal(modelSpecs.getCanonicalModelSpecId("mimo-v2.6-flash"), "mimo-v2.6-flash");
    assert.equal(modelSpecs.getCanonicalModelSpecId("qwen3.8-flash"), "qwen3.8-flash");
  });

  it("spec context windows / outputs match the confirmed truths", () => {
    const deepseek = modelSpecs.getModelSpec("deepseek-v4.1-flash");
    assert.equal(deepseek?.contextWindow, 1000000);
    assert.equal(deepseek?.maxOutputTokens, 384000);

    const mimo = modelSpecs.getModelSpec("mimo-v2.6-flash");
    assert.equal(mimo?.contextWindow, 1048576);
    assert.equal(mimo?.maxOutputTokens, 131072);

    const qwen = modelSpecs.getModelSpec("qwen3.8-flash");
    assert.equal(qwen?.contextWindow, 1000000);
    assert.equal(qwen?.maxOutputTokens, 131072);
  });

  it("variant-qualifier inheritance still works for the v4-flash family (regression)", () => {
    assert.equal(
      modelSpecs.getCanonicalModelSpecId("deepseek-v4-flash-vision-exp"),
      "deepseek-v4-flash"
    );
    assert.equal(modelSpecs.getCanonicalModelSpecId("deepseek-v4-flash-0731"), "deepseek-v4-flash");
  });

  it("unknown id still returns null (regression)", () => {
    assert.equal(modelSpecs.getCanonicalModelSpecId("totally-unknown-model"), null);
  });
});

describe("end-to-end: computeComboContextLength (the /api/combos field)", () => {
  it("main-like combo with all three affected ids computes 1000000 (was 128000)", async () => {
    // Mirrors production combo/main: three dmxapi-cn members + deepseek/deepseek-flash.
    const combo = {
      name: "main",
      models: [
        "dmxapi-cn/mimo-v2.6-flash",
        "dmxapi-cn/qwen3.8-flash",
        "dmxapi-cn/deepseek-v4.1-flash",
        "deepseek/deepseek-flash",
      ],
    };

    const result = await computeComboContextLength(combo, []);

    assert.equal(
      result,
      1000000,
      "min(1048576, 1000000, 1000000, 1000000) = 1000000 — the 128K default " +
        "must no longer enter the computation for any member"
    );
  });

  it("single-member combo of deepseek-v4.1-flash alone computes 1000000", async () => {
    const combo = { name: "solo", models: ["dmxapi-cn/deepseek-v4.1-flash"] };
    const result = await computeComboContextLength(combo, []);
    assert.equal(result, 1000000);
  });
});
