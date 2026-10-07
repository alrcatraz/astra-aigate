/**
 * db/apiKeys/types.ts — shared API-key value types.
 *
 * Extracted from db/apiKeys.ts (god-file decomposition): the persisted-row shapes
 * that both the host module and the row-parser leaf need. Kept as a neutral leaf so
 * apiKeys.ts and apiKeys/rowParsers.ts can import them without a cycle. apiKeys.ts
 * re-exports both interfaces to preserve its historical public surface.
 */

export interface RateLimitRule {
  limit: number;
  window: number;
}

export interface AccessSchedule {
  enabled: boolean;
  from: string;
  until: string;
  days: number[];
  tz: string;
}

// ── Row/cache shapes (moved out of apiKeys.ts, same leaf pattern) ──────────

export type JsonRecord = Record<string, unknown>;

export interface CacheEntry<TValue> {
  timestamp: number;
  value: TValue;
}

// Re-exported for the historical public surface (moved to ./apiKeys/types).

export interface ApiKeyMetadata {
  id: string;
  name: string;
  machineId: string | null;
  allowedModels: string[];
  blockedModels: string[];
  allowedCombos: string[];
  allowedConnections: string[];
  allowedQuotas: string[];
  noLog: boolean;
  autoResolve: boolean;
  isActive: boolean;
  accessSchedule: AccessSchedule | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMinute: number | null;
  throttleDelayMs: number | null;
  rateLimits: RateLimitRule[] | null;
  // T08: Per-key max concurrent sticky sessions (0 = unlimited)
  maxSessions: number;
  // Phase 3 lifecycle/policy fields
  revokedAt: string | null;
  expiresAt: string | null;
  ipAllowlist: string[];
  scopes: string[];
  isBanned: boolean;
  keyHash: string | null;
  proxyId: string | null;
  allowedEndpoints: string[];
  streamDefaultMode: "legacy" | "json";
  disableNonPublicModels: boolean;
  allowUsageCommand: boolean;
  usageLimitEnabled: boolean;
  dailyUsageLimitUsd: number | null;
  weeklyUsageLimitUsd: number | null;
  chaosModeEnabled: boolean;
}

export interface ApiKeyRow extends JsonRecord {
  id?: unknown;
  name?: unknown;
  key?: unknown;
  machine_id?: unknown;
  machineId?: unknown;
  allowed_models?: unknown;
  allowedModels?: unknown;
  blocked_models?: unknown;
  blockedModels?: unknown;
  allowed_combos?: unknown;
  allowedCombos?: unknown;
  allowed_connections?: unknown;
  allowedConnections?: unknown;
  allowed_quotas?: unknown;
  allowedQuotas?: unknown;
  no_log?: unknown;
  noLog?: unknown;
  auto_resolve?: unknown;
  autoResolve?: unknown;
  is_active?: unknown;
  isActive?: unknown;
  access_schedule?: unknown;
  accessSchedule?: unknown;
  rate_limits?: unknown;
  rateLimits?: unknown;
  proxy_id?: unknown;
  stream_default_mode?: unknown;
  streamDefaultMode?: unknown;
  allow_usage_command?: unknown;
  allowUsageCommand?: unknown;
  usage_limit_enabled?: unknown;
  usageLimitEnabled?: unknown;
  daily_usage_limit_usd?: unknown;
  dailyUsageLimitUsd?: unknown;
  weekly_usage_limit_usd?: unknown;
  weeklyUsageLimitUsd?: unknown;
  chaos_mode_enabled?: unknown;
  chaosModeEnabled?: unknown;
}

export interface StatementLike<TRow = unknown> {
  all: (...params: unknown[]) => Promise<TRow[]>;
  get: (...params: unknown[]) => Promise<TRow | undefined>;
  run: (...params: unknown[]) => Promise<{ changes?: number }>;
}

export interface ApiKeysDbLike {
  prepare: <TRow = unknown>(sql: string) => StatementLike<TRow>;
  exec: (sql: string) => void | Promise<void>;
  /**
   * Cross-backend transaction helper (better-sqlite3 / node:sqlite / sql.js /
   * PostgreSQL). Use this instead of hand-rolling `BEGIN IMMEDIATE`/`COMMIT`/
   * `ROLLBACK` via `exec()`: `BEGIN IMMEDIATE` is SQLite-specific and is a
   * syntax error under PostgreSQL (42601). Every adapter implements
   * `transaction()` with backend-appropriate semantics (SQLite: BEGIN
   * IMMEDIATE; PG: connection-bound client + AsyncLocalStorage routing).
   * Matches `DatabaseAdapter.transaction` (curried): call the returned
   * function to run `fn` and obtain its result.
   */
  transaction: <T>(
    fn: (...args: unknown[]) => Promise<T> | T
  ) => (...args: unknown[]) => Promise<T>;
}

export interface ApiKeysStatements {
  getAllKeys: StatementLike<ApiKeyRow>;
  getKeyById: StatementLike<ApiKeyRow>;
  validateKey: StatementLike<JsonRecord>;
  getKeyMetadata: StatementLike<ApiKeyRow>;
  insertKey: StatementLike;
  deleteKey: StatementLike;
}

export interface ApiKeyView extends JsonRecord {
  id?: string;
  allowedModels: string[];
  blockedModels: string[];
  allowedCombos: string[];
  allowedConnections: string[];
  allowedQuotas: string[];
  noLog: boolean;
  autoResolve: boolean;
  isActive: boolean;
  accessSchedule: AccessSchedule | null;
  throttleDelayMs?: number | null;
  rateLimits: RateLimitRule[] | null;
  scopes: string[];
  proxyId?: string | null;
  isBanned?: boolean;
  expiresAt?: string | null;
  allowedEndpoints: string[];
  streamDefaultMode: "legacy" | "json";
  disableNonPublicModels?: boolean;
  allowUsageCommand?: boolean;
  usageLimitEnabled?: boolean;
  dailyUsageLimitUsd?: number | null;
  weeklyUsageLimitUsd?: number | null;
  chaosModeEnabled?: boolean;
}

// LRU cache for API key validation (valid keys only)
