/**
 * Storage-health aggregate query.
 *
 * The /api/storage/health route must not carry raw SQL (check:db-rules #5);
 * the PG size/table-count probe lives here instead, taking the async handle
 * as a parameter so the module stays driver-neutral.
 */
import type { DatabaseAdapter } from "./adapters/types";

export interface PgStorageStats {
  sizeBytes: number;
  tableCount: number;
}

export async function getPgStorageStats(pg: DatabaseAdapter): Promise<PgStorageStats> {
  const stats = (await pg
    .prepare(
      "SELECT pg_database_size(current_database()) AS size, " +
        "(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public') AS tables"
    )
    .get()) as { size: string | number; tables: string | number } | undefined;
  return { sizeBytes: Number(stats?.size ?? 0), tableCount: Number(stats?.tables ?? 0) };
}
