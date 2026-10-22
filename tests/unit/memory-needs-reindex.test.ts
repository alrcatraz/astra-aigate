/**
 * tests/unit/memory-needs-reindex.test.ts
 *
 * Plan 21 — Memory Engine Redesign (F2)
 * Tests for markMemoryNeedsReindex, markAllMemoriesNeedReindex,
 * getMemoryReindexQueue, and countMemoryReindexPending.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-memory-reindex-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const memoryVec = await import("../../src/lib/db/memoryVec.ts");

// ──────────────── Helpers ────────────────

function insertTestMemory(
  db: ReturnType<typeof core.getDbInstance>,
  id: string,
  content: string,
  key: string
): void {
  db.prepare(
    `
    INSERT INTO memories (id, api_key_id, type, key, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `
  ).run(id, "test-api-key", "factual", key, content);
}

async function resetStorage() {
  await core.resetDbInstanceDrained();

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
      break;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if ((code === "EBUSY" || code === "EPERM") && attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      } else {
        throw error;
      }
    }
  }

  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  core.getDbInstance();
  await core.awaitDbMigrations();
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  await core.resetDbInstanceDrained();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

// ──────────────── markMemoryNeedsReindex ────────────────

test("markMemoryNeedsReindex(id, true) marks only the targeted memory", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Paris is the capital of France", "capital-france");
  insertTestMemory(db, "id-2", "Berlin is the capital of Germany", "capital-germany");
  insertTestMemory(db, "id-3", "Tokyo is the capital of Japan", "capital-japan");

  await memoryVec.markMemoryNeedsReindex("id-1", true);

  const queue = await memoryVec.getMemoryReindexQueue(10);
  assert.equal(queue.length, 1, "only 1 memory should be in the reindex queue");
  assert.equal(queue[0].id, "id-1");
  assert.equal(queue[0].content, "Paris is the capital of France");
  assert.equal(queue[0].key, "capital-france");
});

test("markMemoryNeedsReindex(id, false) clears the flag for that memory", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");
  insertTestMemory(db, "id-2", "Content 2", "key-2");
  insertTestMemory(db, "id-3", "Content 3", "key-3");

  // Mark all 3 with needs_reindex
  await memoryVec.markMemoryNeedsReindex("id-1", true);
  await memoryVec.markMemoryNeedsReindex("id-2", true);
  await memoryVec.markMemoryNeedsReindex("id-3", true);

  // Clear id-1
  await memoryVec.markMemoryNeedsReindex("id-1", false);

  const queue = await memoryVec.getMemoryReindexQueue(10);
  const ids = queue.map((item) => item.id);

  assert.equal(queue.length, 2, "queue should have 2 items after clearing id-1");
  assert.ok(!ids.includes("id-1"), "id-1 should not be in the queue");
  assert.ok(ids.includes("id-2"), "id-2 should be in the queue");
  assert.ok(ids.includes("id-3"), "id-3 should be in the queue");
});

// ──────────────── markAllMemoriesNeedReindex ────────────────

test("markAllMemoriesNeedReindex() returns the correct affected row count", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");
  insertTestMemory(db, "id-2", "Content 2", "key-2");
  insertTestMemory(db, "id-3", "Content 3", "key-3");

  const count = await memoryVec.markAllMemoriesNeedReindex();
  assert.equal(count, 3, "markAllMemoriesNeedReindex should return 3 (all rows affected)");
});

test("markAllMemoriesNeedReindex() marks every memory in the queue", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");
  insertTestMemory(db, "id-2", "Content 2", "key-2");
  insertTestMemory(db, "id-3", "Content 3", "key-3");

  await memoryVec.markAllMemoriesNeedReindex();

  const queue = await memoryVec.getMemoryReindexQueue(10);
  assert.equal(queue.length, 3, "all 3 memories should appear in the reindex queue");
});

test("markAllMemoriesNeedReindex() returns 0 when there are no memories", async () => {
  core.getDbInstance();

  const count = await memoryVec.markAllMemoriesNeedReindex();
  assert.equal(count, 0, "should return 0 when there are no memories");
});

// ──────────────── countMemoryReindexPending ────────────────

test("countMemoryReindexPending() returns 3 after markAll on 3 memories", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");
  insertTestMemory(db, "id-2", "Content 2", "key-2");
  insertTestMemory(db, "id-3", "Content 3", "key-3");

  await memoryVec.markAllMemoriesNeedReindex();

  const pending = await memoryVec.countMemoryReindexPending();
  assert.equal(pending, 3);
});

test("countMemoryReindexPending() returns 0 on fresh DB with no memories", async () => {
  core.getDbInstance();

  const pending = await memoryVec.countMemoryReindexPending();
  assert.equal(pending, 0);
});

test("countMemoryReindexPending() decrements after clearing a flag", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");
  insertTestMemory(db, "id-2", "Content 2", "key-2");
  insertTestMemory(db, "id-3", "Content 3", "key-3");

  await memoryVec.markAllMemoriesNeedReindex();
  assert.equal(await memoryVec.countMemoryReindexPending(), 3);

  await memoryVec.markMemoryNeedsReindex("id-1", false);
  assert.equal(await memoryVec.countMemoryReindexPending(), 2);

  await memoryVec.markMemoryNeedsReindex("id-2", false);
  assert.equal(await memoryVec.countMemoryReindexPending(), 1);
});

// ──────────────── getMemoryReindexQueue pagination ────────────────

test("getMemoryReindexQueue respects the limit parameter", async () => {
  const db = core.getDbInstance();

  for (let i = 1; i <= 5; i++) {
    insertTestMemory(db, `id-${i}`, `Content ${i}`, `key-${i}`);
  }

  await memoryVec.markAllMemoriesNeedReindex();

  const queue = await memoryVec.getMemoryReindexQueue(3);
  assert.equal(queue.length, 3, "should return at most 3 items when limit=3");
});

test("getMemoryReindexQueue returns only memories with needs_reindex = 1", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");
  insertTestMemory(db, "id-2", "Content 2", "key-2");
  insertTestMemory(db, "id-3", "Content 3", "key-3");

  // Only mark id-2 and id-3
  await memoryVec.markMemoryNeedsReindex("id-2", true);
  await memoryVec.markMemoryNeedsReindex("id-3", true);

  const queue = await memoryVec.getMemoryReindexQueue(10);
  const ids = queue.map((item) => item.id);

  assert.equal(queue.length, 2);
  assert.ok(!ids.includes("id-1"), "id-1 should NOT be in the queue");
  assert.ok(ids.includes("id-2"), "id-2 should be in the queue");
  assert.ok(ids.includes("id-3"), "id-3 should be in the queue");
});

test("getMemoryReindexQueue returns empty array when no memories need reindex", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");

  const queue = await memoryVec.getMemoryReindexQueue(10);
  assert.equal(queue.length, 0, "queue should be empty when needs_reindex = 0");
});

// ──────────────── Combined workflow ────────────────

test("full workflow: markAll → queue=3 → clear id-1 → queue=2", async () => {
  const db = core.getDbInstance();

  insertTestMemory(db, "id-1", "Content 1", "key-1");
  insertTestMemory(db, "id-2", "Content 2", "key-2");
  insertTestMemory(db, "id-3", "Content 3", "key-3");

  const affected = await memoryVec.markAllMemoriesNeedReindex();
  assert.equal(affected, 3);

  const queueBefore = await memoryVec.getMemoryReindexQueue(10);
  assert.equal(queueBefore.length, 3);
  assert.equal(await memoryVec.countMemoryReindexPending(), 3);

  await memoryVec.markMemoryNeedsReindex("id-1", false);

  const queueAfter = await memoryVec.getMemoryReindexQueue(10);
  assert.equal(queueAfter.length, 2, "queue should have 2 items after clearing id-1");
  assert.equal(await memoryVec.countMemoryReindexPending(), 2);

  const ids = queueAfter.map((item) => item.id);
  assert.ok(!ids.includes("id-1"));
  assert.ok(ids.includes("id-2"));
  assert.ok(ids.includes("id-3"));
});
