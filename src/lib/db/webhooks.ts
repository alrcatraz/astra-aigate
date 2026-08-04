/**
 * Database module: Webhooks
 * CRUD operations for webhook event subscriptions
 */

import { getDbInstance } from "./core";
import crypto from "crypto";

export type WebhookKind = "slack" | "telegram" | "discord" | "custom";

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  enabled: boolean;
  description: string;
  created_at: string;
  last_triggered_at: string | null;
  last_status: number | null;
  failure_count: number;
  kind: WebhookKind;
  metadata_encrypted: string | null;
}

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  enabled: number;
  description: string;
  created_at: string;
  last_triggered_at: string | null;
  last_status: number | null;
  failure_count: number;
  kind: string;
  metadata_encrypted: string | null;
}

function rowToWebhook(row: WebhookRow): Webhook {
  return {
    ...row,
    kind: (row.kind as WebhookKind) || "custom",
    events: JSON.parse(row.events || '["*"]'),
    enabled: row.enabled === 1,
  };
}

interface CountResult {
  cnt: number;
}

export async function getWebhooks(options?: { limit?: number; offset?: number }): Promise<{
  webhooks: Webhook[];
  total: number;
}> {
  const db = getDbInstance();
  const limit = options?.limit;
  const offset = options?.offset ?? 0;
  let sql = "SELECT * FROM webhooks ORDER BY created_at DESC";
  const params: unknown[] = [];
  if (limit !== undefined) {
    sql += " LIMIT ? OFFSET ?";
    params.push(limit, offset);
  }
  const rows = (await db.prepare(sql).all(...params)) as WebhookRow[];
  const total = ((await db.prepare("SELECT count(*) as cnt FROM webhooks").get()) as CountResult)
    .cnt;
  return { webhooks: rows.map(rowToWebhook), total };
}

export async function getWebhook(id: string): Promise<Webhook | null> {
  const db = getDbInstance();
  const row = (await db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id)) as
    WebhookRow | undefined;
  return row ? rowToWebhook(row) : null;
}

export async function getEnabledWebhooks(): Promise<Webhook[]> {
  const db = getDbInstance();
  const rows = (await db.prepare("SELECT * FROM webhooks WHERE enabled = 1").all()) as WebhookRow[];
  return rows.map(rowToWebhook);
}

export async function createWebhook(data: {
  url: string;
  events?: string[];
  secret?: string;
  description?: string;
  kind?: WebhookKind;
  metadataEncrypted?: string | null;
}): Promise<Webhook> {
  const db = getDbInstance();
  const id = crypto.randomUUID();
  const secret = data.secret || `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const kind = data.kind || "custom";

  await db
    .prepare(
      `INSERT INTO webhooks (id, url, events, secret, description, kind, metadata_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.url,
      JSON.stringify(data.events || ["*"]),
      secret,
      data.description || "",
      kind,
      data.metadataEncrypted ?? null
    );

  return (await getWebhook(id))!;
}

export async function updateWebhook(
  id: string,
  data: Partial<{
    url: string;
    events: string[];
    secret: string;
    enabled: boolean;
    description: string;
    kind: WebhookKind;
    metadataEncrypted: string | null;
  }>
): Promise<Webhook | null> {
  const db = getDbInstance();
  const existing = await getWebhook(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (data.url !== undefined) {
    fields.push("url = ?");
    values.push(data.url);
  }
  if (data.events !== undefined) {
    fields.push("events = ?");
    values.push(JSON.stringify(data.events));
  }
  if (data.secret !== undefined) {
    fields.push("secret = ?");
    values.push(data.secret);
  }
  if (data.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(data.enabled ? 1 : 0);
  }
  if (data.description !== undefined) {
    fields.push("description = ?");
    values.push(data.description);
  }
  if (data.kind !== undefined) {
    fields.push("kind = ?");
    values.push(data.kind);
  }
  if (data.metadataEncrypted !== undefined) {
    fields.push("metadata_encrypted = ?");
    values.push(data.metadataEncrypted);
  }

  if (fields.length === 0) return existing;

  values.push(id);
  await db.prepare(`UPDATE webhooks SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  return await getWebhook(id);
}

export async function deleteWebhook(id: string): Promise<boolean> {
  const db = getDbInstance();
  const result = await db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
  return (result as any).changes > 0;
}

export async function recordWebhookDelivery(
  id: string,
  status: number,
  success: boolean
): Promise<void> {
  const db = getDbInstance();
  if (success) {
    await db
      .prepare(
        `UPDATE webhooks SET last_triggered_at = datetime('now'), last_status = ?, failure_count = 0 WHERE id = ?`
      )
      .run(status, id);
  } else {
    await db
      .prepare(
        `UPDATE webhooks SET last_triggered_at = datetime('now'), last_status = ?, failure_count = failure_count + 1 WHERE id = ?`
      )
      .run(status, id);
  }
}

export async function disableWebhooksWithHighFailures(threshold = 10): Promise<number> {
  const db = getDbInstance();
  const result = await db
    .prepare(`UPDATE webhooks SET enabled = 0 WHERE failure_count >= ? AND enabled = 1`)
    .run(threshold);
  return (result as any).changes;
}
