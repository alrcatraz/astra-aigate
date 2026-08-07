/**
 * registeredKeys.ts — DB module
 *
 * @description Singleton-generated API key CRUD (`registered_keys` table)
 *
 * Operations:
 *   - createRegisteredKey
 *   - listRegisteredKeys (filtered / paginated)
 *   - getRegisteredKey
 *   - getRegisteredKeyByHash
 *   - updateRegisteredKey
 *   - deleteRegisteredKey
 *   - toggleRegisteredKey
 *
 * Note: The key is stored in hashed form (`keyHash`) and returned decrypted at
 * creation time via `RegisteredKeyWithSecret.rawKey`. The raw key cannot be
 * retrieved later.
 */

import { randomBytes, createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { rowToCamel, getAsyncDb } from "./core";

// ── Types ────────────────────────────────────────────────────────────────────
export interface RegisteredKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  model: string;
  endpoints: string | null;
  params: string;
  isActive: boolean;
  isDisabled: boolean;
  createdByIp: string | null;
  lastUsedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  expiresAt: number | null;
  metadata: string;
}

export interface RegisteredKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  model: string;
  endpoints: string | null;
  params: string;
  is_active: number;
  is_disabled: number;
  created_by_ip: string | null;
  last_used_at: number | null;
  created_at: number | null;
  updated_at: number | null;
  expires_at: number | null;
  metadata: string;
  // quota/budget columns (migration 008) — referenced by legacy recovery API
  daily_budget: number | null;
  hourly_budget: number | null;
  daily_used: number;
  hourly_used: number;
  last_reset_day: string;
  last_reset_hour: string;
}

export interface RegisteredKeyWithSecret extends RegisteredKey {
  rawKey: string;
}

export interface CreateKeyInput {
  name: string;
  model?: string;
  endpoints?: string[];
  params?: Record<string, unknown>;
  expiresAt?: number;
  createdByIp?: string;
  metadata?: Record<string, unknown>;
}

export interface ListKeysOptions {
  page?: number;
  limit?: number;
  search?: string;
  model?: string;
  isActive?: boolean;
}

// ── Register ─────────────────────────────────────────────────────────────────

export async function createRegisteredKey(input: CreateKeyInput): Promise<RegisteredKeyWithSecret> {
  const db = await getAsyncDb();
  const id = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  const rawKey = "astra-" + randomBytes(24).toString("hex");
  const keyHash = await createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.substring(0, 14);

  await db
    .prepare(
      `INSERT INTO registered_keys
        (id, name, key_hash, key_prefix, model, endpoints, params, is_active, is_disabled,
         created_by_ip, last_used_at, created_at, updated_at, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, NULL, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      keyHash,
      keyPrefix,
      input.model || "all",
      input.endpoints ? JSON.stringify(input.endpoints) : null,
      JSON.stringify(input.params || {}),
      input.createdByIp || null,
      now,
      now,
      input.expiresAt || null,
      JSON.stringify(input.metadata || {})
    );

  return {
    id,
    name: input.name,
    keyHash,
    keyPrefix,
    model: input.model || "all",
    endpoints: input.endpoints ? JSON.stringify(input.endpoints) : null,
    params: JSON.stringify(input.params || {}),
    isActive: true,
    isDisabled: false,
    createdByIp: input.createdByIp || null,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt || null,
    metadata: JSON.stringify(input.metadata || {}),
    rawKey,
  };
}

function mapRow(row: unknown): RegisteredKey {
  const r = row as RegisteredKeyRow;
  return {
    id: r.id,
    name: r.name,
    keyHash: r.key_hash,
    keyPrefix: r.key_prefix,
    model: r.model,
    endpoints: r.endpoints,
    params: r.params,
    isActive: r.is_active === 1,
    isDisabled: r.is_disabled === 1,
    createdByIp: r.created_by_ip,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
    metadata: r.metadata,
  };
}

function rowToCamelLocal(row: unknown): Record<string, unknown> {
  const record = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camelKey] = record[key];
  }
  return out;
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listRegisteredKeys(
  options: ListKeysOptions = {}
): Promise<{ items: RegisteredKey[]; total: number }> {
  const db = await getAsyncDb();
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("name LIKE ?");
    params.push(`%${options.search}%`);
  }
  if (options.model) {
    conditions.push("model = ?");
    params.push(options.model);
  }
  if (options.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(options.isActive ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = (await db
    .prepare(`SELECT count(*) as total FROM registered_keys ${where}`)
    .get(...params)) as { total: number };

  const rows = (await db
    .prepare(`SELECT * FROM registered_keys ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)) as RegisteredKeyRow[];

  return {
    items: rows.map(mapRow),
    total: countRow?.total || 0,
  };
}

