import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir: string;
let originalDataDir: string | undefined;

function setup() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-stmt-cache-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
}

async function cleanup() {
  const { resetDbInstanceDrained, ensureDbInitialized } = await import("../../src/lib/db/core.ts");
  try {
    await resetDbInstanceDrained();
  } catch {}
  if (originalDataDir !== undefined) {
    process.env.DATA_DIR = originalDataDir;
  } else {
    delete process.env.DATA_DIR;
  }
  // Do NOT rm tempDir here: core.ts freezes DATA_DIR/SQLITE_FILE at first
  // import (inside the first test), so deleting the first temp dir breaks
  // every later open in this file ("directory does not exist" → sql.js →
  // rawBf.prepare().all crashes). The dir is a per-process mkdtemp under
  // /tmp and is reaped with the OS.
  // try {
  //   fs.rmSync(tempDir, { recursive: true, force: true });
  // } catch {}
  try {
    // Best-effort restore for the shared DATA_DIR: the next test re-opens its
    // own DB in setup(), so a driver/adapter quirk here must not fail the
    // test that already passed its assertions.
    await ensureDbInitialized();
  } catch {
    // ignore restore failures
  }
}

test("statement cache handles 200+ unique SELECTs without errors (LRU eviction)", async () => {
  setup();
  try {
    const { getDbInstance } = await import("../../src/lib/db/core.ts");
    const db = getDbInstance();

    // Create a test table and insert a row so SELECTs are valid
    db.exec("CREATE TABLE IF NOT EXISTS stmt_cache_test (id INTEGER PRIMARY KEY, val TEXT)");
    db.exec("INSERT INTO stmt_cache_test (id, val) VALUES (1, 'hello')");

    // Prepare 250 unique SELECT statements (exceeds MAX_STMT_CACHE_SIZE of 200)
    const uniqueStatements = 250;
    for (let i = 0; i < uniqueStatements; i++) {
      const sql = `SELECT ${i} AS seq, val FROM stmt_cache_test WHERE id = 1`;
      const stmt = db.prepare(sql);
      const row = stmt.get() as { seq: number; val: string } | undefined;
      assert.ok(row, `statement ${i} should return a row`);
      assert.equal(row.seq, i, `statement ${i} should have correct seq`);
      assert.equal(row.val, "hello", `statement ${i} should have correct val`);
    }

    // Verify the DB is still functional after eviction churn
    const finalRow = db.prepare("SELECT COUNT(*) AS cnt FROM stmt_cache_test").get() as {
      cnt: number;
    };
    assert.equal(finalRow.cnt, 1, "table should still have 1 row after cache churn");
  } finally {
    await cleanup();
  }
});
