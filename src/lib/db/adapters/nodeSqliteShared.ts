import fs from "node:fs";
import type { PreparedStatement, RunResult, SqliteAdapter } from "./types";

export interface NodeSqliteDatabaseLike {
  prepare(sql: string): {
    run(...p: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...p: unknown[]): unknown;
    all(...p: unknown[]): unknown[];
  };
  exec(sql: string): void;
  close(): void;
}

const MAX_STMT_CACHE_SIZE = 200;

export function createNodeSqliteAdapterFromDatabase(
  db: NodeSqliteDatabaseLike,
  filePath: string,
  onClose?: () => void
): SqliteAdapter {
  let _isOpen = true;
  type NodeSqliteStatement = ReturnType<NodeSqliteDatabaseLike["prepare"]>;
  interface CachedStatement {
    stmt: NodeSqliteStatement;
  }
  const stmtCache = new Map<string, CachedStatement>();

  function finalizeStatement(stmt: NodeSqliteStatement | undefined) {
    if (stmt && "finalize" in stmt) {
      try {
        (stmt as NodeSqliteStatement & { finalize: () => void }).finalize();
      } catch {}
    }
  }

  function getCached(sql: string) {
    let entry = stmtCache.get(sql);
    if (entry) {
      stmtCache.delete(sql);
      stmtCache.set(sql, entry);
    } else {
      const stmt = db.prepare(sql);
      if (stmtCache.size >= MAX_STMT_CACHE_SIZE) {
        const oldestKey = stmtCache.keys().next().value;
        if (oldestKey !== undefined) {
          finalizeStatement(stmtCache.get(oldestKey)?.stmt);
          stmtCache.delete(oldestKey);
        }
      }
      entry = { stmt };
      stmtCache.set(sql, entry);
    }
    return entry.stmt;
  }

  /**
   * SAVEPOINT-based transaction. Async-capable (Phase 2.8): the fn may await
   * adapter calls, which is impossible with the old synchronous wrapper.
   * Nested transactions work because SQLite SAVEPOINTs stack and must be
   * released in reverse order.
   */
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

  function close() {
    try {
      onClose?.();
    } catch {}
    try {
      for (const entry of stmtCache.values()) {
        finalizeStatement(entry.stmt);
      }
      stmtCache.clear();
    } catch {}
    try {
      db.close();
    } catch {}
    _isOpen = false;
  }

  return {
    driver: "node:sqlite",
    get open() {
      return _isOpen;
    },
    get name() {
      return filePath;
    },
    prepare(sql: string): PreparedStatement {
      const stmt = getCached(sql);
      return {
        async run(...params: unknown[]): Promise<RunResult> {
          const r = stmt.run(...params);
          return {
            changes: Number(r.changes ?? 0),
            lastInsertRowid: Number(r.lastInsertRowid ?? 0),
          };
        },
        async get(...params: unknown[]): Promise<unknown> {
          return stmt.get(...params);
        },
        async all(...params: unknown[]): Promise<unknown[]> {
          return stmt.all(...params);
        },
      };
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async pragma(pragmaStr: string, options?: { simple?: boolean }): Promise<unknown> {
      const sql = `PRAGMA ${pragmaStr}`;
      if (options?.simple) {
        const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
        if (!row) return null;
        return Object.values(row)[0] ?? null;
      }
      return db.prepare(sql).all();
    },
    transaction<T>(fn: (...args: unknown[]) => Promise<T> | T): (...args: unknown[]) => Promise<T> {
      return (...args: unknown[]) => runSavepoint(fn, ...args);
    },
    async immediate(fn: () => Promise<void> | void): Promise<void> {
      await runSavepoint(() => fn());
    },
    async backup(destination: string): Promise<void> {
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
    close: async () => close(),
    get raw() {
      return db;
    },
  };
}
