/**
 * db/tableExists.ts — PG-aware table existence check (leaf module).
 *
 * Extracted out of `core.ts` so that `core.ts` <-> `healthCheck.ts` no longer
 * form an import cycle: this helper is a dependency-free leaf (its only import
 * is the adapter type), and the adapter + driver are injected by the caller
 * instead of being resolved from `core.ts` here.
 */

import type { DatabaseAdapter } from "./adapters/types";

export type DbDriver = "sqlite" | "postgres";

/**
 * PG-aware table existence check (single source of truth). SQLite uses
 * `sqlite_master`; PostgreSQL uses `information_schema.tables`. Returns false
 * on any read error so PG-mode code degrades to the "missing table" path
 * (empty/fallback) instead of crashing on `relation does not exist`.
 */
export async function tableExists(tableName: string, dbIn?: DatabaseAdapter): Promise<boolean> {
  // Resolve the async handle only when omitted. Dynamic import keeps this a
  // one-way (leaf -> core) edge so core <-> healthCheck still has no static cycle.
  const db = dbIn ?? (await import("./core")).getAsyncDb();
  try {
    if (db.driver === "postgres") {
      const row = (await db
        .prepare(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?"
        )
        .get(tableName)) as { table_name?: string } | undefined;
      return row?.table_name === tableName;
    }
    const row = (await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)) as { name?: string } | undefined;
    return row?.name === tableName;
  } catch {
    return false;
  }
}
