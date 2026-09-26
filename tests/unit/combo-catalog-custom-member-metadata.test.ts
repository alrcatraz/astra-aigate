/**
 * Regression tests for the `/v1/models` combo-metadata defect on
 * `feat/catalog-combo-custom-metadata` (branch base: development @7a6ef17).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRODUCTION EVIDENCE (why this file exists)
 * ─────────────────────────────────────────────────────────────────────────────
 * The operator's `main` combo —
 *
 *     dmxapi-cn/qwen3.8-flash + deepseek/deepseek-flash + dmxapi-cn/deepseek-v4.1-flash
 *
 * — is served by `GET /v1/models` with `context_length` and
 * `capabilities.vision` BOTH ABSENT (ctx `None` / vision `None` in the consumer),
 * while the internal compute path
 * (`GET /api/combos` → `computed_context_length`, i.e.
 * `computeComboContextLength()` in src/lib/combos/comboContext.ts) reports
 * `1000000` for the very same combo record and the very same member set.
 *
 * So two catalog surfaces disagree about one combo: the dashboard/API builder
 * knows the real 1M window, the OpenAI-compatible wire listing does not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROOT CAUSE (in `src/app/api/v1/models/catalog.ts::getComboTargetCatalogMetadata`)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. HARD GATE (~line 376):
 *
 *        if (!source.providerRegistry && !source.staticSpec && !source.syncedCapability)
 *          return null;
 *
 *    A member whose provider is a custom OpenAI-compatible connection (e.g.
 *    `dmxapi-cn`, or a user-defined node) has no provider-registry entry and no
 *    static MODEL_SPECS entry. `source.syncedCapability` is the ONLY flag that
 *    could carry it — and it is computed by the unified resolver
 *    (`getResolvedModelCapabilities` in src/lib/modelCapabilities.ts), which DOES
 *    honour `SYNCED_CAPABILITY_FALLBACK_ALIASES` (src/lib/modelsDevSync.ts —
 *    `dmxapi-cn → [zhipuai, zai, alibaba, deepseek]`) plus customModels rows.
 *    When the resolver cannot source the member from any of those, the gate
 *    discards the member's ENTIRE metadata — including the customModels row's
 *    own `max_input_tokens` / `supportsVision` (scenario A), which
 *    `getResolvedModelCapabilities` never consults in the first place.
 *
 * 2. MISSING MERGE / UN-AWAITED ASYNC READS (~lines 380 & 399):
 *
 *        const synced = getSyncedCapability(providerId, modelId);   // NOT awaited
 *        ...
 *        (getTokenLimit(providerId, modelId) || undefined)          // NOT awaited
 *
 *    `getSyncedCapability` and `getTokenLimit` are both `async`. Reading them
 *    without `await` yields a truthy Promise, so:
 *      - `synced?.limit_context` is `undefined` → the member's real synced
 *        context window never reaches `contextLength`;
 *      - `getTokenLimit(...) || undefined` is a Promise, so `contextLength`
 *        becomes a Promise object that `minKnownNumber()` then filters out as
 *        "not a positive finite number" → the combo publishes NO
 *        `context_length` at all, even when every member is known (scenarios
 *        B and D).
 *    The same un-awaited `getTokenLimit` in `getDefaultContextFallback`
 *    (~line 1481) makes non-combo provider entries serialise as
 *    `"context_length": {}` (scenario C2).
 *
 * 3. DIRTY-VALUE LEAK: when a combo has no explicit `context_length` and zero
 *    resolvable members, the field must be ABSENT — never a literal `{}`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPE
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests only. Nothing under src/ or open-sse/ is modified. Every scenario below
 * is expected to FAIL against the current src; the assertions encode the
 * CORRECT behaviour, so this file becomes the regression guard once the defect
 * is fixed.
 *
 * Harness mirrors tests/unit/models-catalog-auto-combos-4164.test.ts:
 * node:test + a temp DATA_DIR + a direct `getUnifiedModelsResponse(new Request(…))`
 * call, so no HTTP server is involved.
 *
 * Run:
 *   npx cross-env DISABLE_SQLITE_AUTO_BACKUP=true \
 *     node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts \
 *     --import ./tests/_setup/isolateDataDir.ts \
 *     --test tests/unit/combo-catalog-custom-member-metadata.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-custom-meta-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "combo-custom-meta-test-secret";

const core = await import("../../src/lib/db/core.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const combosDb = await import("../../src/lib/db/combos.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const v1ModelsCatalog = await import("../../src/app/api/v1/models/catalog.ts");
const comboContext = await import("../../src/lib/combos/comboContext.ts");

type CatalogEntry = Record<string, unknown> & {
  id: string;
  context_length?: unknown;
  capabilities?: Record<string, unknown>;
};

/**
 * Canonical `model_capabilities` row shape (same helper the existing
 * tests/unit/8332-combo-vision-fallback.test.ts seeds with).
 */
