/**
 * API: MCP Server by id (Phase 3)
 * GET    — Fetch one registered MCP endpoint
 * PATCH  — Update fields (name, kind, command/args, url, auth, enabled, scope)
 * DELETE — Remove a custom registration (system presets refuse to delete)
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { getMcpServer, updateMcpServer, deleteMcpServer } from "@/lib/localDb";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

const KINDS = ["builtin", "stdio", "http"] as const;
const AUTH_TYPES = ["none", "bearer", "header"] as const;

const patchMcpServerSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  group_id: z.string().min(1).max(60).optional(),
  kind: z.enum(KINDS).optional(),
  command: z.string().max(500).nullable().optional(),
  args: z.string().max(1000).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  auth_type: z.enum(AUTH_TYPES).optional(),
  auth_secret: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  required_scope: z.string().max(120).nullable().optional(),
});

function maskSecret(server: { auth_secret: string | null }): { auth_secret: string | null } {
  return {
    ...server,
    auth_secret: server.auth_secret ? `${server.auth_secret.slice(0, 4)}…` : null,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const server = await getMcpServer(id);
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    return NextResponse.json({ server: maskSecret(server) });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validation = validateBody(patchMcpServerSchema, rawBody);
  if (isValidationFailure(validation)) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const { id } = await params;
    const server = await updateMcpServer(id, validation.data);
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    return NextResponse.json({ server: maskSecret(server) });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const server = await getMcpServer(id);
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    if (server.system) {
      return NextResponse.json(
        { error: `System MCP server "${id}" cannot be deleted — disable it instead.` },
        { status: 409 }
      );
    }
    await deleteMcpServer(id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
