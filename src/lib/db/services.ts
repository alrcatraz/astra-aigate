/**
 * Database module: Services (Phase 3.8 Services Monitor registry)
 * CRUD operations for the services + health_logs tables. One row per
 * auxiliary (non-MCP) service hosted behind the AI Gate gateway.
 *
 * Conventions:
 * - services are user-added via the panel; no preset rows are shipped
 * - `last_status` reflects the most recent health probe (up | down | unknown)
 * - probe history is bounded: the probe route prunes old health_logs rows
 */

import { getDbInstance } from "./core";
import crypto from "crypto";
import { encrypt, decrypt } from "./encryption";

export type ServiceType = "web" | "http";
export type ServiceSource = "manual" | "marketplace";
export type ServiceStatus = "up" | "down" | "unknown";
export type ServiceAuthType = "none" | "bearer" | "header";

export interface Service {
  id: string;
  name: string;
  type: ServiceType;
  url: string;
  health_endpoint: string | null;
  enabled: boolean;
  system: boolean;
  source: ServiceSource;
  last_status: ServiceStatus;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  /** 1 = proxied through the AI Gate gateway (/api/svc/[id]/...). */
  proxied: boolean;
  /** Gateway-container-internal forward target (e.g. http://127.0.0.1:9377). */
  upstream: string | null;
  /** API-key scope required to call the gateway path (e.g. svc:camofox). */
  required_scope: string | null;
  /** Downstream auth header shape (bearer | header | none). */
  auth_type: ServiceAuthType;
  /** Decrypted downstream credential (null when none / undecryptable). */
  auth_secret: string | null;
}

export interface HealthLogEntry {
  id: number;
  service_id: string;
  status: ServiceStatus;
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
}

interface ServiceRow {
  id: string;
  name: string;
  type: string;
  url: string;
  health_endpoint: string | null;
  enabled: number;
  system: number;
  source: string;
  last_status: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  proxied: number;
  upstream: string | null;
  required_scope: string | null;
  auth_type: string;
  auth_secret: string | null;
}

function rowToService(row: ServiceRow): Service {
  return {
    ...row,
    type: (row.type as ServiceType) || "web",
    source: (row.source as ServiceSource) || "manual",
    last_status: (row.last_status as ServiceStatus) || "unknown",
    enabled: row.enabled === 1,
    system: row.system === 1,
    proxied: row.proxied === 1,
    auth_type: (row.auth_type as ServiceAuthType) || "none",
    auth_secret: decrypt(row.auth_secret) ?? null,
  };
}

export interface ServiceInput {
  id?: string;
  name: string;
  type?: ServiceType;
  url: string;
  health_endpoint?: string | null;
  enabled?: boolean;
  system?: boolean;
  source?: ServiceSource;
  proxied?: boolean;
  upstream?: string | null;
  required_scope?: string | null;
  auth_type?: ServiceAuthType;
  /** Plaintext downstream credential — encrypted at rest on write. */
  auth_secret?: string | null;
}

/** Generate a stable id from a slug (lowercase, hyphens). */
export function slugifyServiceId(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `service-${crypto.randomBytes(4).toString("hex")}`
  );
}

export async function listServices(options?: { includeDisabled?: boolean }): Promise<Service[]> {
  const db = getDbInstance();
  const where = options?.includeDisabled ? "" : "WHERE enabled = 1";
  const rows = (await db
    .prepare(`SELECT * FROM services ${where} ORDER BY system DESC, created_at ASC`)
    .all()) as ServiceRow[];
  return rows.map(rowToService);
}

export async function getService(id: string): Promise<Service | null> {
  const db = getDbInstance();
  const row = (await db.prepare("SELECT * FROM services WHERE id = ?").get(id)) as
    ServiceRow | undefined;
  return row ? rowToService(row) : null;
}

