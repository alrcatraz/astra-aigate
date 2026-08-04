/**
 * migrateToPostgres.ts — SQLite → PostgreSQL one-shot migration tool.
 *
 * Phase 2.8 (pg-4): reads the SQLite database file (better-sqlite3, sync raw)
 * and replays schema + data into a PostgreSQL database through the async
 * PostgresAdapter. Verifies with a row-count reconciliation at the end.
 *
 * Scope:
 *   - CREATE TABLE / CREATE INDEX / CREATE UNIQUE INDEX → translated DDL
 *   - Table data → batched INSERTs
 *   - FTS5 virtual tables and triggers are skipped with a warning (PG has no
 *     FTS5; trigger translation is out of scope for the initial cut).
 *
 * Usage (CLI):
 *   node --import tsx/esm scripts/migrate-sqlite-to-pg.ts [sqlitePath] [dsn]
 */

import BetterSqlite3 from "better-sqlite3";
import { createPostgresAdapter, type PostgresAdapterConfig } from "./adapters/postgresAdapter";
import { translateSqliteToPostgres } from "./adapters/postgresDialect";
import type { DatabaseAdapter } from "./adapters/types";

export interface MigrationReport {
  tablesCreated: string[];
  tablesSkipped: string[];
  rowsMigrated: Record<string, number>;
  indexesCreated: string[];
  warnings: string[];
  reconciled: Record<string, { sqlite: number; postgres: number; ok: boolean }>;
}

/** Split a SQL script on statement terminators, skipping strings/comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let depth = 0; // paren nesting — don't split inside ( ... )
  let inTrigger = false; // inside CREATE TRIGGER ... BEGIN ... END

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) {
        if (next === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      buf += ch;
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) {
      const trimmed = buf.trimEnd();
      const triggerBody = inTrigger || /^CREATE\s+TRIGGER/i.test(buf.trimStart());
      if (triggerBody && !/END\s*$/i.test(trimmed)) {
        // Semicolon inside a trigger body — keep accumulating (it is a
        // required part of the trigger body statement terminator).
        inTrigger = true;
        buf += ch;
        continue;
      }
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
      inTrigger = false;
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/** SQLite column type → PostgreSQL type (conservative, lossless). */
function mapColumnType(type: string): string {
  const t = type.toUpperCase().trim();
  if (t.startsWith("INT")) return "BIGINT"; // SQLite INTEGER is 64-bit
  if (t === "REAL" || t.startsWith("FLOA") || t.startsWith("DOUB")) return "DOUBLE PRECISION";
  if (t.startsWith("BLOB")) return "BYTEA";
  if (t.startsWith("BOOL")) return "BOOLEAN";
  if (t.startsWith("NUM") || t.startsWith("DEC")) return "NUMERIC";
  return "TEXT";
}

/**
 * Translate a CREATE TABLE statement to PostgreSQL, mapping column types.
 * Falls back to the generic translator when the statement cannot be parsed.
 */
export function translateCreateTable(sql: string): { sql: string; skipped: boolean } {
  const trimmed = sql.trim();
  if (/^CREATE\s+VIRTUAL\s+TABLE/i.test(trimmed)) {
    return { sql: "", skipped: true };
  }
  // WITHOUT ROWID is a SQLite storage hint with no PG equivalent — drop it.
  const noRowId = trimmed.replace(/\s*WITHOUT\s+ROWID\s*;?\s*$/i, "");
  const m = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s*\(([\s\S]*)\)\s*$/.exec(trimmed);
  if (!m) {
    if (noRowId !== trimmed) {
      return { sql: translateSqliteToPostgres(noRowId), skipped: false };
    }
    // Not a CREATE TABLE — pass through the generic translator.
    return { sql: translateSqliteToPostgres(trimmed), skipped: false };
  }
  const tableName = m[1].replace(/^"|"$/g, "");
  const body = m[2];
  const cols: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    // Skip inline `--` comments before tokenising (their commas/parens must
    // not affect column splitting).
    if (ch === "-" && body[i + 1] === "-") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      cols.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  cols.push(buf.trim());

  const mapped = cols.map((col) => {
    // Strip inline `--` comments inside the column definition (SQLite DDL
    // tolerates them mid-line; PG does not).
    const clean = col.replace(/--[^\n]*/g, "");
    // Table-level constraints pass through.
    if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\\b/i.test(clean)) return clean;
    const cm = /^(\"?[A-Za-z_][\\w]*\"?)\\s+([A-Za-z0-9_]+(?:\\s*\\(\\s*\\d+\\s*\\))?)(.*)$/.exec(
      clean
    );
    if (!cm) return clean;
    const [, colName, colType, rest] = cm;
    const restTrim = rest.trim();
    // Preserve primary-key autoincrement handling from the generic translator.
    if (/PRIMARY\s+KEY\s+AUTOINCREMENT/i.test(restTrim)) {
      return `${colName} BIGSERIAL PRIMARY KEY${restTrim.replace(/PRIMARY\s+KEY\s+AUTOINCREMENT/i, "").trim() ? " " + restTrim.replace(/PRIMARY\s+KEY\s+AUTOINCREMENT/i, "").trim() : ""}`;
    }
    const newType = mapColumnType(colType);
    return `${colName} ${newType}${restTrim ? " " + restTrim : ""}`;
  });

  return {
    // Run the generic translator over the final DDL so DEFAULT expressions
    // (randomblob/hex, time functions, etc.) are also rewritten.
    sql: translateSqliteToPostgres(`CREATE TABLE ${tableName} (${mapped.join(", ")})`),
    skipped: false,
  };
}

