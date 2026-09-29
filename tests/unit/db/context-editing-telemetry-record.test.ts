/**
 * TDD for F4.1 — recordContextEditingTelemetry: writes a compression_analytics
 * row under engine "context-editing" for the tokens the provider cleared via
 * server-side context editing.
 *
 * DB isolation pattern mirrors tests/unit/db/per-engine-analytics.test.ts:
 * - Temp DATA_DIR, resetDbInstance() before/after, restore in test.after().
 *
 * Run: node --import tsx/esm --test tests/unit/db/context-editing-telemetry-record.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ctx-edit-telemetry-"));
const originalDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../../src/lib/db/core.ts");
await core.resetDbInstanceDrained();

const {
  recordContextEditingTelemetry,
  getCompressionAnalyticsSummary,
  getLatestCompressionAnalyticsRun,
} = await import("../../../src/lib/db/compressionAnalytics.ts");

async function resetDb(): Promise<void> {
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  core.getDbInstance();
  await core.awaitDbMigrations();
}

test.beforeEach(async () => {
  await resetDb();
});

test.after(async () => {
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

test("records a context-editing row reflected in byEngine analytics", async () => {
  recordContextEditingTelemetry(
    "req-1",
    { editCount: 1, clearedInputTokens: 50000, clearedToolUses: 8 },
    "claude"
  );
  const summary = await getCompressionAnalyticsSummary();
  assert.ok(summary.byEngine["context-editing"], "byEngine has a context-editing bucket");
  assert.equal(summary.byEngine["context-editing"].count, 1);
  assert.equal(summary.byEngine["context-editing"].tokensSaved, 50000);
  assert.equal(summary.totalTokensSaved, 50000);
});

test("is a no-op when nothing was cleared (clearedInputTokens <= 0)", async () => {
  recordContextEditingTelemetry("req-2", {
    editCount: 1,
    clearedInputTokens: 0,
    clearedToolUses: 0,
  });
  const summary = await getCompressionAnalyticsSummary();
  assert.equal(summary.totalRequests, 0, "no row written");
  assert.equal(summary.byEngine["context-editing"], undefined);
});

test("is a no-op for null/undefined telemetry", async () => {
  recordContextEditingTelemetry("req-3", null as never);
  recordContextEditingTelemetry("req-4", undefined as never);
  assert.equal((await getCompressionAnalyticsSummary()).totalRequests, 0);
});

test("uses a suffixed request_id so it never collides with the usage-receipt UPDATE", async () => {
  recordContextEditingTelemetry(
    "abc123",
    { editCount: 1, clearedInputTokens: 1000, clearedToolUses: 1 },
    "claude"
  );
  const latest = await getLatestCompressionAnalyticsRun();
  assert.ok(latest);
  assert.equal(latest.engine, "context-editing");
  assert.equal(latest.mode, "context-editing");
  assert.notEqual(latest.request_id, "abc123", "must not reuse the raw request id");
  assert.ok(
    typeof latest.request_id === "string" && latest.request_id.startsWith("abc123"),
    "stays traceable to the originating request"
  );
});

test("aggregates multiple context-editing rows", async () => {
  recordContextEditingTelemetry("r1", {
    editCount: 1,
    clearedInputTokens: 1000,
    clearedToolUses: 1,
  });
  recordContextEditingTelemetry("r2", {
    editCount: 2,
    clearedInputTokens: 2500,
    clearedToolUses: 3,
  });
  const summary = await getCompressionAnalyticsSummary();
  assert.equal(summary.byEngine["context-editing"].count, 2);
  assert.equal(summary.byEngine["context-editing"].tokensSaved, 3500);
});