export async function createService(input: ServiceInput): Promise<Service> {
  const db = getDbInstance();
  const id = input.id ?? slugifyServiceId(input.name);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO services
        (id, name, type, url, health_endpoint, enabled, system, source,
         last_status, created_at, updated_at, proxied, upstream,
         required_scope, auth_type, auth_secret)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.type ?? "web",
      input.url,
      input.health_endpoint ?? null,
      input.enabled === false ? 0 : 1,
      input.system === true ? 1 : 0,
      input.source ?? "manual",
      now,
      now,
      input.proxied === true ? 1 : 0,
      input.upstream ?? null,
      input.required_scope ?? null,
      input.auth_type ?? "none",
      encrypt(input.auth_secret ?? null) ?? null
    );
  const created = await getService(id);
  if (!created) throw new Error(`services insert failed for id ${id}`);
  return created;
}

export async function updateService(
  id: string,
  patch: Partial<ServiceInput>
): Promise<Service | null> {
  const db = getDbInstance();
  const existing = await getService(id);
  if (!existing) return null;
  // Raw ciphertext for untouched credentials — keeps the stored value stable
  // across unrelated PATCHes (avoids re-encrypting a decrypt that may fail
  // after a key rotation, which would wipe the credential).
  const rawRow = (await db.prepare("SELECT auth_secret FROM services WHERE id = ?").get(id)) as
    { auth_secret: string | null } | undefined;
  const next: ServiceInput = {
    name: patch.name ?? existing.name,
    type: patch.type ?? existing.type,
    url: patch.url ?? existing.url,
    health_endpoint:
      patch.health_endpoint !== undefined ? patch.health_endpoint : existing.health_endpoint,
    enabled: patch.enabled ?? existing.enabled,
    source: patch.source ?? existing.source,
    proxied: patch.proxied ?? existing.proxied,
    upstream: patch.upstream !== undefined ? patch.upstream : existing.upstream,
    required_scope:
      patch.required_scope !== undefined ? patch.required_scope : existing.required_scope,
    auth_type: patch.auth_type ?? existing.auth_type,
  };
  const authSecretOut =
    patch.auth_secret !== undefined
      ? (encrypt(patch.auth_secret ?? null) ?? null)
      : (rawRow?.auth_secret ?? null);
  await db
    .prepare(
      `UPDATE services
         SET name = ?, type = ?, url = ?, health_endpoint = ?, enabled = ?,
             source = ?, proxied = ?, upstream = ?, required_scope = ?,
             auth_type = ?, auth_secret = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.name,
      next.type,
      next.url,
      next.health_endpoint,
      next.enabled ? 1 : 0,
      next.source,
      next.proxied ? 1 : 0,
      next.upstream,
      next.required_scope,
      next.auth_type,
      authSecretOut,
      new Date().toISOString(),
      id
    );
  return getService(id);
}

export async function deleteService(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDbInstance();
  const existing = await getService(id);
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.system) return { ok: false, error: "system_protected" };
  await db.prepare("DELETE FROM services WHERE id = ?").run(id);
  await db.prepare("DELETE FROM health_logs WHERE service_id = ?").run(id);
  return { ok: true };
}

/** Record a probe result and update the service's last_status. */
export async function recordProbe(
  id: string,
  status: ServiceStatus,
  latencyMs: number | null,
  error: string | null
): Promise<void> {
  const db = getDbInstance();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO health_logs (service_id, status, latency_ms, error, checked_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, status, latencyMs, error, now);
  await db
    .prepare(
      `UPDATE services SET last_status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(status, now, now, id);
  // Keep history bounded (latest 100 rows per service).
  await db
    .prepare(
      `DELETE FROM health_logs WHERE service_id = ? AND id NOT IN (
         SELECT id FROM health_logs WHERE service_id = ? ORDER BY checked_at DESC LIMIT 100
       )`
    )
    .run(id, id);
}

/** Most recent health log entries (per service, newest first). */
export async function listHealthLogs(serviceId: string, limit = 20): Promise<HealthLogEntry[]> {
  const db = getDbInstance();
  return (await db
    .prepare(`SELECT * FROM health_logs WHERE service_id = ? ORDER BY checked_at DESC LIMIT ?`)
    .all(serviceId, limit)) as unknown as HealthLogEntry[];
}

/** Resolve the full health-check URL for a service (base + health_endpoint). */
export function resolveHealthUrl(service: Service): string {
  const base = service.url.replace(/\/+$/, "");
  const endpoint = service.health_endpoint
    ? `/${service.health_endpoint.replace(/^\/+/, "")}`
    : "/";
  return `${base}${endpoint}`;
}
