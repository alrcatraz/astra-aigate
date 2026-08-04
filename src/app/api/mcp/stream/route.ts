/**
 * Legacy MCP Streamable HTTP Transport — /api/mcp/stream (deprecated)
 *
 * Permanent redirect to the gateway endpoint
 * /api/mcp/servers/aigate-omniroute/stream (single source of truth).
 *
 * Status code matters: 301 for GET (SSE stream bootstrap), 308 for POST and
 * DELETE — the fetch spec converts POST→GET on 301/302/303, which would
 * drop the JSON-RPC message body. 308 preserves the method for both.
 */

import { NextRequest, NextResponse } from "next/server";

const TARGET = "/api/mcp/servers/aigate-omniroute/stream";

export async function GET(request: NextRequest) {
  const url = new URL(TARGET, request.url);
  return NextResponse.redirect(url, 301);
}

export async function POST(request: NextRequest) {
  const url = new URL(TARGET, request.url);
  return NextResponse.redirect(url, 308);
}

export async function DELETE(request: NextRequest) {
  const url = new URL(TARGET, request.url);
  return NextResponse.redirect(url, 308);
}
