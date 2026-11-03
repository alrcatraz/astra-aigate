/**
 * Small, self-contained migration helpers shared by the runner. Extracted so
 * migrationRunner.ts stays within the file-size ceiling.
 */
import type { SqliteAdapter } from "./adapters/types";

export async function hasColumn(
  db: SqliteAdapter,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const columns = (await db.prepare(`PRAGMA table_info(${tableName})`).all()) as Array<{
    name?: string;
  }>;
  return columns.some((column) => column.name === columnName);
}

export async function ensureColumn(
  db: SqliteAdapter,
  tableName: string,
  columnName: string,
  ddl: string
): Promise<void> {
  if (!(await hasColumn(db, tableName, columnName))) {
    await db.exec(ddl);
  }
}

export async function applyCompressionReceiptsMigration(db: SqliteAdapter): Promise<void> {
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_prompt_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_prompt_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_completion_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_completion_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_total_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_total_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_cache_read_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_cache_read_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "actual_cache_write_tokens",
    "ALTER TABLE compression_analytics ADD COLUMN actual_cache_write_tokens INTEGER"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "estimated_usd_saved",
    "ALTER TABLE compression_analytics ADD COLUMN estimated_usd_saved REAL"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "mcp_description_tokens_saved",
    "ALTER TABLE compression_analytics ADD COLUMN mcp_description_tokens_saved INTEGER DEFAULT 0"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "multimodal_skip_count",
    "ALTER TABLE compression_analytics ADD COLUMN multimodal_skip_count INTEGER DEFAULT 0"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "receipt_source",
    "ALTER TABLE compression_analytics ADD COLUMN receipt_source TEXT"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "validation_fallback",
    "ALTER TABLE compression_analytics ADD COLUMN validation_fallback INTEGER DEFAULT 0"
  );
  await ensureColumn(
    db,
    "compression_analytics",
    "output_mode",
    "ALTER TABLE compression_analytics ADD COLUMN output_mode TEXT"
  );

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_compression_analytics_request_id
      ON compression_analytics(request_id);
    CREATE INDEX IF NOT EXISTS idx_compression_analytics_receipt_source
      ON compression_analytics(receipt_source);
  `);
}
