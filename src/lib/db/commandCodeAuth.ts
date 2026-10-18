import { createHash, randomUUID } from "crypto";

import { rowToCamel, getAsyncDb } from "./core";
import type { DatabaseAdapter } from "./adapters/types";
import { decrypt, encrypt } from "./encryption";

export type CommandCodeAuthStatus = "pending" | "received" | "applied" | "expired";

export interface CommandCodeAuthMetadata {
  userId?: string;
  userName?: string;
  keyName?: string;
  receivedAt?: string;
}

export interface CommandCodeAuthSafeStatus {
  id: string;
  stateHash: string;
  status: CommandCodeAuthStatus;
  metadata: CommandCodeAuthMetadata | null;
  createdAt: string;
  expiresAt: string;
  receivedAt: string | null;
  appliedAt: string | null;
  updatedAt: string;
}

export interface ConsumedCommandCodeAuthSecret extends CommandCodeAuthSafeStatus {
  apiKey: string;
}

type AuthSessionRow = {
  id: string;
  state_hash: string;
  status: CommandCodeAuthStatus;
  encrypted_api_key?: string | null;
  metadata_json?: string | null;
  created_at: string;
  expires_at: string;
  received_at?: string | null;
  applied_at?: string | null;
  updated_at: string;
};

// The async DB adapter (SQLite wrapped in Promises, or PG) — uniform async
// interface. Every statement execution below must be awaited: treating a
// Promise as a row/result silently no-ops the write (session INSERT never
// landed, so the callback could not find its state and returned 400).
function db(): DatabaseAdapter {
  return getAsyncDb();
}

export function hashCommandCodeAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseMetadata(value: unknown): CommandCodeAuthMetadata | null {
  if (!value) return null;
  // rowToCamel auto-parses the `metadata_json` column and exposes the object under
  // `camel.metadata` (already parsed); accept that directly. Fall back to parsing a
  // raw string for any other caller.
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as CommandCodeAuthMetadata;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as CommandCodeAuthMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toSafeStatus(row: AuthSessionRow): CommandCodeAuthSafeStatus {
  const camel = rowToCamel(row) as Record<string, unknown>;
  return {
    id: String(camel.id),
    stateHash: String(camel.stateHash),
    status: camel.status as CommandCodeAuthStatus,
    metadata: parseMetadata(camel.metadata ?? camel.metadataJson),
    createdAt: String(camel.createdAt),
    expiresAt: String(camel.expiresAt),
    receivedAt: (camel.receivedAt as string | null | undefined) ?? null,
    appliedAt: (camel.appliedAt as string | null | undefined) ?? null,
    updatedAt: String(camel.updatedAt),
  };
}

async function markExpiredForState(stateHash: string, now = nowIso()): Promise<void> {
  await db()
    .prepare(
      `UPDATE command_code_auth_sessions
       SET status = 'expired', updated_at = ?
       WHERE state_hash = ? AND status IN ('pending', 'received') AND expires_at <= ?`
    )
    .run(now, stateHash, now);
}

export async function createPendingCommandCodeAuthSession(input: {
  stateHash: string;
  expiresAt: string;
}): Promise<CommandCodeAuthSafeStatus> {
  const id = randomUUID();
  const now = nowIso();
  await db()
    .prepare(
      `INSERT INTO command_code_auth_sessions (
        id, state_hash, status, encrypted_api_key, metadata_json,
        created_at, expires_at, received_at, applied_at, updated_at
      ) VALUES (?, ?, 'pending', NULL, NULL, ?, ?, NULL, NULL, ?)`
    )
    .run(id, input.stateHash, now, input.expiresAt, now);

  const row = (await db()
    .prepare<AuthSessionRow>("SELECT * FROM command_code_auth_sessions WHERE id = ?")
    .get(id)) as AuthSessionRow | undefined;
  if (!row) throw new Error("Failed to create Command Code auth session");
  return toSafeStatus(row);
}

export async function markCommandCodeAuthSessionReceived(input: {
  stateHash: string;
  apiKey: string;
  metadata?: CommandCodeAuthMetadata;
}): Promise<CommandCodeAuthSafeStatus | null> {
  const now = nowIso();
  await markExpiredForState(input.stateHash, now);
  const metadata: CommandCodeAuthMetadata = {
    ...(input.metadata || {}),
    receivedAt: now,
  };
  const encryptedApiKey = encrypt(input.apiKey);
  await db()
    .prepare(
      `UPDATE command_code_auth_sessions
       SET status = 'received', encrypted_api_key = ?, metadata_json = ?, received_at = ?, updated_at = ?
       WHERE state_hash = ? AND status IN ('pending', 'received') AND expires_at > ?`
    )
    .run(encryptedApiKey, JSON.stringify(metadata), now, now, input.stateHash, now);

  return getCommandCodeAuthSessionSafeStatus(input.stateHash);
}

export async function getCommandCodeAuthSessionSafeStatus(
  stateHash: string
): Promise<CommandCodeAuthSafeStatus | null> {
  await markExpiredForState(stateHash);
  const row = (await db()
    .prepare<AuthSessionRow>("SELECT * FROM command_code_auth_sessions WHERE state_hash = ?")
    .get(stateHash)) as AuthSessionRow | undefined;
  return row ? toSafeStatus(row) : null;
}

export async function consumeCommandCodeAuthSecret(
  stateHash: string
): Promise<ConsumedCommandCodeAuthSecret | null> {
  const database = db();
  return database.transaction(async () => {
    const now = nowIso();
    await database
      .prepare(
        `UPDATE command_code_auth_sessions
         SET status = 'expired', updated_at = ?
         WHERE state_hash = ? AND status IN ('pending', 'received') AND expires_at <= ?`
      )
      .run(now, stateHash, now);

    const row = (await database
      .prepare<AuthSessionRow>(
        `SELECT * FROM command_code_auth_sessions
         WHERE state_hash = ? AND status = 'received' AND expires_at > ? AND encrypted_api_key IS NOT NULL`
      )
      .get(stateHash, now)) as AuthSessionRow | undefined;
    if (!row?.encrypted_api_key) return null;

    const apiKey = decrypt(row.encrypted_api_key);
    if (!apiKey) return null;

    const result = await database
      .prepare(
        `UPDATE command_code_auth_sessions
         SET status = 'applied', encrypted_api_key = NULL, applied_at = ?, updated_at = ?
         WHERE id = ? AND status = 'received'`
      )
      .run(now, now, row.id);
    if (!result.changes) return null;

    return {
      ...toSafeStatus({
        ...row,
        status: "applied",
        encrypted_api_key: null,
        applied_at: now,
        updated_at: now,
      }),
      apiKey,
    };
  })();
}
