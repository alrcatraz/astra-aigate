import { getAsyncDb } from "../core";
import type { DatabaseAdapter } from "../adapters/types";

export const PROXY_ALIVE_PREDICATE =
  "(p.status IS NULL OR LOWER(p.status) NOT IN ('inactive','error','disabled','dead','down'))";

/**
 * Read the global `proxyEnabled` toggle from persisted settings.
 *
 * MUST be async: `getAsyncDb()` returns the uniform async `DatabaseAdapter`
 * (the real Postgres adapter in PG mode, an async wrapper over the sync SQLite
 * handle otherwise), and `PreparedStatement.get()` always returns a Promise
 * on that interface. The previous synchronous read (`db.prepare(...).get()`
 * without `await`) observed a Promise object — `row?.value` was always
 * undefined, so this defaulted to `true` even when proxying was explicitly
 * disabled, and downstream guards never short-circuited.
 */
export async function isGlobalProxyEnabled(db: DatabaseAdapter): Promise<boolean> {
  try {
    const row = (await db
      .prepare("SELECT value FROM key_value WHERE namespace = 'settings' AND key = 'proxyEnabled'")
      .get()) as { value?: string } | undefined;
    if (!row?.value) return true;
    try {
      return JSON.parse(row.value) !== false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

/**
 * #6246 fail-closed guard for a connection with an assigned dead proxy pool.
 * Explicitly disabling proxying globally or for the connection allows direct egress.
 *
 * Async for the same reason as `isGlobalProxyEnabled`: the sync `.prepare().get()`
 * consumed the async adapter's Promise synchronously, so `return !!dead` was
 * ALWAYS true (a Promise is truthy) regardless of the actual assignment state —
 * with `proxy_assignments`/`proxy_registry` empty the guard still reported a
 * dead-proxy assignment and drove the request to `PROXY_ASSIGNED_UNAVAILABLE`.
 */
export async function hasBlockingProxyAssignment(
  connectionId: string,
  providerId?: string
): Promise<boolean> {
  try {
    const db = getAsyncDb();
    if (!(await isGlobalProxyEnabled(db))) return false;

    const conn = (await db
      .prepare("SELECT provider, proxy_enabled FROM provider_connections WHERE id = ?")
      .get(connectionId)) as { provider?: string | null; proxy_enabled?: number } | undefined;
    if (conn && conn.proxy_enabled === 0) return false;
    const provider = conn?.provider ?? providerId ?? null;
    const dead = (await db
      .prepare(
        `SELECT 1 FROM proxy_assignments a JOIN proxy_registry p ON p.id = a.proxy_id
           WHERE ((a.scope = 'account' AND a.scope_id = ?)
               OR (a.scope = 'provider' AND a.scope_id = ?)
               OR (a.scope = 'global'))
             AND NOT ${PROXY_ALIVE_PREDICATE}
           LIMIT 1`
      )
      .get(connectionId, provider)) as unknown;
    return !!dead;
  } catch {
    return false;
  }
}

/**
 * #7380 fail-closed guard for providers without a connection row. Returns true
 * when a provider/global proxy assignment exists but all assigned proxies are known dead.
 *
 * Async: see `hasBlockingProxyAssignment`. Previously the sync `.get()` returned
 * a Promise, so `assignments?.assigned === 1` was always false and the guard
 * never failed closed — the inverse of the sibling guard, but equally wrong.
 */
export async function hasBlockingProxyAssignmentForProvider(providerId: string): Promise<boolean> {
  try {
    const db = getAsyncDb();
    if (!(await isGlobalProxyEnabled(db))) return false;

    const assignments = (await db
      .prepare(
        `SELECT
          EXISTS(
            SELECT 1 FROM proxy_assignments a
            WHERE ((a.scope = 'provider' AND a.scope_id = ?)
                OR a.scope = 'global')
          ) AS assigned,
          EXISTS(
            SELECT 1 FROM proxy_assignments a JOIN proxy_registry p ON p.id = a.proxy_id
            WHERE ((a.scope = 'provider' AND a.scope_id = ?)
                OR a.scope = 'global')
              AND ${PROXY_ALIVE_PREDICATE}
          ) AS alive`
      )
      .get(providerId, providerId)) as { assigned?: number; alive?: number } | undefined;
    return assignments?.assigned === 1 && assignments.alive === 0;
  } catch {
    return false;
  }
}
