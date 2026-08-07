import { getAsyncDb } from "./core";

export interface ApiKeyContextSource {
  apiKeyId: string;
  sourceType: string;
  token: string | null;
  baseUrl: string | null;
  vaultPath: string | null;
  enabled: boolean;
}

interface ContextSourceRow {
  api_key_id: string;
  source_type: string;
  token: string | null;
  base_url: string | null;
  vault_path: string | null;
  enabled: number;
}

function rowToSource(row: ContextSourceRow): ApiKeyContextSource {
  return {
    apiKeyId: row.api_key_id,
    sourceType: row.source_type,
    token: row.token,
    baseUrl: row.base_url,
    vaultPath: row.vault_path,
    enabled: row.enabled === 1,
  };
}

export async function getApiKeyContextSource(
  apiKeyId: string | null | undefined,
  sourceType: string
): Promise<(ApiKeyContextSource & { enabled: true }) | null> {
  if (!apiKeyId) return null;
  const db = await getAsyncDb();
  const row = (await db
    .prepare(
      "SELECT * FROM api_key_context_sources WHERE api_key_id = ? AND source_type = ? AND enabled = 1"
    )
    .get(apiKeyId, sourceType)) as ContextSourceRow | undefined;
  if (!row) return null;
  return rowToSource(row) as ApiKeyContextSource & { enabled: true };
}

export async function setApiKeyContextSource(
  apiKeyId: string,
  sourceType: string,
  config: { token?: string; baseUrl?: string; vaultPath?: string; enabled?: boolean }
): Promise<void> {
  const db = await getAsyncDb();
  const existing = (await db
    .prepare("SELECT * FROM api_key_context_sources WHERE api_key_id = ? AND source_type = ?")
    .get(apiKeyId, sourceType)) as ContextSourceRow | undefined;

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE api_key_context_sources SET
        token = COALESCE(?, token),
        base_url = COALESCE(?, base_url),
        vault_path = COALESCE(?, vault_path),
        enabled = COALESCE(?, enabled),
        updated_at = ?
      WHERE api_key_id = ? AND source_type = ?`
    ).run(
      config.token ?? null,
      config.baseUrl ?? null,
      config.vaultPath ?? null,
      config.enabled !== undefined ? (config.enabled ? 1 : 0) : null,
      now,
      apiKeyId,
      sourceType
    );
  } else {
    db.prepare(
      `INSERT INTO api_key_context_sources
        (api_key_id, source_type, token, base_url, vault_path, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      apiKeyId,
      sourceType,
      config.token ?? null,
      config.baseUrl ?? null,
      config.vaultPath ?? null,
      config.enabled !== undefined ? (config.enabled ? 1 : 0) : 1,
      now,
      now
    );
  }
}

export async function deleteApiKeyContextSource(
  apiKeyId: string,
  sourceType: string
): Promise<void> {
  const db = await getAsyncDb();
  await db
    .prepare("DELETE FROM api_key_context_sources WHERE api_key_id = ? AND source_type = ?")
    .run(apiKeyId, sourceType);
}

export async function listApiKeyContextSources(apiKeyId: string): Promise<ApiKeyContextSource[]> {
  const db = await getAsyncDb();
  const rows = (await db
    .prepare("SELECT * FROM api_key_context_sources WHERE api_key_id = ?")
    .all(apiKeyId)) as ContextSourceRow[];
  return rows.map(rowToSource);
}
