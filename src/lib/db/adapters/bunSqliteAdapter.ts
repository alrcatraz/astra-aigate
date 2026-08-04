import fs from "node:fs";
import type { PreparedStatement, RunResult, SqliteAdapter } from "./types";

/**
 * The Bun runtime already ships a SQLite driver. Keep this adapter deliberately
 * small so the rest of the application can use the same driver contract as
 * better-sqlite3, node:sqlite, and sql.js. Phase 2.8: async-capable interface;
 * transactions use SAVEPOINTs so the fn may await adapter calls.
 */
export interface BunSqliteDatabaseLike {
  query(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  serialize?(): Uint8Array;
  close(): void;
}

function normalizeRunResult(result: {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
}): RunResult {
  return {
    changes: Number(result.changes ?? 0),
    lastInsertRowid: Number(result.lastInsertRowid ?? 0),
  };
}

function normalizeParams(params: unknown[]): unknown[] {
  if (params.length !== 1) return params;
  const [first] = params;
  if (
    first === null ||
    typeof first !== "object" ||
    Array.isArray(first) ||
    first instanceof Uint8Array ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(first))
  ) {
    return params;
  }

  // better-sqlite3 callers use bare object keys for @name, :name, and $name.
  // Bun requires the sigil to match the SQL placeholder, so provide all three
  // aliases just as the sql.js adapter does.
  const expanded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(first as Record<string, unknown>)) {
    if (/^[:@$]/.test(key)) {
      expanded[key] = value;
    } else {
      expanded[`@${key}`] = value;
      expanded[`:${key}`] = value;
      expanded[`$${key}`] = value;
    }
  }
  return [expanded];
}

export function createBunSqliteAdapter(db: BunSqliteDatabaseLike, filePath: string): SqliteAdapter {
  let isOpen = true;

  async function runSavepoint<T>(
    fn: (...args: unknown[]) => Promise<T> | T,
    ...args: unknown[]
  ): Promise<T> {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    db.exec(`SAVEPOINT "${sp}"`);
    try {
      const result = await fn(...args);
      db.exec(`RELEASE "${sp}"`);
      return result as T;
    } catch (err) {
      try {
        db.exec(`ROLLBACK TO "${sp}"`);
        db.exec(`RELEASE "${sp}"`);
      } catch {}
      throw err;
    }
  }

  return {
    driver: "bun:sqlite",

    get open() {
      return isOpen;
    },

    get name() {
      return filePath;
    },

    prepare(sql: string): PreparedStatement {
      const statement = db.query(sql);
      return {
        async run(...params: unknown[]): Promise<RunResult> {
          return normalizeRunResult(statement.run(...normalizeParams(params)));
        },
        async get(...params: unknown[]): Promise<unknown> {
          return statement.get(...normalizeParams(params));
        },
        async all(...params: unknown[]): Promise<unknown[]> {
          return statement.all(...normalizeParams(params));
        },
      };
    },

    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },

    async pragma(pragmaStr: string, options?: { simple?: boolean }): Promise<unknown> {
      const statement = db.query(`PRAGMA ${pragmaStr}`);
      if (options?.simple) {
        const row = statement.get() as Record<string, unknown> | undefined;
        return row ? (Object.values(row)[0] ?? null) : null;
      }
      return statement.all();
    },

    transaction<T>(fn: (...args: unknown[]) => Promise<T> | T): (...args: unknown[]) => Promise<T> {
      return (...args: unknown[]) => runSavepoint(fn, ...args);
    },

    async immediate(fn: () => Promise<void> | void): Promise<void> {
      await runSavepoint(() => fn());
    },

    async backup(destination: string): Promise<void> {
      if (filePath === ":memory:") return;
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {}
      fs.copyFileSync(filePath, destination);
    },

    async checkpoint(mode = "TRUNCATE"): Promise<void> {
      try {
        db.exec(`PRAGMA wal_checkpoint(${mode})`);
      } catch {}
    },

    async close(): Promise<void> {
      if (!isOpen) return;
      db.close();
      isOpen = false;
    },

    get raw() {
      return db;
    },
  };
}
