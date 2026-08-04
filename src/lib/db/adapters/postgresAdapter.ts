/**
 * postgresAdapter.ts — PostgreSQL adapter implementing the uniform async
 * DatabaseAdapter interface (Phase 2.8 / pg-3).
 *
 * PostgreSQL is a network service with an async-only driver, so this adapter
 * is natively async (no sync-boxing needed). Every statement runs through
 * `translateSqliteToPostgres` so business modules keep writing SQLite-flavoured
 * SQL. `raw` is intentionally unusable here: the sync-probe paths that use it
 * are SQLite-only (see core.ts / getDbInstance).
 *
 * Transactions are connection-bound: `transaction()` borrows a client from the
 * pool for the duration of the callback, and every statement executed inside
 * the callback (including nested transactions via SAVEPOINT) routes to that
 * client through AsyncLocalStorage.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import type { DatabaseAdapter, DatabaseDriver, PreparedStatement, RunResult } from "./types";
import { pragmaToQuery, sqliteMasterToQuery, translateSqliteToPostgres } from "./postgresDialect";

const { Pool } = pg;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface PostgresAdapterConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | Record<string, unknown>;
  /** Max concurrent clients (default 10). */
  max?: number;
}

/** Carries the transaction-scoped client for the current async context. */
const txStorage = new AsyncLocalStorage<pg.PoolClient>();

/**
 * Primary-key cache: table name → PK column names (insertion order). Warmed
 * once at startup from information_schema so `INSERT OR REPLACE` upserts can
 * emit a valid PG `ON CONFLICT (<pk>) DO UPDATE SET ...` arbiter target.
 */
const pkCache = new Map<string, string[]>();

async function warmPrimaryKeyCache(pool: pg.Pool): Promise<void> {
  const res = await pool.query(
    `SELECT tc.table_name AS table_name, kcu.column_name AS column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.constraint_schema = kcu.constraint_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.ordinal_position`
  );
  pkCache.clear();
  for (const row of res.rows as Array<{ table_name: string; column_name: string }>) {
    const list = pkCache.get(row.table_name) ?? [];
    list.push(row.column_name);
    pkCache.set(row.table_name, list);
  }
}

function arbiterFor(table: string): string[] | undefined {
  return pkCache.get(table);
}