function isSqliteSystemTable(name: string): boolean {
  return name.startsWith("sqlite_");
}

/**
 * Run the full migration. Returns a report; never throws for per-table
 * failures — those are recorded in the report.
 */
export async function migrateSqliteToPostgres(options: {
  sqlitePath: string;
  pgConfig: PostgresAdapterConfig;
  batchSize?: number;
}): Promise<MigrationReport> {
  const batchSize = options.batchSize ?? 500;
  const report: MigrationReport = {
    tablesCreated: [],
    tablesSkipped: [],
    rowsMigrated: {},
    indexesCreated: [],
    warnings: [],
    reconciled: {},
  };

  const sqlite = new BetterSqlite3(options.sqlitePath, { readonly: true });
  const pg: DatabaseAdapter = createPostgresAdapter(options.pgConfig);

  try {
    // 1. Schema: snapshot CREATE TABLE DDL from the live SQLite database
    //    (authoritative — exactly matches the data being migrated). FTS5
    //    virtual tables are skipped with a warning.
    const schema = sqlite
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memory_fts%' ORDER BY name"
      )
      .all() as Array<{ name: string; sql: string }>;
    const pending: Array<{ name: string; sql: string }> = [];
    for (const { name, sql } of schema) {
      if (isSqliteSystemTable(name)) continue;
      const { sql: translated, skipped } = translateCreateTable(sql);
      if (skipped) {
        report.warnings.push(`${name}: FTS5 virtual table skipped`);
        continue;
      }
      // Idempotent re-runs: an existing table (previous partial migration)
      // must not be reported as a failure — data is reconciled afterwards.
      const ddl = translated.replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS ");
      try {
        await pg.exec(ddl);
        report.tablesCreated.push(name);
      } catch {
        // Foreign-key dependencies may not be satisfied yet — retry later.
        pending.push({ name, sql: ddl });
      }
    }
    // Additional passes: tables whose FK parents were created earlier. Keep
    // iterating until no table can be created (max 5 rounds).
    for (let round = 0; round < 5 && pending.length > 0; round++) {
      const still: Array<{ name: string; sql: string }> = [];
      for (const { name, sql } of pending) {
        try {
          await pg.exec(sql);
          report.tablesCreated.push(name);
        } catch {
          still.push({ name, sql });
        }
      }
      pending.length = 0;
      pending.push(...still);
    }
    for (const { name, sql } of pending) {
      report.warnings.push(
        `${name}: could not be created — ${sql.match(/CREATE TABLE IF NOT EXISTS (\S+)/i)?.[1] ?? name} (missing FK dependency?)`
      );
    }

    // 2. Data: copy each user table in batches.
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memory_fts%' ORDER BY name"
      )
      .all()
      .map((r: { name: string }) => r.name);

    for (const table of tables) {
      if (isSqliteSystemTable(table)) continue;
      try {
        const count = (
          sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }
        ).n;
        let offset = 0;
        let migrated = 0;
        while (true) {
          const rows = sqlite
            .prepare(`SELECT * FROM "${table}" LIMIT ${batchSize} OFFSET ${offset}`)
            .all() as Array<Record<string, unknown>>;
          if (rows.length === 0) break;
          await insertBatch(pg, table, rows);
          migrated += rows.length;
          offset += rows.length;
          if (rows.length < batchSize) break;
        }
        report.rowsMigrated[table] = migrated;
        if (count !== migrated) {
          report.warnings.push(`${table}: expected ${count} rows, migrated ${migrated}`);
        }
      } catch (err) {
        report.tablesSkipped.push(table);
        report.warnings.push(
          `${table}: data migration failed — ${(err as Error).message.slice(0, 160)}`
        );
      }
    }

    // 3. Indexes (after data, for speed).
    const indexes = sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
      )
      .all() as Array<{ sql: string }>;
    for (const idx of indexes) {
      const translated = translateSqliteToPostgres(idx.sql)
        .replace(/^CREATE UNIQUE INDEX /i, "CREATE UNIQUE INDEX IF NOT EXISTS ")
        .replace(/^CREATE INDEX /i, "CREATE INDEX IF NOT EXISTS ");
      try {
        await pg.exec(translated);
        report.indexesCreated.push(idx.sql);
      } catch (err) {
        report.warnings.push(`index: ${(err as Error).message.slice(0, 120)}`);
      }
    }

    // 4. Reconciliation: row counts.
    for (const table of tables) {
      if (isSqliteSystemTable(table)) continue;
      try {
        const s = (sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
        const row = (await pg.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()) as {
          n: string;
        };
        const p = Number(row.n);
        report.reconciled[table] = { sqlite: s, postgres: p, ok: s === p };
      } catch {
        // Table may not exist on PG (e.g. FTS) — skip.
      }
    }
  } finally {
    sqlite.close();
    await pg.close();
  }

  return report;
}

/** Insert rows into a table using a column-list INSERT (idempotent). */
async function insertBatch(
  pg: DatabaseAdapter,
  table: string,
  rows: Array<Record<string, unknown>>
): Promise<void> {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  // ON CONFLICT DO NOTHING keeps re-runs idempotent and tolerates rows that
  // were already present (e.g. a previous partial migration).
  const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
  for (const row of rows) {
    await pg.prepare(sql).run(...cols.map((c) => row[c]));
  }
}