function capabilityEntry(limitContext: number, overrides: Record<string, unknown> = {}) {
  return {
    tool_call: true,
    reasoning: false,
    attachment: false,
    structured_output: true,
    temperature: true,
    modalities_input: JSON.stringify(["text"]),
    modalities_output: JSON.stringify(["text"]),
    knowledge_cutoff: null,
    release_date: null,
    last_updated: null,
    status: null,
    family: null,
    open_weights: false,
    limit_context: limitContext,
    limit_input: limitContext,
    limit_output: 4096,
    interleaved_field: null,
    ...overrides,
  };
}

/**
 * Deterministic reset. `clearModelsDevCapabilities()` leaves the in-memory
 * synced-capability cache in an explicit "loaded, empty" state, so every
 * provider lookup goes through the warm fast path instead of the cold SQLite
 * path (whose un-awaited `stmt.get()` makes lookups non-deterministic between
 * processes). Each scenario then opts in to exactly the rows it needs via
 * `saveModelsDevCapabilities()`.
 */
async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  v1ModelsCatalog.__resetCatalogBuilderRunsForTest();
  core.getDbInstance(); // force the DB (re)open so the migration run starts
  await core.awaitDbMigrations(); // never seed before migration 005 has landed
  await modelsDevSync.clearModelsDevCapabilities();
}

async function getComboEntry(comboName: string): Promise<CatalogEntry> {
  const response = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models")
  );
  assert.equal(response.status, 200, "/v1/models must answer 200");
  const body = (await response.json()) as { data: CatalogEntry[] };
  const entry = body.data.find((model) => model.id === comboName);
  assert.ok(
    entry,
    `expected a /v1/models entry with id "${comboName}" — got ${JSON.stringify(
      body.data.map((model) => model.id)
    )}`
  );
  return entry;
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/**
 * SCENARIO A — a combo whose ONLY member exists exclusively as a customModels
 * row must still publish that row's declared metadata.
 *
 * Expected (correct): context_length = 1000000, capabilities.vision = true.
 * Current src: the hard gate rejects the member outright (its provider is a
 * custom connection: no providerRegistry, no staticSpec, and no synced row for
 * `dmxapi-test`), so the combo entry is bare.
 */
test("A: customModels-only member contributes context_length + vision to its combo entry", async () => {
  await modelsDb.addCustomModel(
    "dmxapi-test",
    "custom-vision-model",
    "Custom Vision Model",
    "manual",
    "chat-completions",
    ["chat"],
    undefined,
    { inputTokenLimit: 1000000 },
    true
  );
  await combosDb.createCombo({
    name: "custom-only-member-combo",
    strategy: "priority",
    models: ["dmxapi-test/custom-vision-model"],
  });

  const entry = await getComboEntry("custom-only-member-combo");

  assert.equal(
    entry.context_length,
    1000000,
    "the customModels row declares max_input_tokens=1000000; the combo entry must " +
      "publish context_length=1000000, not omit the field (hard gate at catalog.ts:376)"
  );
  assert.equal(
    typeof entry.context_length,
    "number",
    "context_length must be a number on the wire, never a Promise/object"
  );
  assert.equal(
    entry.capabilities?.vision,
    true,
    "the customModels row declares supportsVision=true; the combo entry must " +
      "publish capabilities.vision=true"
  );
});

/**
 * SCENARIO B — a combo mixing one synced-known member and one custom-only member
 * must publish the INTERSECTION: the known member's 1M window and vision=true
 * from both.
 *
 * Expected (correct): context_length = 1000000 AND capabilities.vision = true.
 * Current src: vision=true survives (canonical metadata is awaited inside
 * modelMetadataRegistry), but context_length is DROPPED — catalog.ts:380 reads
 * the async `getSyncedCapability()` without `await`, so the known member's
 * `limit_context` is invisible to `contextLength`.
 */
