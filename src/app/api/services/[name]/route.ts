/**
 * API: Service detail (Phase 3.8 Services Monitor)
 * PATCH  — Update a service (toggle enabled, edit url/health_endpoint, ...)
 * DELETE — Remove a custom service (system=1 presets are protected)
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { getService, updateService, deleteService } from "@/lib/localDb";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

const TYPES = ["web", "http"] as const;
const AUTH_TYPES = ["none", "bearer", "header"] as const;

const updateServiceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  type: z.enum(TYPES).optional(),
  url: z.string().min(1).max(2000).optional(),
  health_endpoint: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  proxied: z.boolean().optional(),
  upstream: z.string().max(500).nullable().optional(),
  required_scope: z.string().max(200).nullable().optional(),
  auth_type: z.enum(AUTH_TYPES).optional(),
  auth_secret: z.string().max(2000).nullable().optional(),
});

type RouteContext = { params: Promise<{ name: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const { name } = await context.params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateBody(updateServiceSchema, rawBody);
  if (isValidationFailure(validation)) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const existing = await getService(name);
    if (!existing) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    const service = await updateService(name, data);
    return NextResponse.json({ service });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const { name } = await context.params;
  try {
    const result = await deleteService(name);
    if (!result.ok) {
      const status = result.error === "system_protected" ? 403 : 404;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
