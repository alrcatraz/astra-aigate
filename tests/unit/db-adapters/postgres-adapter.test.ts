import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPostgresAdapter } from "../../../src/lib/db/adapters/postgresAdapter";

/**
 * Integration tests for the PostgresAdapter against a real PostgreSQL.
 * These skip automatically when PG_TEST_DSN is not set (CI/offline), so the
 * suite never fails on machines without a PG instance.
 *
 * Local run (matches pg-3 / pg-5 verification):
 *   podman run -d --name astra-pg-test -e POSTGRES_PASSWORD=astra-test -p 55432:5432 docker.io/library/postgres:16-alpine
 *   PG_TEST_DSN="postgres://postgres:astra-test@127.0.0.1:55432/postgres" node --import tsx/esm --test tests/unit/db-adapters/postgres-adapter.test.ts
 */
const dsn = process.env.PG_TEST_DSN;

function makeDb() {
  if (!dsn) return null;
  return createPostgresAdapter({ connectionString: dsn });
}

const describeMaybe = dsn ? describe : describe.skip;

describeMaybe("postgresAdapter integration", () => {
  it("runs DDL, inserts with OR-IGNORE dedupe, queries, transactions and pragma", async () => {
    const db = makeDb()!;
    try {
      // DDL with AUTOINCREMENT rewrite
      await db.exec(
        "CREATE TABLE IF NOT EXISTS kv_it (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT UNIQUE NOT NULL, v TEXT)"
      );
      await db.exec("DELETE FROM kv_it");

      // INSERT OR IGNORE dedupe
      await db.prepare("INSERT OR IGNORE INTO kv_it (k, v) VALUES (?, ?)").run("a", "1");
      await db.prepare("INSERT OR IGNORE INTO kv_it (k, v) VALUES (?, ?)").run("a", "2");
      const rows = await db.prepare("SELECT k, v FROM kv_it WHERE k = ?").all("a");
      assert.equal(rows.length, 1);
      assert.equal((rows[0] as { v: string }).v, "1");

      // plain insert + get
      const r = await db.prepare("INSERT INTO kv_it (k, v) VALUES (?, ?)").run("b", "hello");
      assert.equal(r.changes, 1);
      const one = await db.prepare("SELECT k, v FROM kv_it WHERE k = ?").get("b");
      assert.equal((one as { v: string }).v, "hello");

      // transaction with nested SAVEPOINT rollback
      const tx = db.transaction(async () => {
        await db.prepare("INSERT INTO kv_it (k, v) VALUES (?, ?)").run("tx1", "x");
        const inner = db.transaction(async () => {
          await db.prepare("INSERT INTO kv_it (k, v) VALUES (?, ?)").run("tx2", "y");
          throw new Error("inner rollback");
        });
        await assert.rejects(() => inner(), /inner rollback/);
        return "inner-rolled-back";
      });
      assert.equal(await tx(), "inner-rolled-back");
      const tx1 = await db.prepare("SELECT COUNT(*) AS n FROM kv_it WHERE k LIKE ?").get("tx%");
      assert.equal(Number((tx1 as { n: number }).n), 1); // tx1 committed, tx2 rolled back

      // PRAGMA table_info translation
      const cols = (await db.pragma("PRAGMA table_info(kv_it)")) as Array<{ name: string }>;
      assert.deepEqual(
        cols.map((c) => c.name),
        ["id", "k", "v"]
      );
    } finally {
      await db.close();
    }
  });

  it("raw getter throws (no sync driver for postgres)", () => {
    const db = makeDb()!;
    try {
      assert.throws(() => db.raw, /not available/);
    } finally {
      void db.close();
    }
  });
});
