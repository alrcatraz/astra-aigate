/**
 * Shared endpoint resolution for the service gateway dynamic route
 * (/api/svc/[id]/[...path]).
 *
 * Phase 3.8 B 方案 (2026-08-05 定稿): auxiliary services registered in the
 * `services` table with `proxied=1` are exposed behind the AI Gate unified
 * endpoint. This module mirrors the MCP gateway's `mcpEndpoint.ts`:
 *   - resolveServiceEndpoint: 404 unknown, 503 disabled / not proxied
 *   - checkServiceScopeAccess: non-null `required_scope` only accepts callers
 *     whose API-key scopes (or the OMNIROUTE_MCP_SCOPES env fallback) match —
 *     exact, `*`, or `prefix*` per scopeMatches()
 *   - dual-channel auth (admin session OR API key) lives in the route file,
 *     identical to the MCP stream/sse routes
 */
import { NextResponse } from "next/server";

import { getService, type Service } from "@/lib/db/services";
import { resolveMcpCallerAuthInfo } from "@omniroute/open-sse/mcp-server/httpAuthContext";
import {
  requestPresentsApiKey,
  scopeMatches,
} from "@omniroute/open-sse/mcp-server/scopeEnforcement";
import { hasMcpApiKeyAuth } from "./mcpEndpoint";

export type ServiceEndpointResolution =
  { ok: true; service: Service } | { ok: false; response: NextResponse };

export async function resolveServiceEndpoint(id: string): Promise<ServiceEndpointResolution> {
  const service = await getService(id);
  if (!service) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Service not found: ${id}` }, { status: 404 }),
    };
  }
  if (!service.enabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Service is disabled: ${id}. Enable it from the Services page.` },
        { status: 503 }
      ),
    };
  }
  if (!service.proxied) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Service is not proxied through the gateway: ${id}. Enable proxying from the Services page.`,
        },
        { status: 503 }
      ),
    };
  }
  return { ok: true, service };
}

/**
 * Endpoint-level scope gate — mirrors `checkEndpointScopeAccess` (MCP) for
 * services. A row with a non-null `required_scope` (e.g. svc:camofox) only
 * accepts callers whose API-key scopes (or the OMNIROUTE_MCP_SCOPES env
 * fallback) match. Rows without a required_scope are open at the endpoint
 * layer.
 */
export async function checkServiceScopeAccess(
  service: Service,
  request: Request
): Promise<Response | null> {
  if (!service.required_scope) return null;

  const authInfo = await resolveMcpCallerAuthInfo(request);

  // B2: a presented-but-invalid key must not silently gain the env fallback.
  if (!authInfo && requestPresentsApiKey(request)) {
    return NextResponse.json(
      { error: `Invalid API key for service ${service.id}` },
      { status: 401 }
    );
  }

  const envScopes = (process.env.OMNIROUTE_MCP_SCOPES || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const callerScopes = authInfo?.scopes ?? envScopes;

  if (callerScopes.some((granted) => scopeMatches(granted, service.required_scope!))) {
    return null;
  }

  return NextResponse.json(
    { error: `Insufficient scopes for service ${service.id}: required ${service.required_scope}` },
    { status: 403 }
  );
}

export { hasMcpApiKeyAuth as hasServiceApiKeyAuth };
