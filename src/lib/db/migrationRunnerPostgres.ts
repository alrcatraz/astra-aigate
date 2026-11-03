/**
 * PostgreSQL side of the migration runner: dialect translation, statement planning
 * and execution. Split out of migrationRunner.ts so both files stay reviewable and
 * under the file-size ceiling; the SQLite runner imports these.
 */
import type { SqliteAdapter } from "./adapters/types";
import * as fs from "node:fs";
import * as path from "node:path";
import { translateSqliteToPostgres } from "./adapters/postgresDialect";

export type PostgresStatementKind =
  | "pragma"
  | "clusteredHint"
  | "ftsTranslated"
  | "triggerTranslated"
  | "ftsMirrorDerived"
  | "rowidRebased";

export interface PostgresStatementRecord {
  file: string;
  /** Index of the source statement inside its migration file. */
  index: number;
  kind: PostgresStatementKind | null;
  reason?: string;
  executed: boolean;
  source: string;
  translated?: string;
}
export interface PostgresMigrationReport {
  files: string[];
  statements: PostgresStatementRecord[];
}

let lastPostgresMigrationReport: PostgresMigrationReport | null = null;

/** Report of the last PostgreSQL migration run (null on SQLite drivers). */
export function setLastPostgresMigrationReport(report: PostgresMigrationReport | null): void {
  lastPostgresMigrationReport = report;
}

export function getLastPostgresMigrationReport(): PostgresMigrationReport | null {
  return lastPostgresMigrationReport;
}

interface PostgresTranslators {
  splitStatements: (sql: string) => string[];
  translateCreateTable: (sql: string) => { sql: string; skipped: boolean };
}

let postgresTranslatorsPromise: Promise<PostgresTranslators> | null = null;

/**
 * Lazily load the one-shot migration tool's statement splitter and CREATE TABLE
 * translator. Loaded only on the PostgreSQL path: the module pulls in
 * better-sqlite3, which a SQLite deployment that runs on node:sqlite must never
 * be forced to resolve.
 */
function loadPostgresTranslators(): Promise<PostgresTranslators> {
  if (!postgresTranslatorsPromise) {
    postgresTranslatorsPromise = import("./migrateToPostgres").then((mod) => ({
      splitStatements: mod.splitStatements,
      translateCreateTable: mod.translateCreateTable,
    }));
  }
  return postgresTranslatorsPromise;
}

const PG_IDENT = `(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`;

function unquoteIdent(raw: string): string {
  return raw.trim().replace(/^["'`]|["'`]$/g, "");
}

function quotePgIdent(name: string): string {
  return `"${unquoteIdent(name).replace(/"/g, '""')}"`;
}

/** Split a comma-separated list at paren depth 0, skipping quoted strings. */
function splitTopLevelList(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let cur = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      cur += ch;
      if (ch === quote) {
        if (input[i + 1] === quote) {
          cur += input[++i];
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Names of every FTS5 mirror table declared in a migration file. */
function collectFtsTableNames(sql: string): Map<string, string> {
  // table name → source (content=) table
  const names = new Map<string, string>();
  const re =
    /CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[A-Za-z_][A-Za-z0-9_]*"?)\s+USING\s+fts5\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const body = extractBalanced(sql, m.index + m[0].length - 1);
    if (!body) continue;
    const content = /content\s*=\s*'([^']+)'/i.exec(body) ?? /content\s*=\s*"([^"]+)"/i.exec(body);
    names.set(unquoteIdent(m[1]), content ? unquoteIdent(content[1]) : "");
  }
  return names;
}

/** Inner text of the parenthesised group that starts at `open`. */
function extractBalanced(sql: string, open: number): string | null {
  if (sql[open] !== "(") return null;
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return null;
}

/** Which FTS mirror table (if any) a statement writes to / drops. */
function ftsMirrorTarget(statement: string, ftsTables: Map<string, string>): string | null {
  for (const table of ftsTables.keys()) {
    const t = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`^\\s*INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+"?${t}"?\\b`, "i"),
      new RegExp(`^\\s*DELETE\\s+FROM\\s+"?${t}"?\\b`, "i"),
      new RegExp(`^\\s*UPDATE\\s+"?${t}"?\\b`, "i"),
      new RegExp(`^\\s*(?:DROP\\s+TABLE|TRUNCATE)\\s+(?:IF\\s+EXISTS\\s+)?"?${t}"?\\b`, "i"),
    ];
    if (patterns.some((p) => p.test(statement))) return table;
  }
  return null;
}

