/**
 * API: MCP Servers registry (Phase 3)
 * GET  — List registered MCP endpoints (admin view: includes disabled)
 * POST — Register a new MCP endpoint (custom)
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { listMcpServers, createMcpServer } from "@/lib/localDb";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

const KINDS = ["builtin", "stdio", "http"] as const;
const AUTH_TYPES = ["none", "bearer", "header"] as const;
const SOURCES = ["manual", "marketplace"] as const;

const createMcpServerSchema = z.object({
  name: z.string().min(1).max(120),
  group_id: z.string().min(1).max(60).optional(),
  kind: z.enum(KINDS),
  command: z.string().max(500).optional(),
  args: z.string().max(1000).optional(),
  url: z.string().max(2000).optional(),
  auth_type: z.enum(AUTH_TYPES).optional(),
  auth_secret: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  required_scope: z.string().max(120).optional(),
});

function maskSecret(server: { auth_secret: string | null }): { auth_secret: string | null } {
  return {
    ...server,
    auth_secret: server.auth_secret ? `${server.auth_secret.slice(0, 4)}…` : null,
  };
}

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get("groupId") ?? undefined;
    const servers = await listMcpServers({ includeDisabled: true, groupId });
    return NextResponse.json({ servers: servers.map(maskSecret) });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validation = validateBody(createMcpServerSchema, rawBody);
  if (isValidationFailure(validation)) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const server = await createMcpServer({
      name: data.name,
      group_id: data.group_id,
      kind: data.kind,
      command: data.command,
      args: data.args,
      url: data.url,
      auth_type: data.auth_type,
      auth_secret: data.auth_secret,
      enabled: data.enabled,
      required_scope: data.required_scope,
    });
    return NextResponse.json({ server: maskSecret(server) }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
