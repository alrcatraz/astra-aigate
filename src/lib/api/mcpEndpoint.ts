/**
 * Shared endpoint resolution for the MCP gateway dynamic routes
 * (/api/mcp/servers/[id]/{sse,stream}).
 *
 * Resolves a registry id to a usable server row: 404 when the id is
 * unknown, 503 when the registry entry or the global MCP switch is
 * disabled. The transport handlers themselves are dispatched by the
 * route files (bridge layer, Phase 3.4).
 */
import { NextResponse } from "next/server";

import { getCachedSettings } from "@/lib/db/settings";
import { getMcpServer, type McpServer } from "@/lib/db/mcpServers";

/**
 * True when the request carries an MCP API-key credential (Bearer token or
 * x-api-key header). The endpoint routes use this to bypass the admin-session
 * gate: API keys are validated downstream by httpTransport's
 * resolveMcpCallerAuthInfo + checkEndpointScopeAccess (Phase 3.6b — endpoints
 * accept EITHER an admin session OR an API key, never both gates stacked).
 */
export function hasMcpApiKeyAuth(request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (auth) {
    const trimmed = auth.trim();
    if (/^bearer\s+\S+$/i.test(trimmed)) return true;
  }
  const apiKey = request.headers.get("x-api-key");
  return apiKey !== null && apiKey.trim().length > 0;
}

export type McpEndpointResolution =
  { ok: true; server: McpServer } | { ok: false; response: NextResponse };

export async function resolveMcpEndpoint(id: string): Promise<McpEndpointResolution> {
  const server = await getMcpServer(id);
  if (!server) {
    return {
      ok: false,
      response: NextResponse.json({ error: `MCP server not found: ${id}` }, { status: 404 }),
    };
  }

  if (!server.enabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `MCP server is disabled: ${id}. Enable it from the MCP Servers page.` },
        { status: 503 }
      ),
    };
  }

  const settings = await getCachedSettings();
  if (!settings.mcpEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "MCP server is disabled. Enable it from the Endpoints page." },
        { status: 503 }
      ),
    };
  }

  return { ok: true, server };
}
