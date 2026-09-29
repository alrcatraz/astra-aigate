import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Feature 5004 — getModelContextLimit reads the override before the static catalog.

const moduleDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-mco-readpath-"));
process.env.DATA_DIR = moduleDataDir;

const coreDb = await import("../../src/lib/db/core.ts");
const mco = await import("../../src/lib/db/modelContextOverrides.ts");
const caps = await import("../../src/lib/modelCapabilities.ts");

beforeEach(async () => {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(moduleDataDir, { recursive: true, force: true });
  fs.mkdirSync(moduleDataDir, { recursive: true });
  coreDb.getDbInstance();
  await coreDb.awaitDbMigrations();
});

after(async () => {
  await coreDb.resetDbInstanceDrained();
  fs.rmSync(moduleDataDir, { recursive: true, force: true });
});

describe("getModelContextLimit override precedence (5004)", () => {
  it("an override wins over the catalog, and removing it falls back to the catalog", async () => {
    // Read the override-free catalog value dynamically (non-brittle for any model).
    const catalog = (
      await caps.getResolvedModelCapabilities({ provider: "openai", model: "gpt-4o" })
    ).contextWindow;
    const distinct = (catalog ?? 0) + 12345;

    mco.setModelContextOverride("openai", "gpt-4o", distinct);
    assert.equal(
      await caps.getModelContextLimit("openai", "gpt-4o"),
      distinct,
      "override must win"
    );

    await mco.removeModelContextOverride("openai", "gpt-4o");
    assert.equal(
      await caps.getModelContextLimit("openai", "gpt-4o"),
      catalog,
      "absence must fall back to the catalog"
    );
  });

  it("an override surfaces a window for a model the catalog does not know", async () => {
    assert.equal(await caps.getModelContextLimit("custom-local", "my-7b-128k"), null);
    mco.setModelContextOverride("custom-local", "my-7b-128k", 131072);
    assert.equal(await caps.getModelContextLimit("custom-local", "my-7b-128k"), 131072);
  });

  it("leaves getResolvedModelCapabilities override-free (so the reconciler sees the catalog)", async () => {
    mco.setModelContextOverride("openai", "gpt-4o", 999999, "auto:discovery");
    const catalog = (
      await caps.getResolvedModelCapabilities({ provider: "openai", model: "gpt-4o" })
    ).contextWindow;
    assert.notEqual(catalog, 999999, "getResolvedModelCapabilities must not reflect the override");
    assert.equal(
      await caps.getModelContextLimit("openai", "gpt-4o"),
      999999,
      "but getModelContextLimit does"
    );
  });
});
