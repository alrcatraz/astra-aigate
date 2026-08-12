import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pragmaToQuery,
  sqliteMasterToQuery,
  translateSqliteToPostgres,
} from "../../src/lib/db/adapters/postgresDialect";
import { translateCreateTable } from "../../src/lib/db/migrateToPostgres";

describe("postgresDialect.translateSqliteToPostgres", () => {
  it("rewrites ? placeholders to $n", () => {
    assert.equal(
      translateSqliteToPostgres("SELECT * FROM t WHERE a = ? AND b = ?"),
      "SELECT * FROM t WHERE a = $1 AND b = $2"
    );
  });

  it("skips placeholders inside string literals", () => {
    assert.equal(translateSqliteToPostgres("SELECT '?' AS q, ? AS p"), "SELECT '?' AS q, $1 AS p");
  });

  it("skips placeholders inside quoted identifiers and doubled quotes", () => {
    assert.equal(translateSqliteToPostgres('SELECT "?" AS c, ? AS p'), 'SELECT "?" AS c, $1 AS p');
    assert.equal(translateSqliteToPostgres("SELECT 'it''s ?', ?"), "SELECT 'it''s ?', $1");
  });

  it("skips placeholders inside comments", () => {
    assert.equal(translateSqliteToPostgres("SELECT 1 -- ?\n, ?"), "SELECT 1 -- ?\n, $1");
    assert.equal(translateSqliteToPostgres("SELECT /* ? */ ?"), "SELECT /* ? */ $1");
  });

  it("rewrites INSERT OR IGNORE to ON CONFLICT DO NOTHING", () => {
    assert.equal(
      translateSqliteToPostgres("INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)"),
      "INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    );
  });

  it("rewrites INSERT OR REPLACE to an EXCLUDED upsert with arbiter", () => {
    const sql = translateSqliteToPostgres("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", (t) =>
      t === "kv" ? ["k"] : undefined
    );
    assert.ok(sql.includes("INSERT INTO kv (k, v) VALUES ($1, $2)"));
    // PK column (k) is excluded from the assignment list and becomes the target.
    assert.ok(sql.includes('ON CONFLICT ("k") DO UPDATE SET v = EXCLUDED.v'));
  });

  it("downgrades REPLACE INTO to DO NOTHING without an arbiter", () => {
    const sql = translateSqliteToPostgres("REPLACE INTO kv (k, v) VALUES (?, ?)");
    assert.ok(sql.includes("INSERT INTO kv (k, v) VALUES ($1, $2)"));
    // No PK known → PG-invalid bare DO UPDATE must never be emitted.
    assert.ok(sql.includes("ON CONFLICT DO NOTHING"));
    assert.ok(!sql.includes("DO UPDATE"));
  });

  it("leaves an existing ON CONFLICT clause untouched", () => {
    assert.equal(
      translateSqliteToPostgres("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING"),
      "INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT(k) DO NOTHING"
    );
  });

  it("qualifies bare RHS columns in an existing DO UPDATE SET upsert", () => {
    const sql = translateSqliteToPostgres(
      `INSERT INTO quota_consumption (api_key_id, dimension_key, bucket_index, consumed, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(api_key_id, dimension_key, bucket_index)
       DO UPDATE SET
         consumed = consumed + excluded.consumed,
         updated_at = excluded.updated_at`
    );
    // LHS stays bare (SET table.col = ... is a PG syntax error), RHS bare refs
    // are qualified with the target table so PG does not report ambiguity.
    assert.ok(sql.includes("consumed = quota_consumption.consumed + excluded.consumed"));
    assert.ok(sql.includes("updated_at = excluded.updated_at"));
    assert.ok(!sql.includes("quota_consumption.consumed ="));
  });

  it("keeps already-qualified EXCLUDED upserts unchanged", () => {
    const sql = translateSqliteToPostgres("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", (t) =>
      t === "kv" ? ["k"] : undefined
    );
    assert.ok(sql.includes('ON CONFLICT ("k") DO UPDATE SET v = EXCLUDED.v'));
    // The generated assignments must not be double-qualified.
    assert.ok(!sql.includes("kv.v = kv."));
  });

  it("rewrites AUTOINCREMENT DDL", () => {
    assert.equal(
      translateSqliteToPostgres(
        "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)"
      ),
      "CREATE TABLE t (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL)"
    );
  });

  it("rewrites bare INTEGER PRIMARY KEY", () => {
    assert.equal(
      translateSqliteToPostgres("CREATE TABLE t (id INTEGER PRIMARY KEY)"),
      "CREATE TABLE t (id BIGSERIAL PRIMARY KEY)"
    );
  });

  it("rewrites unixepoch('now')", () => {
    assert.equal(
      translateSqliteToPostgres("SELECT * FROM t WHERE ts > unixepoch('now')"),
      "SELECT * FROM t WHERE ts > (EXTRACT(EPOCH FROM NOW()))"
    );
  });

  it("rewrites datetime('now') to NOW()", () => {
    assert.equal(
      translateSqliteToPostgres("UPDATE t SET updated_at = datetime('now')"),
      "UPDATE t SET updated_at = NOW()"
    );
  });

  it("rewrites datetime(<expr>) to to_timestamp(<expr>)", () => {
    assert.equal(
      translateSqliteToPostgres("SELECT datetime(ts / 1000) FROM t"),
      "SELECT to_timestamp(ts / 1000) FROM t"
    );
  });

  it("rewrites strftime('%s', expr)", () => {
    assert.equal(
      translateSqliteToPostgres("SELECT strftime('%s', created_at) FROM t"),
      "SELECT EXTRACT(EPOCH FROM created_at) FROM t"
    );
  });

  it("rewrites strftime with a full ISO format", () => {
    assert.equal(
      translateSqliteToPostgres("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"),
      `SELECT to_char(('now')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
    );
  });

  it("rewrites hex(randomblob(n)) to a uuid hex string", () => {
    assert.equal(
      translateSqliteToPostgres(
        "CREATE TABLE t (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))))"
      ),
      "CREATE TABLE t (id TEXT PRIMARY KEY DEFAULT (lower(replace(gen_random_uuid()::text, '-', ''))))"
    );
  });

  it("drops WITHOUT ROWID", () => {
    const r = translateCreateTable("CREATE TABLE t (a TEXT PRIMARY KEY) WITHOUT ROWID");
    assert.equal(r.skipped, false);
    assert.ok(!/WITHOUT\s+ROWID/i.test(r.sql));
  });

  it("handles a realistic mixed statement", () => {
    assert.equal(
      translateSqliteToPostgres(
        "INSERT OR IGNORE INTO usage_log (api_key_id, cost, created_at) VALUES (?, ?, datetime('now'))"
      ),
      "INSERT INTO usage_log (api_key_id, cost, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING"
    );
  });
});

describe("postgresDialect.pragmaToQuery", () => {
  it("translates PRAGMA table_info(x)", () => {
    const q = pragmaToQuery("PRAGMA table_info(api_keys)");
    assert.ok(q !== null);
    assert.deepEqual(q!.params, ["api_keys"]);
    assert.ok(q!.sql.includes("information_schema.columns"));
    assert.ok(q!.sql.includes("AS cid"));
    assert.ok(q!.sql.includes("AS name"));
    assert.ok(q!.sql.includes("AS pk"));
  });

  it("strips quotes from the table name", () => {
    const q = pragmaToQuery('PRAGMA table_info("my table")');
    assert.deepEqual(q!.params, ["my table"]);
  });

  it("returns null for unsupported pragmas", () => {
    assert.equal(pragmaToQuery("PRAGMA journal_mode=WAL"), null);
  });
});

describe("postgresDialect.sqliteMasterToQuery", () => {
  it("translates sqlite_master type filter", () => {
    const q = sqliteMasterToQuery("SELECT name FROM sqlite_master WHERE type = 'table'");
    assert.ok(q !== null);
    assert.ok(q!.sql.includes("information_schema.tables"));
    assert.ok(q!.sql.includes("table_type = 'TABLE'"));
  });

  it("translates sqlite_master name lookup", () => {
    const q = sqliteMasterToQuery("SELECT name FROM sqlite_master WHERE name = ?");
    assert.ok(q !== null);
    assert.ok(q!.sql.includes("table_name = $1"));
  });

  it("returns null for unrelated queries", () => {
    assert.equal(sqliteMasterToQuery("SELECT * FROM users"), null);
  });

  it("rewrites double-quoted DEFAULT strings to single quotes (with word boundary)", () => {
    assert.equal(
      translateSqliteToPostgres('CREATE TABLE t (cache_source TEXT DEFAULT "upstream")'),
      "CREATE TABLE t (cache_source TEXT DEFAULT 'upstream')"
    );
  });

  it("does not corrupt column lists via bare 'default' inside identifiers", () => {
    assert.equal(
      translateSqliteToPostgres('INSERT INTO "t" ("is_default", "created_at") VALUES ($1, $2)'),
      'INSERT INTO "t" ("is_default", "created_at") VALUES ($1, $2)'
    );
  });
});
