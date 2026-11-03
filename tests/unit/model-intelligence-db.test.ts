/**
 * Unit tests for src/lib/db/modelIntelligence.ts
 *
 * Uses the project's own DB infrastructure (core.ts getDbInstance)
 * with a temp DATA_DIR. Follows the Node.js native test runner pattern.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-mi-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const mi = await import("../../src/lib/db/modelIntelligence.ts");

async function resetStorage(): void {
  await core.resetDbInstanceDrained();
  try {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  } catch {
    /* EBUSY — ignore */
  }
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  core.getDbInstance();
  await core.awaitDbMigrations();
}

function insertEntry(
  model: string,
  source: string,
  category: string,
  score: number,
  opts: {
    eloRaw?: number | null;
    confidence?: string | null;
    expiresAt?: string | null;
  } = {}
): void {
  const db = core.getDbInstance();
  db.prepare(
    `INSERT OR REPLACE INTO model_intelligence
     (model, source, category, score, elo_raw, confidence, synced_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
  ).run(
    model,
    source,
    category,
    score,
    opts.eloRaw ?? null,
    opts.confidence ?? null,
    opts.expiresAt ?? null
  );
}

// ─── Tests ───────────────────────────────────────────────

describe("upsertModelIntelligence", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("inserts a new entry", async () => {
    await mi.upsertModelIntelligence({
      model: "claude-sonnet",
      source: "arena_elo",
      category: "coding",
      score: 0.92,
      eloRaw: 1350,
      confidence: "high",
      expiresAt: null,
    });

    const entry = await mi.getModelIntelligenceBySource("claude-sonnet", "arena_elo", "coding");
    assert.ok(entry, "Row should exist after upsert");
    assert.strictEqual(entry.model, "claude-sonnet");
    assert.strictEqual(entry.source, "arena_elo");
    assert.strictEqual(entry.category, "coding");
    assert.strictEqual(entry.score, 0.92);
    assert.strictEqual(entry.eloRaw, 1350);
    assert.strictEqual(entry.confidence, "high");
    assert.ok(entry.syncedAt, "synced_at should be auto-populated");
  });

  it("updates an existing entry (INSERT OR REPLACE)", async () => {
    insertEntry("gpt-4o", "arena_elo", "coding", 0.85);

    await mi.upsertModelIntelligence({
      model: "gpt-4o",
      source: "arena_elo",
      category: "coding",
      score: 0.9,
      eloRaw: 1400,
      confidence: "high",
      expiresAt: null,
    });

    const entry = await mi.getModelIntelligenceBySource("gpt-4o", "arena_elo", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.score, 0.9);
    assert.strictEqual(entry.eloRaw, 1400);
  });
});

describe("getModelIntelligence", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("returns user_override when all three sources exist (highest priority)", async () => {
    insertEntry("claude-sonnet", "models_dev_tier", "coding", 0.75);
    insertEntry("claude-sonnet", "arena_elo", "coding", 0.88);
    insertEntry("claude-sonnet", "user_override", "coding", 0.99);

    const entry = await mi.getModelIntelligence("claude-sonnet", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.source, "user_override");
    assert.strictEqual(entry.score, 0.99);
  });

  it("returns arena_elo when no user_override exists", async () => {
    insertEntry("gpt-4o", "arena_elo", "coding", 0.87);
    insertEntry("gpt-4o", "models_dev_tier", "coding", 0.7);

    const entry = await mi.getModelIntelligence("gpt-4o", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.source, "arena_elo");
    assert.strictEqual(entry.score, 0.87);
  });

  it("returns models_dev_tier when only that source exists", async () => {
    insertEntry("llama-4", "models_dev_tier", "coding", 0.65);

    const entry = await mi.getModelIntelligence("llama-4", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.source, "models_dev_tier");
    assert.strictEqual(entry.score, 0.65);
  });

  it("returns null when no entry exists", async () => {
    const entry = await mi.getModelIntelligence("nonexistent-model", "coding");
    assert.strictEqual(entry, null);
  });

  it("skips expired entries and falls through to next source", async () => {
    insertEntry("gemini-pro", "arena_elo", "coding", 0.82, {
      expiresAt: "2000-01-01T00:00:00Z",
    });
    insertEntry("gemini-pro", "models_dev_tier", "coding", 0.7);

    const entry = await mi.getModelIntelligence("gemini-pro", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.source, "models_dev_tier");
  });

  it("returns null when all entries for a model+category are expired", async () => {
    insertEntry("expired-model", "arena_elo", "coding", 0.8, {
      expiresAt: "2000-01-01T00:00:00Z",
    });

    const entry = await mi.getModelIntelligence("expired-model", "coding");
    assert.strictEqual(entry, null);
  });

  it("model names require exact match (case-sensitive in DB)", async () => {
    insertEntry("Claude-Sonnet", "arena_elo", "coding", 0.9);

    const exact = await mi.getModelIntelligence("Claude-Sonnet", "coding");
    assert.ok(exact);

    const different = await mi.getModelIntelligence("claude-sonnet", "coding");
    assert.strictEqual(different, null);
  });
});

describe("getModelIntelligenceBySource", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("returns a specific source entry", async () => {
    insertEntry("claude-sonnet", "arena_elo", "coding", 0.88);
    insertEntry("claude-sonnet", "user_override", "coding", 0.99);

    const entry = await mi.getModelIntelligenceBySource("claude-sonnet", "arena_elo", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.source, "arena_elo");
    assert.strictEqual(entry.score, 0.88);
  });

  it("returns null when the specific source does not exist", async () => {
    insertEntry("claude-sonnet", "arena_elo", "coding", 0.88);

    const entry = await mi.getModelIntelligenceBySource("claude-sonnet", "user_override", "coding");
    assert.strictEqual(entry, null);
  });

  it("returns null when no entries exist at all", async () => {
    const entry = await mi.getModelIntelligenceBySource("nonexistent", "arena_elo", "coding");
    assert.strictEqual(entry, null);
  });
});

describe("deleteModelIntelligence", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("deletes an entry and returns true", async () => {
    insertEntry("gpt-4o", "arena_elo", "coding", 0.87);

    const deleted = await mi.deleteModelIntelligence("gpt-4o", "arena_elo", "coding");
    assert.strictEqual(deleted, true);

    const entry = await mi.getModelIntelligenceBySource("gpt-4o", "arena_elo", "coding");
    assert.strictEqual(entry, null);
  });

  it("returns false when entry does not exist", async () => {
    const deleted = await mi.deleteModelIntelligence("nonexistent", "arena_elo", "coding");
    assert.strictEqual(deleted, false);
  });
});

describe("deleteExpiredIntelligence", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("deletes only expired entries leaving valid ones", async () => {
    insertEntry("old-model", "arena_elo", "coding", 0.7, {
      expiresAt: "2000-01-01T00:00:00Z",
    });
    insertEntry("fresh-model", "arena_elo", "coding", 0.9, {
      expiresAt: "2099-12-31T23:59:59Z",
    });
    insertEntry("permanent-model", "user_override", "coding", 0.95);

    const deleted = await mi.deleteExpiredIntelligence();
    assert.strictEqual(deleted, 1);

    const remaining = await mi.listModelIntelligence();
    assert.strictEqual(remaining.length, 2);
  });

  it("deletes expired entries for a specific source only", async () => {
    insertEntry("old-arena", "arena_elo", "coding", 0.7, {
      expiresAt: "2000-01-01T00:00:00Z",
    });
    insertEntry("old-tier", "models_dev_tier", "coding", 0.5, {
      expiresAt: "2000-01-01T00:00:00Z",
    });

    const deleted = await mi.deleteExpiredIntelligence("arena_elo");
    assert.strictEqual(deleted, 1);

    const remaining = await mi.listModelIntelligence();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].source, "models_dev_tier");
  });

  it("returns 0 when no expired entries exist", async () => {
    insertEntry("fresh-model", "arena_elo", "coding", 0.9, {
      expiresAt: "2099-12-31T23:59:59Z",
    });

    const deleted = await mi.deleteExpiredIntelligence();
    assert.strictEqual(deleted, 0);
  });
});

describe("listModelIntelligence", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("lists all entries when no filters provided", async () => {
    insertEntry("model-a", "arena_elo", "coding", 0.8);
    insertEntry("model-b", "arena_elo", "review", 0.75);
    insertEntry("model-c", "user_override", "coding", 0.95);

    const entries = await mi.listModelIntelligence();
    assert.strictEqual(entries.length, 3);
  });

  it("filters by source", async () => {
    insertEntry("model-a", "arena_elo", "coding", 0.8);
    insertEntry("model-b", "user_override", "coding", 0.95);
    insertEntry("model-c", "models_dev_tier", "coding", 0.6);

    const entries = await mi.listModelIntelligence({ source: "arena_elo" });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].source, "arena_elo");
  });

  it("filters by category", async () => {
    insertEntry("model-a", "arena_elo", "coding", 0.8);
    insertEntry("model-b", "arena_elo", "review", 0.75);
    insertEntry("model-c", "arena_elo", "documentation", 0.7);

    const entries = await mi.listModelIntelligence({ category: "review" });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].category, "review");
  });

  it("filters by both source and category", async () => {
    insertEntry("model-a", "arena_elo", "coding", 0.8);
    insertEntry("model-b", "arena_elo", "review", 0.75);
    insertEntry("model-c", "user_override", "coding", 0.95);

    const entries = await mi.listModelIntelligence({ source: "arena_elo", category: "coding" });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].model, "model-a");
  });

  it("returns empty array for empty table", async () => {
    const entries = await mi.listModelIntelligence();
    assert.ok(Array.isArray(entries));
    assert.strictEqual(entries.length, 0);
  });
});

describe("bulkUpsertModelIntelligence", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("bulk inserts multiple entries", async () => {
    const count = await mi.bulkUpsertModelIntelligence([
      {
        model: "model-a",
        source: "arena_elo",
        category: "coding",
        score: 0.8,
        eloRaw: 1300,
        confidence: "high",
        expiresAt: "2099-12-31T23:59:59Z",
      },
      {
        model: "model-b",
        source: "arena_elo",
        category: "coding",
        score: 0.7,
        eloRaw: 1200,
        confidence: "medium",
        expiresAt: "2099-12-31T23:59:59Z",
      },
      {
        model: "model-c",
        source: "arena_elo",
        category: "review",
        score: 0.85,
        eloRaw: 1350,
        confidence: "high",
        expiresAt: "2099-12-31T23:59:59Z",
      },
    ]);

    assert.strictEqual(count, 3);
    const entries = await mi.listModelIntelligence();
    assert.strictEqual(entries.length, 3);
  });

  it("returns 0 for empty input array", async () => {
    const count = await mi.bulkUpsertModelIntelligence([]);
    assert.strictEqual(count, 0);
  });

  it("replaces existing entries on conflict (INSERT OR REPLACE)", async () => {
    insertEntry("model-a", "arena_elo", "coding", 0.7);

    await mi.bulkUpsertModelIntelligence([
      {
        model: "model-a",
        source: "arena_elo",
        category: "coding",
        score: 0.9,
        eloRaw: 1450,
        confidence: "high",
        expiresAt: null,
      },
    ]);

    const entry = await mi.getModelIntelligenceBySource("model-a", "arena_elo", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.score, 0.9);
    assert.strictEqual(entry.eloRaw, 1450);
  });
});

describe("getResolvedTaskFitness", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("returns user_override score when all sources exist", async () => {
    insertEntry("claude-sonnet", "models_dev_tier", "coding", 0.75);
    insertEntry("claude-sonnet", "arena_elo", "coding", 0.88);
    insertEntry("claude-sonnet", "user_override", "coding", 0.99);

    const score = await mi.getResolvedTaskFitness("claude-sonnet", "coding");
    assert.strictEqual(score, 0.99);
  });

  it("returns arena_elo score when no user_override exists", async () => {
    insertEntry("gpt-4o", "arena_elo", "coding", 0.87);
    insertEntry("gpt-4o", "models_dev_tier", "coding", 0.7);

    const score = await mi.getResolvedTaskFitness("gpt-4o", "coding");
    assert.strictEqual(score, 0.87);
  });

  it("returns models_dev_tier score when only that source exists", async () => {
    insertEntry("llama-4", "models_dev_tier", "coding", 0.65);

    const score = await mi.getResolvedTaskFitness("llama-4", "coding");
    assert.strictEqual(score, 0.65);
  });

  it("returns null when nothing exists", async () => {
    const score = await mi.getResolvedTaskFitness("nonexistent", "coding");
    assert.strictEqual(score, null);
  });

  it("skips expired entries in the resolution chain", async () => {
    insertEntry("gemini-pro", "arena_elo", "coding", 0.82, {
      expiresAt: "2000-01-01T00:00:00Z",
    });
    insertEntry("gemini-pro", "models_dev_tier", "coding", 0.7);

    const score = await mi.getResolvedTaskFitness("gemini-pro", "coding");
    assert.strictEqual(score, 0.7);
  });
});

describe("edge cases", async () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("score values are stored and retrieved with float precision", async () => {
    await mi.upsertModelIntelligence({
      model: "precise-model",
      source: "arena_elo",
      category: "coding",
      score: 0.1234,
      eloRaw: null,
      confidence: null,
      expiresAt: null,
    });

    const entry = await mi.getModelIntelligence("precise-model", "coding");
    assert.ok(entry);
    assert.ok(Math.abs(entry.score - 0.1234) < 0.0001);
  });

  it("null eloRaw and confidence are handled correctly", async () => {
    await mi.upsertModelIntelligence({
      model: "minimal-model",
      source: "models_dev_tier",
      category: "default",
      score: 0.6,
      eloRaw: null,
      confidence: null,
      expiresAt: null,
    });

    const entry = await mi.getModelIntelligence("minimal-model", "default");
    assert.ok(entry);
    assert.strictEqual(entry.eloRaw, null);
    assert.strictEqual(entry.confidence, null);
  });

  it("NULL expires_at means never expires", async () => {
    await mi.upsertModelIntelligence({
      model: "permanent-model",
      source: "user_override",
      category: "coding",
      score: 0.95,
      eloRaw: null,
      confidence: null,
      expiresAt: null,
    });

    const entry = await mi.getModelIntelligence("permanent-model", "coding");
    assert.ok(entry);
    assert.strictEqual(entry.expiresAt, null);
    assert.strictEqual(entry.score, 0.95);
  });
});
