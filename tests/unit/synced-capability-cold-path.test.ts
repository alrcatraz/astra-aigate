/**
 * COLD-PATH regression for getSyncedCapability(): the single-row lookup reads
 * through `stmt.get()` on the async DatabaseAdapter. Every adapter returns a
 * Promise from .get(); consuming it synchronously made `!row` always false and
 * mapCapabilityRecord() received a Promise — synced capabilities degraded to
 * all-undefined on the cold path (breaking combo vision routing in production,
 * where the process starts with an empty in-memory cache).
 *
 * node:test gives this file a fresh module registry, so cachedCapabilitiesLoadedAll
 * is false at entry: seeding rows via direct INSERT (NOT saveModelsDevCapabilities,
 * which warms the fast-path cache) forces the cold DB branch under test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "caps-cold-"));

const { ensureCapabilitiesTable, getSyncedCapability } = await import("@/lib/modelsDevSync");
const { getAsyncDb } = await import("@/lib/db/core");

test("cold-path getSyncedCapability awaits stmt.get()", async () => {
  ensureCapabilitiesTable();
  const db = getAsyncDb();
  const insert = await db.prepare(
    `INSERT INTO model_capabilities
       (provider, model_id, attachment, limit_context, last_synced)
     VALUES (?, ?, ?, ?, ?)`
  );
  await insert.run("deepseek", "deepseek-flash", 1, 1000000, new Date().toISOString());

  // No prior all-load happened → this must take the cold SQLite/PG branch.
  const cap = await getSyncedCapability("deepseek", "deepseek-flash");

  assert.ok(cap, "the seeded row must be found on the cold path (Promise-as-row bug)");
  assert.equal(
    cap!.limit_context,
    1000000,
    "fields must come from the DB row, not from mapping a Promise object"
  );
  assert.equal(cap!.attachment, true, "attachment must round-trip as boolean true");
});
