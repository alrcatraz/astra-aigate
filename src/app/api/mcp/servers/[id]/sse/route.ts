/**
 * MCP SSE Transport — /api/mcp/servers/[id]/sse
 *
 * Per-registry-endpoint SSE route (gateway mode). Resolves [id] against the
 * mcp_servers registry, then serves the endpoint through the transport
 * layer (builtin tool domains locally, stdio/http via the bridge).
 *
 * Endpoints:
 *   GET    — open SSE stream for bidirectional communication
 *   POST   — send JSON-RPC messages to the MCP server
 */

import { NextRequest } from "next/server";
import { handleMcpSSE } from "../../../../../../../open-sse/mcp-server/httpTransport";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { hasMcpApiKeyAuth, resolveMcpEndpoint } from "@/lib/api/mcpEndpoint";

export const dynamic = "force-dynamic";

async function bridge(request: NextRequest, id: string): Promise<Response> {
  // Dual channel (Phase 3.6b): admin session OR API key. API-key requests skip
  // the session gate — httpTransport validates the key + endpoint scope
  // downstream (resolveMcpCallerAuthInfo + checkEndpointScopeAccess).
  if (!hasMcpApiKeyAuth(request)) {
    const authError = await requireManagementAuth(request);
    if (authError) return authError;
  }
  const resolved = await resolveMcpEndpoint(id);
  if (resolved.ok === false) return resolved.response;
  return handleMcpSSE(request, id);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return bridge(request, id);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return bridge(request, id);
}