export function createPostgresAdapter(config: PostgresAdapterConfig = {}): DatabaseAdapter {
  const pool = new Pool({
    connectionString: config.connectionString,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    max: config.max ?? 10,
  });

  let closed = false;

  function clientFor(pool: pg.Pool): pg.PoolClient | pg.Pool {
    return txStorage.getStore() ?? pool;
  }

  return {
    driver: "postgres" as DatabaseDriver,

    /** Internal: warm the PK cache (called by initDatabaseDriver at boot). */
    async __warmPrimaryKeys(): Promise<void> {
      await warmPrimaryKeyCache(pool);
    },

    get open() {
      return !closed;
    },

    get name() {
      return config.database ?? config.connectionString ?? "postgres";
    },

    prepare(sql: string): PreparedStatement {
      // PRAGMA table_info(...) is queried through prepare() by schema helpers —
      // route it to the information_schema translation before the dialect layer.
      const pragmaQ = pragmaToQuery(sql);
      if (pragmaQ) {
        return {
          async run(): Promise<RunResult> {
            const res = await clientFor(pool).query(pragmaQ.sql, pragmaQ.params);
            return { changes: res.rowCount ?? 0, lastInsertRowid: 0 };
          },
          async get(): Promise<unknown> {
            const res = await clientFor(pool).query(pragmaQ.sql, pragmaQ.params);
            return res.rows[0] ?? undefined;
          },
          async all(): Promise<unknown[]> {
            const res = await clientFor(pool).query(pragmaQ.sql, pragmaQ.params);
            return res.rows;
          },
        };
      }
      const translated = translateSqliteToPostgres(sql, arbiterFor);
      // SQLite named placeholders (@name / :name) → positional $N so the pg
      // driver can bind object params. Positional ? placeholders were already
      // rewritten by the dialect layer; count those first so named ones append
      // after them without clobbering.
      let maxPositional = 0;
      const positionalMatch = translated.match(/\$(\d+)/g);
      if (positionalMatch) {
        for (const m of positionalMatch) {
          maxPositional = Math.max(maxPositional, Number(m.slice(1)));
        }
      }
      const namedOrder: string[] = [];
      // SQLite named placeholders are @name / :name — but NOT the PG cast
      // operator `::type`. Negative lookbehind excludes the second colon of
      // `::` so `to_char((ts)::timestamptz ...)` survives untouched.
      const preparedSql = translated.replace(/(?<!:)[@:]([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, name) => {
        namedOrder.push(name);
        return `$${++maxPositional}`;
      });

      /** Normalise call-site params (array | named object) into a positional array. */
      const bind = (params: unknown[]): unknown[] => {
        if (namedOrder.length > 0 && params.length === 1 && isPlainObject(params[0])) {
          const obj = params[0] as Record<string, unknown>;
          return namedOrder.map((name) => obj[name]);
        }
        if (params.length === 1 && isPlainObject(params[0])) {
          // No named placeholders but an object was passed (better-sqlite3
          // allows named params with object args) — map by object keys only if
          // the SQL actually contains them; otherwise drop empty objects.
          const keys = Object.keys(params[0] as Record<string, unknown>);
          return keys.length === 0 ? [] : params;
        }
        return params;
      };

      return {
        async run(...params: unknown[]): Promise<RunResult> {
          const res = await clientFor(pool).query(preparedSql, bind(params));
          return {
            changes: res.rowCount ?? 0,
            lastInsertRowid: (res.rows?.[0]?.id as number | bigint | undefined) ?? 0,
          };
        },
        async get(...params: unknown[]): Promise<unknown> {
          const res = await clientFor(pool).query(preparedSql, bind(params));
          return res.rows[0] ?? undefined;
        },
        async all(...params: unknown[]): Promise<unknown[]> {
          const res = await clientFor(pool).query(preparedSql, bind(params));
          return res.rows;
        },
      };
    },

    async exec(sql: string): Promise<void> {
      const translated = translateSqliteToPostgres(sql, arbiterFor);
      await clientFor(pool).query(translated);
    },

    async pragma(pragmaStr: string, _options?: { simple?: boolean }): Promise<unknown> {
      const q = pragmaToQuery(pragmaStr);
      if (!q) return undefined;
      const res = await clientFor(pool).query(q.sql, q.params);
      return res.rows;
    },

    transaction<T>(fn: (...args: unknown[]) => Promise<T> | T): (...args: unknown[]) => Promise<T> {
      return async (...args: unknown[]): Promise<T> => {
        const outer = txStorage.getStore();
        if (outer) {
          // Nested transaction → SAVEPOINT on the outer client.
          const sp = `sp_${Math.random().toString(36).slice(2, 10)}`;
          await outer.query(`SAVEPOINT ${sp}`);
          try {
            return (await txStorage.run(outer, () => fn(...args))) as T;
          } catch (err) {
            await outer.query(`ROLLBACK TO ${sp}`);
            throw err;
          }
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = (await txStorage.run(client, () => fn(...args))) as T;
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      };
    },

    async immediate(fn: () => Promise<void> | void): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await txStorage.run(client, () => fn());
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    /** PG backups are handled externally (pg_dump) — nothing to do here. */
    async backup(_destination: string): Promise<void> {
      // SQLite file-copy semantics do not apply to a server database.
      return;
    },

    async checkpoint(_mode?: string): Promise<void> {
      // WAL checkpointing is a SQLite concept — no-op for PostgreSQL.
      return;
    },

    async close(): Promise<void> {
      closed = true;
      await pool.end();
    },

    /** PostgreSQL has no synchronous interface — accessing raw is a bug. */
    get raw(): unknown {
      throw new Error(
        "PostgresAdapter.raw is not available: PostgreSQL has no synchronous driver. " +
          "Use the async DatabaseAdapter methods instead (see getDbInstance async paths)."
      );
    },
  } as unknown as DatabaseAdapter;
}

/** Re-export for callers that want to run raw SQLite-master-like queries. */
export { sqliteMasterToQuery };
