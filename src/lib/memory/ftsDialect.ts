/**
 * Memory full-text search, expressed once for both drivers.
 *
 * SQLite uses the FTS5 mirror table (`memory_fts … MATCH`), which the migration
 * flow creates as a virtual table. PostgreSQL has no FTS5, so the same migration
 * adds a STORED generated `search_vector tsvector` column plus a GIN index on the
 * source table; the query side must go through it or the index is never used.
 *
 * The two forms differ in where the query parameter sits: SQLite binds it in the
 * WHERE clause, PostgreSQL binds it in a FROM-clause tsquery alias. Callers build
 * their parameter list with `leadParams(query)` so the ordering stays correct.
 */

export interface MemoryFtsSpec {
  /** FROM clause fragment, may itself contain a `?` placeholder (PostgreSQL). */
  from: string;
  /** Predicate that applies the search term. */
  match: string;
  /** ORDER BY expression ranking by relevance. */
  rankExpr: string;
  /** Parameters that must precede the caller's own when binding. */
  leadParams: (query: string) => unknown[];
  driver: "sqlite" | "postgres";
}

export function memoryFtsSpec(driver: string, tableName: string): MemoryFtsSpec {
  if (driver === "postgres") {
    return {
      driver: "postgres",
      from: `${tableName} m, websearch_to_tsquery('simple', ?) AS __memq`,
      match: "m.search_vector @@ __memq",
      rankExpr: "ts_rank(m.search_vector, __memq) DESC",
      leadParams: (query) => [query],
    };
  }
  return {
    driver: "sqlite",
    from: `${tableName} m JOIN memory_fts f ON m.memory_id = f.rowid`,
    match: "f.memory_fts MATCH ?",
    rankExpr: "f.rank",
    leadParams: (query) => [query],
  };
}

/**
 * Whether relevance search can run at all for this table on this driver.
 * SQLite needs the FTS5 mirror; PostgreSQL needs the generated tsvector column.
 */
export async function memoryFtsAvailable(
  db: {
    driver: string;
    prepare: (sql: string) => { get: (...params: unknown[]) => Promise<unknown> };
  },
  tableName: string
): Promise<boolean> {
  if (db.driver === "postgres") {
    const row = (await db
      .prepare(
        "SELECT 1 AS ok FROM information_schema.columns " +
          "WHERE table_schema = 'public' AND table_name = ? AND column_name = 'search_vector' LIMIT 1"
      )
      .get(tableName)) as { ok?: number } | undefined;
    return Boolean(row?.ok);
  }
  const row = (await db
    .prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts' LIMIT 1"
    )
    .get()) as { ok?: number } | undefined;
  return Boolean(row?.ok);
}
