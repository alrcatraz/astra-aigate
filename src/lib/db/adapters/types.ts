export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Prepared statement handle. `prepare()` itself stays synchronous (it only
 * captures the SQL text / compiles locally), but every execution method is
 * async — required because PostgreSQL drivers are async-only and Node has no
 * synchronous network I/O. SQLite adapters wrap their sync drivers with
 * Promise so the business layer sees one uniform async interface.
 */
export interface PreparedStatement {
  run(...params: unknown[]): Promise<RunResult>;
  get(...params: unknown[]): Promise<unknown>;
  all(...params: unknown[]): Promise<unknown[]>;
}

export type DatabaseDriver =
  "better-sqlite3" | "node:sqlite" | "bun:sqlite" | "sql.js" | "postgres";

/**
 * Uniform async database adapter. Phase 2.8: SQLite stays the default
 * (zero-ops), PostgreSQL is opt-in via `DB_DRIVER=postgres` — both implement
 * this interface. Dialect translation (?, AUTOINCREMENT, INSERT OR IGNORE,
 * sqlite_master, ...) lives inside each adapter, business modules stay
 * driver-agnostic.
 */
export interface DatabaseAdapter {
  readonly driver: DatabaseDriver;
  readonly open: boolean;
  readonly name: string;

  prepare(sql: string): PreparedStatement;
  exec(sql: string): Promise<void>;
  pragma(pragmaStr: string, options?: { simple?: boolean }): Promise<unknown>;

  /** Runs `fn` inside a transaction; `fn` may be async. Nested calls use SAVEPOINTs. */
  transaction<T>(fn: (...args: unknown[]) => Promise<T> | T): (...args: unknown[]) => Promise<T>;

  /** Runs `fn` inside an immediate (write-lock acquiring) transaction. */
  immediate(fn: () => Promise<void> | void): Promise<void>;

  /** Native backup or file-copy fallback. */
  backup(destination: string): Promise<void>;

  checkpoint(mode?: string): Promise<void>;
  close(): Promise<void>;

  readonly raw: unknown;
}

/** @deprecated Phase 2.8 renamed the interface — use DatabaseAdapter. */
export type SqliteAdapter = DatabaseAdapter;

/**
 * Synchronous view of the underlying driver (better-sqlite3 / node:sqlite /
 * sql.js / bun:sqlite are all synchronous). Used only inside getDbInstance()
 * and the probe-failure capture path, which must stay synchronous because
 * getDbInstance() itself is. Postgres (async driver) never takes these paths.
 */
export interface RawSyncStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface RawSyncDb {
  prepare(sql: string): RawSyncStatement;
  exec(sql: string): void;
}