/**
 * Translate `CREATE VIRTUAL TABLE <t> USING fts5(...)` into the PostgreSQL
 * equivalent: a stored generated tsvector column on the source table plus a GIN
 * index. Throws when the declaration cannot be expressed (e.g. no `content=`
 * table to attach the column to).
 */
function translateFts5Table(
  statement: string,
  fileName: string,
  index: number
): { statements: string[]; reason: string } {
  const throwUntranslatable = (why: string): never => {
    throw new Error(
      `[Migration] Cannot translate ${fileName} statement #${index} to PostgreSQL: ${why}. ` +
        `Statement: ${statement}`
    );
  };

  const head =
    /^CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[A-Za-z_][A-Za-z0-9_]*"?)\s+USING\s+fts5/i.exec(
      statement.trim()
    );
  if (!head) return throwUntranslatable("unrecognised CREATE VIRTUAL TABLE form");

  const ftsTable = unquoteIdent(head[1]);
  const openParen = statement.indexOf("(", head[0].length - 1);
  const body = openParen === -1 ? null : extractBalanced(statement, openParen);
  if (body === null) return throwUntranslatable("could not read the fts5 column list");

  // fts5 accepts `column`, `column UNINDEXED` and `option = value` entries.
  const ignorableOptions = new Set([
    "content_rowid",
    "tokenize",
    "prefix",
    "columnsize",
    "detail",
    "contentless_delete",
  ]);
  const columns: string[] = [];
  let contentTable = "";
  for (const rawEntry of splitTopLevelList(body)) {
    const entry = rawEntry.trim();
    if (!entry || /^--/.test(entry)) continue;
    const eq = entry.indexOf("=");
    if (eq !== -1) {
      const key = entry.slice(0, eq).trim().toLowerCase();
      const value = unquoteIdent(entry.slice(eq + 1).trim());
      if (key === "content") {
        contentTable = value;
        continue;
      }
      if (ignorableOptions.has(key)) continue;
      return throwUntranslatable(`unsupported fts5 option "${key}"`);
    }
    const column = entry.replace(/\s+UNINDEXED\s*$/i, "").trim();
    if (!/^"?[A-Za-z_][A-Za-z0-9_]*"?$/.test(column)) {
      return throwUntranslatable(`unsupported fts5 column entry "${entry}"`);
    }
    columns.push(unquoteIdent(column));
  }

  if (!contentTable) {
    return throwUntranslatable(
      `fts5 table "${ftsTable}" has no content='<table>' option, so there is no table to attach the tsvector column to`
    );
  }
  if (columns.length === 0) {
    return throwUntranslatable(`fts5 table "${ftsTable}" declares no indexed columns`);
  }

  const tsExpression = columns
    .map((column) => `coalesce(${quotePgIdent(column)}, '')`)
    .join(" || ' ' || ");
  const indexName = `${ftsTable}_search_vector_idx`;

  return {
    statements: [
      `ALTER TABLE ${quotePgIdent(contentTable)} ADD COLUMN IF NOT EXISTS search_vector tsvector ` +
        `GENERATED ALWAYS AS (to_tsvector('simple', ${tsExpression})) STORED`,
      `CREATE INDEX IF NOT EXISTS ${quotePgIdent(indexName)} ` +
        `ON ${quotePgIdent(contentTable)} USING GIN (search_vector)`,
    ],
    reason:
      `fts5 virtual table "${ftsTable}" → generated tsvector column ` +
      `search_vector + GIN index on "${contentTable}"`,
  };
}

