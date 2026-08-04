import type { DatabaseAdapter, PreparedStatement, RunResult } from "./types";

/**
 * Phase 2.8: wraps the synchronous better-sqlite3 driver behind the uniform
 * async DatabaseAdapter interface. Every method returns a Promise; the
 * underlying calls stay synchronous but are boxed so business modules can be
 * written once and run on both SQLite and PostgreSQL.
 *
 * Transactions are driven manually (BEGIN IMMEDIATE / COMMIT / ROLLBACK with
 * SAVEPOINTs for nesting) because better-sqlite3's native transaction wrapper
 * cannot host async functions — an async fn would escape the transaction at
 * its first await.
 */
export function createBetterSqliteAdapter(db: import("better-sqlite3").Database): DatabaseAdapter {
  let txDepth = 0;

  return {
    driver: "better-sqlite3",

    get open() {
      return db.open;
    },

    get name() {
      return db.name;
    },

    prepare(sql: string): PreparedStatement {
      const stmt = db.prepare(sql);
      return {
        run: async (...params: unknown[]): Promise<RunResult> =>
          stmt.run(...params) as unknown as RunResult,
        get: async (...params: unknown[]): Promise<unknown> => stmt.get(...params),
        all: async (...params: unknown[]): Promise<unknown[]> => stmt.all(...params),
      };
    },

    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },

    async pragma(pragmaStr: string, options?: { simple?: boolean }): Promise<unknown> {
      return db.pragma(pragmaStr, options);
    },

    transaction<T>(fn: (...args: unknown[]) => Promise<T> | T): (...args: unknown[]) => Promise<T> {
      return async (...args: unknown[]): Promise<T> => {
        const nested = txDepth > 0;
        const sp = `sp_${txDepth}`;
        db.exec(nested ? `SAVEPOINT ${sp}` : "BEGIN IMMEDIATE");
        txDepth++;
        try {
          const result = await fn(...args);
          db.exec(nested ? `RELEASE ${sp}` : "COMMIT");
          return result as T;
        } catch (err) {
          db.exec(nested ? `ROLLBACK TO ${sp}` : "ROLLBACK");
          throw err;
        } finally {
          txDepth--;
        }
      };
    },

    async immediate(fn: () => Promise<void> | void): Promise<void> {
      db.exec("BEGIN IMMEDIATE");
      try {
        await fn();
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    async backup(destination: string): Promise<void> {
      await db.backup(destination);
    },

    async checkpoint(mode = "TRUNCATE"): Promise<void> {
      try {
        db.pragma(`wal_checkpoint(${mode})`);
      } catch {}
    },

    async close(): Promise<void> {
      db.close();
    },

    get raw() {
      return db;
    },
  };
}
