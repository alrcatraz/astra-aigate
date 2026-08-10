/**
 * liveServerAllowList — extract of the host/origin allow-list logic from
 * `src/server/ws/liveServer.ts`.
 *
 * Lives in its own module so unit tests can exercise it without booting the
 * full WebSocket server. The behaviour here MUST match the one used by the
 * connection handler exactly.
 *
 * Bug #1 (plans/2026-06-23-omniroute-v3.8.34-deep-audit.md) added the
 * `LIVE_WS_ALLOWED_HOSTS` opt-in for LAN/Tailscale deployments.
 */

import { DEFAULT_OMNIROUTE_BASE_URL } from "@/shared/utils/resolveOmniRouteBaseUrl";
import { classifyHostLocality } from "@/server/authz/routeGuard";

const DEFAULT_HOST = "127.0.0.1";

// Derived from the router default so the loopback origins never drift from
// the actual listener port (127.0.0.1 / localhost / [::1] are distinct host
// strings, so all three stay listed on purpose).
const OMNIROUTE_DEFAULT_PORT = new URL(DEFAULT_OMNIROUTE_BASE_URL).port;

/**
 * Default origins allowed to open a WebSocket against the local dashboard.
 * These match the loopback HTTP listener at port 20128.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  `http://${DEFAULT_HOST}:${OMNIROUTE_DEFAULT_PORT}`,
  `http://localhost:${OMNIROUTE_DEFAULT_PORT}`,
  `http://[::1]:${OMNIROUTE_DEFAULT_PORT}`,
]);

/**
 * Parse a comma-separated env value into a set of trimmed, non-empty entries.
 * Centralized so tests can exercise empty / whitespace / dup behaviour.
 */
export function parseCsvEnv(value: string | undefined | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Build the static origin allow-list from defaults + LIVE_WS_ALLOWED_ORIGINS.
 */
export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const extra = parseCsvEnv(env.LIVE_WS_ALLOWED_ORIGINS);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

/**
 * Build the host-based allow-list (LAN/Tailscale extension).
 */
export function buildAllowedHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return parseCsvEnv(env.LIVE_WS_ALLOWED_HOSTS);
}

/**
 * Parse the host portion of an Origin URL.
 *
 * Returns `null` when the input is not a well-formed absolute URL — callers
 * should treat `null` as "not a match".
 */
export function originHost(origin: string): { host: string; hostname: string } | null {
  try {
    const url = new URL(origin);
    return { host: url.host, hostname: url.hostname };
  } catch {
    return null;
  }
}

/**
 * Whether the given Origin's host (or `host:port`) is in the host
 * allow-list. Returns false when the list is empty.
 */
export function originHostMatches(origin: string, allowedHosts: Set<string>): boolean {
  if (allowedHosts.size === 0) return false;
  const parsed = originHost(origin);
  if (!parsed) return false;
  return allowedHosts.has(parsed.host) || allowedHosts.has(parsed.hostname);
}

/**
 * Top-level Origin allow decision. The contract:
 *
 *   - When `origin` is undefined (no Origin header, e.g. CLI/MCP), we only
 *     accept the request when the WS listener is bound to loopback. This
 *     prevents drive-by LAN clients from omitting Origin to bypass the
 *     browser-side check.
 *
 *   - When `origin` is present, we accept it if it matches an entry in the
 *     static origin list (defaults + LIVE_WS_ALLOWED_ORIGINS) or if its
 *     host matches an entry in the LAN allow-list (LIVE_WS_ALLOWED_HOSTS).
 */
export function isOriginAllowed(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options: {
    allowedOrigins?: Set<string>;
    allowedHosts?: Set<string>;
    acceptLocalHosts?: boolean;
  } = {}
): boolean {
  const allowedOrigins = options.allowedOrigins ?? buildAllowedOrigins(env);
  const allowedHosts = options.allowedHosts ?? buildAllowedHosts(env);

  if (!origin) {
    const host = env.LIVE_WS_HOST || DEFAULT_HOST;
    return host === "127.0.0.1" || host === "::1" || host === "localhost";
  }
  if (allowedOrigins.has(origin)) return true;
  if (originHostMatches(origin, allowedHosts)) return true;
  // LAN exposure: when the listener is bound to 0.0.0.0, accept any origin
  // whose host is a loopback/private-LAN literal (e.g. http://192.168.0.200:20128).
  // No hard-coded host list — locality is derived from RFC1918/ULA patterns, so
  // the operator never has to enumerate their LAN addresses. Remote/public
  // origins (or domain-based Host, which may be DNS-rebound) still require an
  // explicit entry in LIVE_WS_ALLOWED_ORIGINS/HOSTS.
  if (options.acceptLocalHosts && origin) {
    const parsed = originHost(origin);
    if (parsed && classifyHostLocality(parsed.hostname) !== "remote") return true;
  }
  return false;
}