test("B: mixed combo publishes the min context window across known + custom members", async () => {
  await modelsDb.addCustomModel(
    "dmxapi-test",
    "custom-vision-model",
    "Custom Vision Model",
    "manual",
    "chat-completions",
    ["chat"],
    undefined,
    { inputTokenLimit: 1000000 },
    true
  );
  await modelsDevSync.saveModelsDevCapabilities({
    deepseek: {
      "flash-x": capabilityEntry(1000000, { attachment: true }),
    },
  } as never);
  await combosDb.createCombo({
    name: "mixed-known-and-custom-combo",
    strategy: "priority",
    models: ["deepseek/flash-x", "dmxapi-test/custom-vision-model"],
  });

  const entry = await getComboEntry("mixed-known-and-custom-combo");

  assert.equal(
    entry.context_length,
    1000000,
    "both members resolve to a 1,000,000-token window (deepseek/flash-x via synced " +
      "capabilities, dmxapi-test/custom-vision-model via its customModels row) — the " +
      "combo entry must publish the min, 1000000"
  );
  assert.equal(
    entry.capabilities?.vision,
    true,
    "both members are vision-capable (deepseek attachment=true, custom supportsVision=true) " +
      "so the combo intersection must be capabilities.vision=true"
  );
});

/**
 * SCENARIO C1 — a combo whose NO member resolves anything must NOT publish a
 * literal empty-object `context_length`; the field must be ABSENT.
 *
 * Expected (correct): `context_length` is not an own property of the entry.
 * Current src: PASSES — `buildComboCatalogMetadata()` returns `baseMetadata`
 * (empty) when no member resolves, and the spread guard omits the key. Kept as
 * the explicit contract for the dirty-value leak; C2 pins the leak that DOES
 * exist today.
 */
test("C1: combo with zero resolvable members omits context_length entirely", async () => {
  await combosDb.createCombo({
    name: "no-resolvable-member-combo",
    strategy: "priority",
    models: ["unknown-provider/no-such-model-xyz"],
  });

  const entry = await getComboEntry("no-resolvable-member-combo");

  assert.equal(
    Object.hasOwn(entry, "context_length"),
    false,
    'a combo with no resolvable member must not carry "context_length" at all — ' +
      `got ${JSON.stringify(entry.context_length)}`
  );
  assert.notEqual(
    typeof entry.context_length,
    "object",
    'wire JSON must never contain a literal "context_length": {}'
  );
});

/**
 * SCENARIO C2 — the dirty-value leak as it actually reaches the wire: NO entry
 * anywhere in the catalog payload may carry an empty-object `context_length`.
 *
 * Expected (correct): zero occurrences.
 * Current src: FAILS — `getDefaultContextFallback()` (catalog.ts:~1481) returns
 * the un-awaited `getTokenLimit()` Promise, which is truthy, so non-combo
 * provider entries are emitted as `"context_length": {}` (measured: 10 entries,
 * e.g. `pepper/pepper-1`).
 */
test("C2: no catalog entry serialises context_length as an empty object", async () => {
  await combosDb.createCombo({
    name: "no-resolvable-member-combo",
    strategy: "priority",
    models: ["unknown-provider/no-such-model-xyz"],
  });

  const response = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models")
  );
  assert.equal(response.status, 200);
  const raw = await response.text();

  assert.equal(
    /"context_length":\{\}/.test(raw),
    false,
    'wire JSON contains a literal "context_length": {} — the field must be a number ' +
      "or absent, never an empty object (un-awaited async getTokenLimit)"
  );

  const body = JSON.parse(raw) as { data: CatalogEntry[] };
  const offenders = body.data
    .filter((model) => model.context_length !== null && typeof model.context_length === "object")
    .map((model) => model.id);
  assert.deepEqual(
    offenders,
    [],
    `entries with a non-numeric context_length: ${JSON.stringify(offenders)}`
  );
});

/**
 * SCENARIO D — the fallback-alias path. Capabilities synced under the upstream
 * channel (`alibaba/qwen-test-flash`) must flow into a combo member addressed by
 * the aggregator provider (`dmxapi-cn/qwen-test-flash`) through
 * `SYNCED_CAPABILITY_FALLBACK_ALIASES` (`dmxapi-cn → [zhipuai, zai, alibaba, deepseek]`).
 *
 * Expected (correct): context_length = 1000000 AND capabilities.vision = true.
 * Current src: vision=true flows (canonical metadata resolves the alias fallback
 * and awaits it), context_length is DROPPED by the un-awaited read at
 * catalog.ts:380.
 */