/**
 * Rewrite a trigger *body* statement. Applies the generic dialect translation
 * first (datetime('now') → NOW(), INSERT OR IGNORE, …) and then the two
 * plpgsql-specific mappings: SQLite's scalar 2-argument MAX(a, b) is GREATEST,
 * and RAISE(ABORT, x) is RAISE EXCEPTION '%', x.
 */
function translateTriggerBodyStatement(statement: string): string {
  let out = translateSqliteToPostgres(statement);
  out = out.replace(/\bMAX\s*\(\s*(-?\d+)\s*,/gi, (_m, first: string) => `GREATEST(${first},`);
  out = out.replace(
    /RAISE\s*\(\s*ABORT\s*,\s*([\s\S]+?)\)\s*$/i,
    (_m, arg: string) => `RAISE EXCEPTION '%', ${arg.trim()}`
  );
  return out;
}

/** `DROP TRIGGER IF EXISTS <name>` → drop it from whichever table owns it. */
function translateBareDropTrigger(name: string): string {
  const safe = unquoteIdent(name).replace(/'/g, "''");
  return `DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = '${safe}' AND NOT t.tgisinternal AND n.nspname = current_schema()
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', '${safe}', r.tbl);
  END LOOP;
END $$`;
}

/**
 * Translate `CREATE TRIGGER … BEGIN … END` into a plpgsql function plus the
 * trigger that calls it. Body statements that only fed the FTS mirror table are
 * dropped (the tsvector column replaces them); if nothing else is left, the
 * trigger itself is reported as ftsMirrorDerived instead of being created as a
 * dead no-op.
 */
function translateCreateTrigger(
  statement: string,
  fileName: string,
  index: number,
  ftsTables: Map<string, string>,
  splitStatements: (sql: string) => string[]
): { statements: string[]; kind: PostgresStatementKind; reason: string } {
  const throwUntranslatable = (why: string): never => {
    throw new Error(
      `[Migration] Cannot translate ${fileName} statement #${index} to PostgreSQL: ${why}. ` +
        `Statement: ${statement}`
    );
  };

  const m = new RegExp(
    `^CREATE\\s+TRIGGER\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${PG_IDENT})\\s+([\\s\\S]+?)\\s+ON\\s+(${PG_IDENT})([\\s\\S]*?)\\s+BEGIN\\s+([\\s\\S]*)\\s+END\\s*$`,
    "i"
  ).exec(statement.trim());
  if (!m) return throwUntranslatable("unrecognised CREATE TRIGGER form");

  const triggerName = unquoteIdent(m[1]);
  const eventClause = m[2].trim();
  const tableName = unquoteIdent(m[3]);
  const tail = m[4];
  const body = m[5];

  const timingMatch = /^(BEFORE|AFTER|INSTEAD\s+OF)\s+([\s\S]+)$/i.exec(eventClause);
  if (!timingMatch) return throwUntranslatable(`unrecognised trigger timing "${eventClause}"`);
  const timing = timingMatch[1].toUpperCase().replace(/\s+/g, " ");
  const event = timingMatch[2].trim().toUpperCase().replace(/\s+/g, " ");
  if (
    !/^(INSERT|UPDATE|DELETE|TRUNCATE|INSERT\s+OR\s+UPDATE|INSERT\s+OR\s+DELETE|UPDATE\s+OR\s+DELETE)(\s+OF\s+[\s\S]+)?$/.test(
      event
    )
  ) {
    return throwUntranslatable(`unrecognised trigger event "${event}"`);
  }

  const perRow = /FOR\s+EACH\s+STATEMENT/i.test(tail) ? "STATEMENT" : "ROW";
  const whenMatch = /WHEN\s*\(([\s\S]*)\)\s*$/i.exec(
    tail.replace(/FOR\s+EACH\s+(?:ROW|STATEMENT)/i, "")
  );
  const whenClause = whenMatch ? ` WHEN (${translateSqliteToPostgres(whenMatch[1].trim())})` : "";

  const bodyStatements = splitStatements(body);
  const keptStatements: string[] = [];
  for (const bodyStatement of bodyStatements) {
    if (ftsMirrorTarget(bodyStatement, ftsTables)) continue;
    if (/\browid\b/i.test(bodyStatement.replace(/content_rowid/gi, ""))) {
      return throwUntranslatable(
        `trigger body uses SQLite's rowid pseudo-column, which PostgreSQL does not have: ${bodyStatement}`
      );
    }
    keptStatements.push(translateTriggerBodyStatement(bodyStatement));
  }

  if (keptStatements.length === 0) {
    return {
      statements: [],
      kind: "ftsMirrorDerived",
      reason:
        `trigger "${triggerName}" only maintained the FTS mirror table; the ` +
        `search_vector generated column replaces it`,
    };
  }

  const returnStatement =
    perRow === "STATEMENT" ? "RETURN NULL" : `RETURN ${event === "DELETE" ? "OLD" : "NEW"}`;
  const functionName = `${triggerName}_fn`;
  const functionBody = keptStatements.map((s) => `  ${s};`).join("\n");

  const fnDdl =
    `CREATE OR REPLACE FUNCTION ${quotePgIdent(functionName)}() RETURNS trigger LANGUAGE plpgsql AS $$\n` +
    `BEGIN\n${functionBody}\n  ${returnStatement};\nEND $$`;
  const dropDdl = `DROP TRIGGER IF EXISTS ${quotePgIdent(triggerName)} ON ${quotePgIdent(tableName)}`;
  const createDdl =
    `CREATE TRIGGER ${quotePgIdent(triggerName)} ${timing} ${event} ON ${quotePgIdent(tableName)} ` +
    `FOR EACH ${perRow}${whenClause} EXECUTE FUNCTION ${quotePgIdent(functionName)}()`;

  return {
    statements: [fnDdl, dropDdl, createDdl],
    kind: "triggerTranslated",
    reason: `SQLite trigger "${triggerName}" → plpgsql function ${functionName}() + trigger`,
  };
}

interface PostgresPlanItem {
  sql: string | null;
  kind: PostgresStatementKind | null;
  reason?: string;
}

/**
 * translateCreateTable() rebuilds the DDL as `CREATE TABLE <name> (…)`, which
 * drops the `IF NOT EXISTS` it parsed out. Re-apply it when the source had it:
 * the migration corpus relies on it for idempotent re-runs, and PostgreSQL
 * raises 42P07 where SQLite is a no-op.
 */
function preserveIfNotExists(source: string, translated: string): string {
  if (!/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(source)) return translated;
  return translated.replace(
    /^\s*CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i,
    "CREATE TABLE IF NOT EXISTS "
  );
}

/**
 * SQLite column type → PostgreSQL type for `ALTER TABLE … ADD COLUMN`, which
 * the CREATE TABLE translator never sees. Mirrors mapColumnType() in
 * migrateToPostgres.ts (not exported, and that module is off-limits here):
 * SQLite types are affinity hints, so the mapping is conservative and lossless.
 */
function mapSqliteColumnType(type: string): string {
  const t = type
    .toUpperCase()
    .replace(/\(.*\)$/, "")
    .trim();
  if (t.startsWith("INT")) return "BIGINT";
  if (t === "REAL" || t.startsWith("FLOA") || t.startsWith("DOUB")) return "DOUBLE PRECISION";
  if (t.startsWith("BLOB")) return "BYTEA";
  if (t.startsWith("BOOL")) return "BOOLEAN";
  if (t.startsWith("NUM") || t.startsWith("DEC")) return "NUMERIC";
  return "TEXT";
}

/**
 * Apply the column-type mapping to `ALTER TABLE <t> ADD [COLUMN] <col> <type>`.
 * PostgreSQL has no BLOB/REAL; SQLite accepts both, so an ALTER carrying one
 * would create a column whose type PG rejects outright.
 */
function mapAlterTableAddColumnType(statement: string): string {
  const m = new RegExp(
    `^(\\s*ALTER\\s+TABLE\\s+${PG_IDENT}\\s+ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?)(${PG_IDENT})(\\s+)([A-Za-z][A-Za-z0-9_]*(?:\\s*\\([\\d,\\s]*\\))?)([\\s\\S]*)$`,
    "i"
  ).exec(statement);
  if (!m) return statement;
  // Only rewrite a recognised SQLite column type. Anything else (ADD
  // CONSTRAINT …, ADD PRIMARY KEY …, a word this map does not know) is left
  // exactly as written so the server validates it.
  const known =
    /^(INT|INTEGER|TINYINT|SMALLINT|BIGINT|TEXT|VARCHAR|NVARCHAR|CHARACTER|CHAR|CLOB|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|BLOB|BOOLEAN|BOOL|DATE|DATETIME|TIMESTAMP|JSON)\b/i;
  if (!known.test(m[4])) return statement;
  return `${m[1]}${m[2]} ${mapSqliteColumnType(m[4])}${m[5]}`;
}

/**
 * Plan one migration file for PostgreSQL execution.
 *
 * Returns, per source statement, the statement(s) to execute (possibly several,
 * for triggers) or `null` when the statement is a permitted no-op — always with
 * the classification that justifies it. Throws when a statement cannot be
 * expressed in PostgreSQL: the file name, statement index and text are included
 * so the failure names exactly what needs a real translation.
 */
/**
 * Dialect blocks — one migration file, two dialects, no drift.
 *
 * A file may section itself:
 *
 *   -- @sqlite
 *   ...statements only SQLite can execute...
 *   -- @postgres
 *   ...the semantically equivalent PostgreSQL form...
 *   -- @end
 *
 * Unmarked statements apply to both drivers. Markers must be whole lines.
 * Files without markers are returned byte-identical, so the existing corpus
 * takes the exact same path it always did.
 *
 * Why blocks instead of a compatibility shim: SQLite's JSON functions are
 * dynamically typed — the same call is compared against a number in one place
 * and a string in another — so a single PG function cannot satisfy both. The
 * dialect block keeps the two forms adjacent, reviewable in one diff, instead
 * of letting a separate PG script drift out of sync.
 */
export function projectMigrationSql(
  fileName: string,
  sql: string,
  driver: "sqlite" | "postgres"
): string {
  if (!/^\s*--\s*@(sqlite|postgres|end)\b/m.test(sql)) return sql;

  const lines = sql.split("\n");
  const out: string[] = [];
  let open: "sqlite" | "postgres" | null = null;
  let openLine = 0;

  lines.forEach((line, i) => {
    const marker = /^\s*--\s*@(sqlite|postgres|end)\s*$/.exec(line);
    if (marker) {
      const tag = marker[1] as "sqlite" | "postgres" | "end";
      if (tag === "end") {
        if (!open) {
          throw new Error(
            `[Migration] ${fileName}:${i + 1}: -- @end without an open dialect block`
          );
        }
        open = null;
        return;
      }
      if (open) {
        throw new Error(
          `[Migration] ${fileName}:${i + 1}: -- @${tag} nested inside a block opened at line ${openLine}`
        );
      }
      open = tag;
      openLine = i + 1;
      return;
    }
    if (open === null || open === driver) out.push(line);
  });

  if (open) {
    throw new Error(
      `[Migration] ${fileName}: unterminated -- @${open} block opened at line ${openLine}`
    );
  }
  return out.join("\n");
}

export async function planPostgresMigrationStatements(
  fileName: string,
  sql: string
): Promise<Array<PostgresPlanItem & { source: string; index: number }>> {
  const { splitStatements, translateCreateTable } = await loadPostgresTranslators();
  const projected = projectMigrationSql(fileName, sql, "postgres");
  const ftsTables = collectFtsTableNames(projected);
  const statements = splitStatements(projected);
  const planned: Array<PostgresPlanItem & { source: string; index: number }> = [];

  statements.forEach((statement, index) => {
    const push = (item: PostgresPlanItem) => planned.push({ ...item, source: statement, index });

    const throwUntranslatable = (why: string): never => {
      throw new Error(
        `[Migration] Cannot translate ${fileName} statement #${index} to PostgreSQL: ${why}. ` +
          `Statement: ${statement}`
      );
    };

    // (a) PRAGMA — session setting; the server enforces WAL/FKs by construction,
    // table_info is served by the adapter's information_schema shim and
    // user_version by the migrations version table.
    if (/^\s*PRAGMA\b/i.test(statement)) {
      push({
        sql: null,
        kind: "pragma",
        reason: "session setting, server-enforced in PostgreSQL",
      });
      return;
    }

    // (c) CREATE VIRTUAL TABLE … USING fts5(…) — translate, never skip.
    if (/^\s*CREATE\s+VIRTUAL\s+TABLE\b/i.test(statement)) {
      if (!/\bUSING\s+fts5\b/i.test(statement)) {
        throwUntranslatable("virtual table modules other than fts5 have no PostgreSQL equivalent");
      }
      const fts = translateFts5Table(statement, fileName, index);
      for (const translated of fts.statements) {
        push({ sql: translated, kind: "ftsTranslated", reason: fts.reason });
      }
      return;
    }

    // (d) CREATE TRIGGER … BEGIN … END — translate to plpgsql.
    if (/^\s*CREATE\s+TRIGGER\b/i.test(statement)) {
      const trigger = translateCreateTrigger(
        statement,
        fileName,
        index,
        ftsTables,
        splitStatements
      );
      if (trigger.statements.length === 0) {
        // The trigger existed only to feed an FTS mirror; report it as such
        // instead of creating a dead no-op trigger in PostgreSQL.
        push({ sql: null, kind: trigger.kind, reason: trigger.reason });
        return;
      }
      for (const translated of trigger.statements) {
        push({ sql: translated, kind: trigger.kind, reason: trigger.reason });
      }
      return;
    }

    // Bare `DROP TRIGGER IF EXISTS <name>;` has no ON clause; SQLite finds the
    // trigger by name. PostgreSQL requires the table, so drop it wherever it
    // lives via the catalog.
    const bareDrop =
      /^\s*DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?("?[A-Za-z_][A-Za-z0-9_]*"?)\s*$/i.exec(statement);
    if (bareDrop) {
      push({
        sql: translateBareDropTrigger(bareDrop[1]),
        kind: "triggerTranslated",
        reason: `DROP TRIGGER "${unquoteIdent(bareDrop[1])}" (no ON clause) → catalog-driven drop`,
      });
      return;
    }

    // FTS *mirror* table writes/drops: the tsvector column and GIN index are
    // derived from the source table, so keeping the mirror in sync is inherent.
    const mirror = ftsMirrorTarget(statement, ftsTables);
    if (mirror) {
      if (!/^\s*(?:INSERT|DELETE|UPDATE|DROP\s+TABLE|TRUNCATE)\b/i.test(statement)) {
        throwUntranslatable(
          `references the fts5 mirror table "${mirror}", which has no PostgreSQL counterpart`
        );
      }
      push({
        sql: null,
        kind: "ftsMirrorDerived",
        reason:
          `fts5 mirror "${mirror}" is derived from the source table's ` +
          `search_vector column on every write; no mirror table exists in PostgreSQL`,
      });
      return;
    }

    // (b) WITHOUT ROWID — storage hint only; strip and create the table.
    if (/\bWITHOUT\s+ROWID\s*$/i.test(statement)) {
      const stripped = statement.replace(/\s*WITHOUT\s+ROWID\s*$/i, "");
      const translated = translateCreateTable(stripped);
      if (translated.skipped || !translated.sql) {
        throwUntranslatable("WITHOUT ROWID table could not be translated");
      }
      push({
        sql: preserveIfNotExists(statement, translated.sql),
        kind: "clusteredHint",
        reason: "WITHOUT ROWID is a SQLite storage hint; the clause was stripped",
      });
      return;
    }

    // SQLite's rowid pseudo-column: rebase the backfill on ctid ordering.
    const rowidBackfill =
      /^UPDATE\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+SET\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s*=\s*CAST\s*\(\s*rowid\s+AS\s+INTEGER\s*\)\s*$/i.exec(
        statement
      );
    if (rowidBackfill) {
      const table = quotePgIdent(rowidBackfill[1]);
      const column = quotePgIdent(rowidBackfill[2]);
      push({
        sql:
          `UPDATE ${table} m SET ${column} = s.rn FROM ` +
          `(SELECT ctid, row_number() OVER (ORDER BY ctid) AS rn FROM ${table}) s ` +
          `WHERE m.ctid = s.ctid AND m.${unquoteIdent(rowidBackfill[2])} IS NULL`,
        kind: "rowidRebased",
        reason:
          "SQLite's rowid pseudo-column does not exist in PostgreSQL; the backfill " +
          "is rebased on a stable row_number over ctid",
      });
      return;
    }
    if (/\browid\b/i.test(statement.replace(/content_rowid/gi, ""))) {
      throwUntranslatable("uses SQLite's rowid pseudo-column, which PostgreSQL does not have");
    }

    // (e) Everything else: CREATE TABLE through the column-type translator,
    // anything else through the dialect translator. ADD COLUMN gains
    // IF NOT EXISTS so a re-run is idempotent (PostgreSQL reports the duplicate
    // as an error where SQLite's runner caught "duplicate column name").
    if (/^\s*CREATE\s+TABLE\b/i.test(statement)) {
      const translated = translateCreateTable(statement);
      if (translated.skipped || !translated.sql) {
        throwUntranslatable("CREATE TABLE could not be translated");
      }
      push({ sql: preserveIfNotExists(statement, translated.sql), kind: null });
      return;
    }

    let generic = mapAlterTableAddColumnType(statement);
    generic = translateSqliteToPostgres(generic);
    generic = generic.replace(
      new RegExp(
        `^(ALTER\\s+TABLE\\s+${PG_IDENT}\\s+ADD\\s+(?:COLUMN\\s+)?)(?!IF\\s+NOT\\s+EXISTS)`,
        "i"
      ),
      "$1IF NOT EXISTS "
    );
    push({ sql: generic, kind: null });
  });

  return planned;
}

/**
 * Execute one migration file against PostgreSQL through the translation shim.
 * Every statement runs on the caller's connection (already inside the
 * per-migration transaction), so a failure rolls the whole file back.
 */
export async function applyMigrationFilePostgres(
  db: SqliteAdapter,
  fileName: string,
  sql: string,
  report?: PostgresMigrationReport
): Promise<void> {
  const planned = await planPostgresMigrationStatements(fileName, sql);
  report?.files.push(fileName);
  for (const item of planned) {
    if (item.sql === null) {
      report?.statements.push({
        file: fileName,
        index: item.index,
        kind: item.kind,
        reason: item.reason,
        executed: false,
        source: item.source,
      });
      continue;
    }
    await db.exec(item.sql).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[Migration] ${fileName} statement #${item.index} failed on PostgreSQL: ${message}. ` +
          `Statement: ${item.sql}`
      );
    });
    report?.statements.push({
      file: fileName,
      index: item.index,
      kind: item.kind,
      reason: item.reason,
      executed: true,
      source: item.source,
      translated: item.sql,
    });
  }
}

/**
 * Run all pending migrations in order.
 * Returns the number of migrations applied.
 *
 * Includes safety checks:
 * 1. Detects migration name mismatches (renumbering) and warns
 * 2. Aborts if too many pending migrations on an existing DB (likely wipe)
 * 3. Creates automatic backup before running any migrations
 *
 * On PostgreSQL the schema is built by the same numbered files through the
 * execution shim above: each statement is translated to its PostgreSQL
 * equivalent (or throws), never dropped silently.
 */
