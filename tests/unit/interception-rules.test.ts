import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Set DATA_DIR to a temp dir before any imports that touch the DB.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-test-interception-rules-"));
process.env.DATA_DIR = tmpDir;

const core = await import("../../src/lib/db/core.ts");
const {
  getInterceptionRules,
  setInterceptionRules,
  deleteInterceptionRules,
  resolveInterceptSearch,
} = await import("../../src/lib/db/interceptionRules.ts");

// #3384 — per-model web-search/web-fetch interception rule store.
describe("db/interceptionRules — per-model interception rules (#3384)", () => {
  async function resetDb() {
    await core.resetDbInstanceDrained();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    core.getDbInstance();
    await core.awaitDbMigrations();
  }

  beforeEach(async () => {
    await resetDb();
  });

  after(async () => {
    await core.resetDbInstanceDrained();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for an unconfigured provider", async () => {
    assert.equal(await getInterceptionRules("anthropic"), null);
  });

  it("round-trips a provider-level rule via set/get", async () => {
    await setInterceptionRules("anthropic", { interceptSearch: true, interceptFetch: false });
    const rules = await getInterceptionRules("anthropic");
    assert.equal(rules?.interceptSearch, true);
    assert.equal(rules?.interceptFetch, false);
  });

  it("round-trips a per-model override", async () => {
    await setInterceptionRules("anthropic", {
      interceptSearch: false,
      models: { "claude-opus-4": { interceptSearch: true } },
    });
    const rules = await getInterceptionRules("anthropic");
    assert.equal(rules?.interceptSearch, false);
    assert.equal(rules?.models?.["claude-opus-4"]?.interceptSearch, true);
  });

  it("delete resets a provider back to unconfigured", async () => {
    await setInterceptionRules("anthropic", { interceptSearch: true });
    await deleteInterceptionRules("anthropic");
    assert.equal(await getInterceptionRules("anthropic"), null);
  });

  it("invalidates the in-memory cache after a write", async () => {
    await setInterceptionRules("openai", { interceptSearch: true });
    assert.equal((await getInterceptionRules("openai"))?.interceptSearch, true);
    await setInterceptionRules("openai", { interceptSearch: false });
    assert.equal((await getInterceptionRules("openai"))?.interceptSearch, false);
  });

  describe("resolveInterceptSearch — precedence", () => {
    it("returns undefined when no rule is configured (caller falls back to bypass defaults)", async () => {
      assert.equal(await resolveInterceptSearch("anthropic", "claude-opus-4"), undefined);
    });

    it("returns the provider-level rule when no model override exists", async () => {
      await setInterceptionRules("anthropic", { interceptSearch: true });
      assert.equal(await resolveInterceptSearch("anthropic", "claude-opus-4"), true);
      assert.equal(await resolveInterceptSearch("anthropic", "claude-haiku-4"), true);
    });

    it("per-model rule overrides the provider-level rule", async () => {
      await setInterceptionRules("anthropic", {
        interceptSearch: false,
        models: { "claude-opus-4": { interceptSearch: true } },
      });
      assert.equal(await resolveInterceptSearch("anthropic", "claude-opus-4"), true);
      assert.equal(await resolveInterceptSearch("anthropic", "claude-haiku-4"), false);
    });

    it("returns undefined for an empty/missing provider", async () => {
      assert.equal(await resolveInterceptSearch("", "claude-opus-4"), undefined);
      assert.equal(await resolveInterceptSearch(null, "claude-opus-4"), undefined);
      assert.equal(await resolveInterceptSearch(undefined, "claude-opus-4"), undefined);
    });
  });
});