// ── Get by ID ────────────────────────────────────────────────────────────────

export async function getRegisteredKey(id: string): Promise<RegisteredKey | null> {
  const db = await getAsyncDb();
  const row = (await db.prepare("SELECT * FROM registered_keys WHERE id = ?").get(id)) as
    RegisteredKeyRow | undefined;
  return row ? mapRow(row) : null;
}

export async function getRegisteredKeyByHash(keyHash: string): Promise<RegisteredKey | null> {
  const db = await getAsyncDb();
  const row = (await db
    .prepare("SELECT * FROM registered_keys WHERE key_hash = ?")
    .get(keyHash)) as RegisteredKeyRow | undefined;
  return row ? mapRow(row) : null;
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateRegisteredKey(
  id: string,
  updates: Partial<{
    name: string;
    model: string;
    endpoints: string[];
    params: Record<string, unknown>;
    expiresAt: number | null;
    isActive: boolean;
    isDisabled: boolean;
    metadata: Record<string, unknown>;
  }>
): Promise<RegisteredKey | null> {
  const existing = await getRegisteredKey(id);
  if (!existing) return null;

  const db = await getAsyncDb();
  const now = Math.floor(Date.now() / 1000);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.model !== undefined) {
    sets.push("model = ?");
    params.push(updates.model);
  }
  if (updates.endpoints !== undefined) {
    sets.push("endpoints = ?");
    params.push(JSON.stringify(updates.endpoints));
  }
  if (updates.params !== undefined) {
    sets.push("params = ?");
    params.push(JSON.stringify(updates.params));
  }
  if (updates.expiresAt !== undefined) {
    sets.push("expires_at = ?");
    params.push(updates.expiresAt);
  }
  if (updates.isActive !== undefined) {
    sets.push("is_active = ?");
    params.push(updates.isActive ? 1 : 0);
  }
  if (updates.isDisabled !== undefined) {
    sets.push("is_disabled = ?");
    params.push(updates.isDisabled ? 1 : 0);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(updates.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  params.push(now);
  params.push(id);

  await db.prepare(`UPDATE registered_keys SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getRegisteredKey(id);
}

export async function toggleRegisteredKey(
  id: string,
  isActive: boolean
): Promise<RegisteredKey | null> {
  const db = await getAsyncDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE registered_keys SET is_active = ?, updated_at = ? WHERE id = ?")
    .run(isActive ? 1 : 0, now, id);
  return getRegisteredKey(id);
}

export async function deleteRegisteredKey(id: string): Promise<boolean> {
  const db = await getAsyncDb();
  const result = await db.prepare("DELETE FROM registered_keys WHERE id = ?").run(id);
  return (result.changes ?? 0) > 0;
}

// ── Usage tracking ───────────────────────────────────────────────────────────

export async function recordRegisteredKeyUsage(keyHash: string): Promise<void> {
  const db = await getAsyncDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE registered_keys SET last_used_at = ? WHERE key_hash = ?")
    .run(now, keyHash);
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface RegisteredKeySummary {
  total: number;
  active: number;
  inactive: number;
  usedThisWeek: number;
}

export async function getRegisteredKeySummary(): Promise<RegisteredKeySummary> {
  const db = await getAsyncDb();
  const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  const totalRow = (await db.prepare("SELECT count(*) as cnt FROM registered_keys").get()) as {
    cnt: number;
  };
  const activeRow = (await db
    .prepare("SELECT count(*) as cnt FROM registered_keys WHERE is_active = 1")
    .get()) as { cnt: number };
  const inactiveRow = (await db
    .prepare("SELECT count(*) as cnt FROM registered_keys WHERE is_active = 0")
    .get()) as { cnt: number };
  const usedRow = (await db
    .prepare(
      "SELECT count(*) as cnt FROM registered_keys WHERE last_used_at IS NOT NULL AND last_used_at > ?"
    )
    .get(oneWeekAgo)) as { cnt: number };

  return {
    total: totalRow?.cnt || 0,
    active: activeRow?.cnt || 0,
    inactive: inactiveRow?.cnt || 0,
    usedThisWeek: usedRow?.cnt || 0,
  };
}

// ── [recovered] Legacy registered-key API (restored from HEAD; task-1 rewrite dropped it) ──

export interface ProviderKeyLimit {
  provider: string;
  maxActiveKeys: number | null;
  dailyIssueLimit: number | null;
  hourlyIssueLimit: number | null;
  dailyIssued: number;
  hourlyIssued: number;
  updatedAt: string;
}

export interface AccountKeyLimit {
  accountId: string;
  maxActiveKeys: number | null;
  dailyIssueLimit: number | null;
  hourlyIssueLimit: number | null;
  dailyIssued: number;
  hourlyIssued: number;
  updatedAt: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
  provider?: string;
  accountId?: string;
  providerActiveKeys?: number;
  accountActiveKeys?: number;
}

export interface IssueKeyParams {
  name: string;
  provider?: string;
  accountId?: string;
  idempotencyKey?: string;
  expiresAt?: string;
  dailyBudget?: number;
  hourlyBudget?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowDay(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowHour(): string {
  return new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function hashKey(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawKey(): string {
  // ork_ prefix so users can easily identify these keys
  return "ork_" + randomBytes(24).toString("base64url");
}

/** Reset window counters if the tracking period has changed. */

async function maybeResetWindow(
  db: ReturnType<typeof getAsyncDb>,
  table: string,
  idField: string,
  idValue: string
): Promise<void> {
  const today = nowDay();
  const hour = nowHour();

  await db
    .prepare(
      `
    UPDATE ${table}
    SET daily_issued = CASE WHEN last_reset_day <> ? THEN 0 ELSE daily_issued END,
        hourly_issued = CASE WHEN last_reset_hour <> ? THEN 0 ELSE hourly_issued END,
        last_reset_day = ?,
        last_reset_hour = ?
    WHERE ${idField} = ?
  `
    )
    .run(today, hour, today, hour, idValue);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a new registered key can be issued for the given provider/account.
 * Returns { allowed: true } or { allowed: false, errorCode, errorMessage }.
 */

export async function checkQuota(provider = "", accountId = ""): Promise<QuotaCheckResult> {
  const db = await getAsyncDb();
  const today = nowDay();
  const hour = nowHour();

  // ── provider-level check ──
  if (provider) {
    maybeResetWindow(db, "provider_key_limits", "provider", provider);

    const limits = (await db
      .prepare("SELECT * FROM provider_key_limits WHERE provider = ?")
      .get(provider)) as ProviderKeyLimitRow | undefined;

    if (limits) {
      if (limits.hourly_issue_limit !== null && limits.hourly_issued >= limits.hourly_issue_limit) {
        return {
          allowed: false,
          errorCode: "PROVIDER_QUOTA_EXCEEDED",
          errorMessage: `Hourly issue limit (${limits.hourly_issue_limit}) reached for provider '${provider}'`,
          provider,
        };
      }
      if (limits.daily_issue_limit !== null && limits.daily_issued >= limits.daily_issue_limit) {
        return {
          allowed: false,
          errorCode: "PROVIDER_QUOTA_EXCEEDED",
          errorMessage: `Daily issue limit (${limits.daily_issue_limit}) reached for provider '${provider}'`,
          provider,
        };
      }
      if (limits.max_active_keys !== null) {
        const { activeCount } = (await db
          .prepare(
            "SELECT COUNT(*) as activeCount FROM registered_keys WHERE provider = ? AND is_active = 1"
          )
          .get(provider)) as { activeCount: number };
        if (activeCount >= limits.max_active_keys) {
          return {
            allowed: false,
            errorCode: "MAX_ACTIVE_KEYS_EXCEEDED",
            errorMessage: `Max active keys (${limits.max_active_keys}) reached for provider '${provider}'`,
            provider,
            providerActiveKeys: activeCount,
          };
        }
      }
    }
  }

  // ── account-level check ──
  if (accountId) {
    maybeResetWindow(db, "account_key_limits", "account_id", accountId);

    const limits = (await db
      .prepare("SELECT * FROM account_key_limits WHERE account_id = ?")
      .get(accountId)) as AccountKeyLimitRow | undefined;

    if (limits) {
      if (limits.hourly_issue_limit !== null && limits.hourly_issued >= limits.hourly_issue_limit) {
        return {
          allowed: false,
          errorCode: "ACCOUNT_QUOTA_EXCEEDED",
          errorMessage: `Hourly issue limit (${limits.hourly_issue_limit}) reached for account '${accountId}'`,
          accountId,
        };
      }
      if (limits.daily_issue_limit !== null && limits.daily_issued >= limits.daily_issue_limit) {
        return {
          allowed: false,
          errorCode: "ACCOUNT_QUOTA_EXCEEDED",
          errorMessage: `Daily issue limit (${limits.daily_issue_limit}) reached for account '${accountId}'`,
          accountId,
        };
      }
      if (limits.max_active_keys !== null) {
        const { activeCount } = (await db
          .prepare(
            "SELECT COUNT(*) as activeCount FROM registered_keys WHERE account_id = ? AND is_active = 1"
          )
          .get(accountId)) as { activeCount: number };
        if (activeCount >= limits.max_active_keys) {
          return {
            allowed: false,
            errorCode: "MAX_ACTIVE_KEYS_EXCEEDED",
            errorMessage: `Max active keys (${limits.max_active_keys}) reached for account '${accountId}'`,
            accountId,
            accountActiveKeys: activeCount,
          };
        }
      }
    }
  }

  return { allowed: true };
}

/**
 * Issue a new registered key.
 * Returns the key with rawKey (only on creation) or null if idempotency_key already exists.
 */

export async function issueRegisteredKey(
  params: IssueKeyParams
): Promise<RegisteredKeyWithSecret | { idempotencyConflict: true; existing: RegisteredKey }> {
  const db = await getAsyncDb();
  const {
    name,
    provider = "",
    accountId = "",
    idempotencyKey,
    expiresAt,
    dailyBudget,
    hourlyBudget,
  } = params;

  // ── idempotency check ──
  if (idempotencyKey) {
    const existing = (await db
      .prepare("SELECT * FROM registered_keys WHERE idempotency_key = ?")
      .get(idempotencyKey)) as RegisteredKeyRow | undefined;
    if (existing) {
      return {
        idempotencyConflict: true,
        existing: rowToCamel(existing) as unknown as RegisteredKey,
      };
    }
  }

  const rawKey = generateRawKey();
  const id = uuidv4();
  const keyHash = await hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12); // "ork_" + 8 chars

  await db
    .prepare(
      `
    INSERT INTO registered_keys
      (id, key, key_prefix, name, provider, account_id, idempotency_key, expires_at, daily_budget, hourly_budget, last_reset_day, last_reset_hour)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      id,
      keyHash,
      keyPrefix,
      name,
      provider,
      accountId,
      idempotencyKey ?? null,
      expiresAt ?? null,
      dailyBudget ?? null,
      hourlyBudget ?? null,
      nowDay(),
      nowHour()
    );

  // Increment provider/account issuance counters
  if (provider) {
    maybeResetWindow(db, "provider_key_limits", "provider", provider);
    await db
      .prepare(
        `
      INSERT INTO provider_key_limits (provider, daily_issued, hourly_issued, last_reset_day, last_reset_hour)
      VALUES (?, 1, 1, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        daily_issued = daily_issued + 1,
        hourly_issued = hourly_issued + 1,
        updated_at = datetime('now')
    `
      )
      .run(provider, nowDay(), nowHour());
  }
  if (accountId) {
    maybeResetWindow(db, "account_key_limits", "account_id", accountId);
    await db
      .prepare(
        `
      INSERT INTO account_key_limits (account_id, daily_issued, hourly_issued, last_reset_day, last_reset_hour)
      VALUES (?, 1, 1, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        daily_issued = daily_issued + 1,
        hourly_issued = hourly_issued + 1,
        updated_at = datetime('now')
    `
      )
      .run(accountId, nowDay(), nowHour());
  }

  const created = (await db
    .prepare("SELECT * FROM registered_keys WHERE id = ?")
    .get(id)) as RegisteredKeyRow;
  return { ...(rowToCamel(created) as unknown as RegisteredKey), rawKey };
}

/**
 * Get a registered key by ID (without the raw key — only prefix is returned).
 */

export async function revokeRegisteredKey(id: string): Promise<boolean> {
  const db = await getAsyncDb();
  const result = await db
    .prepare(
      `
    UPDATE registered_keys
    SET is_active = 0, revoked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND is_active = 1
  `
    )
    .run(id);
  return result.changes > 0;
}

/**
 * Validate a raw registered key against stored hashes.
 * Returns the key metadata if valid, null otherwise.
 */

export async function validateRegisteredKey(rawKey: string): Promise<RegisteredKey | null> {
  const db = await getAsyncDb();
  const hash = await hashKey(rawKey);
  const row = (await db
    .prepare(
      `
    SELECT * FROM registered_keys
    WHERE key = ? AND is_active = 1
      AND (expires_at IS NULL OR expires_at > ?)
  `
    )
    .get(hash, Date.now())) as RegisteredKeyRow | undefined;
  if (!row) return null;

  // Auto-reset budget windows if needed
  const today = nowDay();
  const hour = nowHour();
  if (row.last_reset_day !== today || row.last_reset_hour !== hour) {
    await db
      .prepare(
        `
      UPDATE registered_keys
      SET daily_used = CASE WHEN last_reset_day <> ? THEN 0 ELSE daily_used END,
          hourly_used = CASE WHEN last_reset_hour <> ? THEN 0 ELSE hourly_used END,
          last_reset_day = ?, last_reset_hour = ?
      WHERE id = ?
    `
      )
      .run(today, hour, today, hour, row.id);
  }

  // Budget check
  if (row.daily_budget !== null && row.daily_used >= row.daily_budget) return null;
  if (row.hourly_budget !== null && row.hourly_used >= row.hourly_budget) return null;

  return rowToCamel(row) as unknown as RegisteredKey;
}

/**
 * Increment usage counters for a registered key (called by request pipeline).
 */

export async function incrementRegisteredKeyUsage(id: string): Promise<void> {
  const db = await getAsyncDb();
  await db
    .prepare(
      `
    UPDATE registered_keys
    SET daily_used = daily_used + 1, hourly_used = hourly_used + 1, updated_at = datetime('now')
    WHERE id = ?
  `
    )
    .run(id);
}

// ─── Provider / Account Limit Management ──────────────────────────────────────

export async function setProviderKeyLimit(
  provider: string,
  limits: Partial<Omit<ProviderKeyLimit, "provider" | "dailyIssued" | "hourlyIssued" | "updatedAt">>
): Promise<void> {
  const db = await getAsyncDb();
  await db
    .prepare(
      `
    INSERT INTO provider_key_limits (provider, max_active_keys, daily_issue_limit, hourly_issue_limit, last_reset_day, last_reset_hour)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      max_active_keys = excluded.max_active_keys,
      daily_issue_limit = excluded.daily_issue_limit,
      hourly_issue_limit = excluded.hourly_issue_limit,
      updated_at = datetime('now')
  `
    )
    .run(
      provider,
      limits.maxActiveKeys ?? null,
      limits.dailyIssueLimit ?? null,
      limits.hourlyIssueLimit ?? null,
      nowDay(),
      nowHour()
    );
}

export async function setAccountKeyLimit(
  accountId: string,
  limits: Partial<Omit<AccountKeyLimit, "accountId" | "dailyIssued" | "hourlyIssued" | "updatedAt">>
): Promise<void> {
  const db = await getAsyncDb();
  await db
    .prepare(
      `
    INSERT INTO account_key_limits (account_id, max_active_keys, daily_issue_limit, hourly_issue_limit, last_reset_day, last_reset_hour)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      max_active_keys = excluded.max_active_keys,
      daily_issue_limit = excluded.daily_issue_limit,
      hourly_issue_limit = excluded.hourly_issue_limit,
      updated_at = datetime('now')
  `
    )
    .run(
      accountId,
      limits.maxActiveKeys ?? null,
      limits.dailyIssueLimit ?? null,
      limits.hourlyIssueLimit ?? null,
      nowDay(),
      nowHour()
    );
}

export async function getProviderKeyLimit(provider: string): Promise<ProviderKeyLimit | null> {
  const db = await getAsyncDb();
  const row = (await db
    .prepare("SELECT * FROM provider_key_limits WHERE provider = ?")
    .get(provider)) as ProviderKeyLimitRow | undefined;
  return row ? (rowToCamel(row) as unknown as ProviderKeyLimit) : null;
}

export async function getAccountKeyLimit(accountId: string): Promise<AccountKeyLimit | null> {
  const db = await getAsyncDb();
  const row = (await db
    .prepare("SELECT * FROM account_key_limits WHERE account_id = ?")
    .get(accountId)) as AccountKeyLimitRow | undefined;
  return row ? (rowToCamel(row) as unknown as AccountKeyLimit) : null;
}

// ─── Internal types (raw DB rows) ─────────────────────────────────────────────

interface ProviderKeyLimitRow {
  provider: string;
  max_active_keys: number | null;
  daily_issue_limit: number | null;
  hourly_issue_limit: number | null;
  daily_issued: number;
  hourly_issued: number;
  last_reset_day: string;
  last_reset_hour: string;
  updated_at: string;
}

interface AccountKeyLimitRow {
  account_id: string;
  max_active_keys: number | null;
  daily_issue_limit: number | null;
  hourly_issue_limit: number | null;
  daily_issued: number;
  hourly_issued: number;
  last_reset_day: string;
  last_reset_hour: string;
  updated_at: string;
}
