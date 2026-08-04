/**
 * CLI entry: migrate a SQLite database to PostgreSQL.
 *
 *   node --import tsx/esm scripts/migrate-sqlite-to-pg.ts [sqlitePath] [dsn]
 *
 * Defaults:
 *   sqlitePath — ./data/storage.sqlite (project DATA_DIR default)
 *   dsn        — postgres://postgres:postgres@127.0.0.1:5432/postgres
 *
 * Prints the migration report (tables, rows, reconciliation).
 */
import { migrateSqliteToPostgres } from "../src/lib/db/migrateToPostgres";

const sqlitePath = process.argv[2] ?? "data/storage.sqlite";
const dsn = process.argv[3] ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

const started = Date.now();
const report = await migrateSqliteToPostgres({
  sqlitePath,
  pgConfig: { connectionString: dsn },
});

console.log("=== Migration report ===");
console.log(`Tables created: ${report.tablesCreated.length}`);
console.log(`Tables skipped: ${report.tablesSkipped.length} (${report.tablesSkipped.join(", ")})`);
console.log(`Indexes created: ${report.indexesCreated.length}`);
const totalRows = Object.values(report.rowsMigrated).reduce((a, b) => a + b, 0);
console.log(`Rows migrated: ${totalRows}`);
console.log("\n=== Reconciliation ===");
const failures = Object.entries(report.reconciled).filter(([, r]) => !r.ok);
if (failures.length === 0) {
  console.log(`All ${Object.keys(report.reconciled).length} tables reconcile ✓`);
} else {
  for (const [table, r] of failures) {
    console.log(`MISMATCH ${table}: sqlite=${r.sqlite} postgres=${r.postgres}`);
  }
}
console.log(`\n=== Warnings (${report.warnings.length}) ===`);
for (const w of report.warnings) console.log(`  - ${w}`);
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