test("D: fallback-alias member (dmxapi-cn → alibaba) publishes context_length + vision", async () => {
  await modelsDevSync.saveModelsDevCapabilities({
    alibaba: {
      "qwen-test-flash": capabilityEntry(1000000, { attachment: true }),
    },
  } as never);
  await combosDb.createCombo({
    name: "fallback-alias-member-combo",
    strategy: "priority",
    models: ["dmxapi-cn/qwen-test-flash"],
  });

  const entry = await getComboEntry("fallback-alias-member-combo");

  assert.equal(
    entry.context_length,
    1000000,
    "dmxapi-cn/qwen-test-flash has no models.dev channel of its own; the alias fallback " +
      "to alibaba/qwen-test-flash (1,000,000) must flow into the combo entry"
  );
  assert.equal(
    entry.capabilities?.vision,
    true,
    "the aliased synced row declares attachment=true, so the combo must publish vision=true"
  );
});

/**
 * PRODUCTION-EVIDENCE guard — reproduces the exact `main` combo shape from the
 * header. `/api/combos`' `computeComboContextLength()` resolves 1000000 for this
 * record; the `/v1/models` entry must agree instead of omitting context_length.
 */
test("E: production 'main' combo agrees with /api/combos computed_context_length", async () => {
  await modelsDevSync.saveModelsDevCapabilities({
    alibaba: {
      "qwen3.8-flash": capabilityEntry(1000000, { attachment: true }),
    },
    deepseek: {
      "deepseek-flash": capabilityEntry(1000000, { attachment: true }),
      "deepseek-v4.1-flash": capabilityEntry(1000000, { attachment: true }),
    },
  } as never);
  await combosDb.createCombo({
    name: "main",
    strategy: "priority",
    models: ["dmxapi-cn/qwen3.8-flash", "deepseek/deepseek-flash", "dmxapi-cn/deepseek-v4.1-flash"],
  });

  const allCombos = (await combosDb.getCombos()) as Array<Record<string, unknown>>;
  const combo = allCombos.find((candidate) => candidate.name === "main");
  assert.ok(combo, "sanity: the main combo is persisted");

  const computed = await comboContext.computeComboContextLength(
    combo as Parameters<typeof comboContext.computeComboContextLength>[0],
    allCombos as Parameters<typeof comboContext.computeComboContextLength>[1]
  );
  assert.equal(
    computed,
    1000000,
    "sanity: the internal compute path (/api/combos computed_context_length) resolves 1000000"
  );

  const entry = await getComboEntry("main");
  assert.equal(
    entry.context_length,
    computed,
    "the /v1/models combo entry must agree with /api/combos computed_context_length " +
      "(production: ctx None on /v1/models vs computed=1000000)"
  );
});

/**
 * SCENARIO F — a customModels-only member that declares an output-token budget
 * must publish max_output_tokens on its combo entry. The member chain used to
 * resolve output limits as `synced.limit_output ?? spec.maxOutputTokens` only,
 * silently dropping both registryModel.maxOutputTokens and the operator-declared
 * customRow.outputTokenLimit (same defect family as the context_length gate).
 *
 * Expected (correct): max_output_tokens = 65536 from the custom row.
 */
test("F: customModels member's outputTokenLimit publishes max_output_tokens", async () => {
  await modelsDb.addCustomModel(
    "dmxapi-test",
    "custom-output-model",
    "Custom Output Model",
    "manual",
    "chat-completions",
    ["chat"],
    undefined,
    { inputTokenLimit: 1000000, outputTokenLimit: 65536 },
    true
  );
  await combosDb.createCombo({
    name: "custom-output-member-combo",
    strategy: "priority",
    models: ["dmxapi-test/custom-output-model"],
  });

  const entry = await getComboEntry("custom-output-member-combo");

  assert.equal(
    entry.max_output_tokens,
    65536,
    "the customModels row declares outputTokenLimit=65536; the combo entry must " +
      "publish max_output_tokens=65536 instead of omitting it"
  );
});
