/**
 * API: MCP server connection test (Phase 3.5)
 * POST /api/mcp-servers/[id]/test — force endpoint materialisation and
 * report ready state / bridge status / downstream tool count.
 * Builtin endpoints are always ready (local server).
 */

import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { probeMcpEndpoint } from "../../../../../../open-sse/mcp-server/httpTransport";
import { getMcpServer } from "@/lib/db/mcpServers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const server = await getMcpServer(id);
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    if (!server.enabled) {
      return NextResponse.json(
        { error: "MCP server is disabled — enable it before testing the connection" },
        { status: 409 }
      );
    }
    const probe = await probeMcpEndpoint(id);
    return NextResponse.json({ probe });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
