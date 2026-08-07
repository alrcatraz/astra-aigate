/**
 * API: Services registry (Phase 3.8 Services Monitor)
 * GET  — List registered services (admin view: includes disabled + last_status)
 * POST — Register a new service
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { listServices, createService } from "@/lib/localDb";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

const TYPES = ["web", "http"] as const;
const SOURCES = ["manual", "marketplace"] as const;
const AUTH_TYPES = ["none", "bearer", "header"] as const;

const createServiceSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(TYPES).optional(),
  url: z.string().min(1).max(2000),
  health_endpoint: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  proxied: z.boolean().optional(),
  upstream: z.string().max(500).nullable().optional(),
  required_scope: z.string().max(200).nullable().optional(),
  auth_type: z.enum(AUTH_TYPES).optional(),
  auth_secret: z.string().max(2000).nullable().optional(),
});

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const services = await listServices({ includeDisabled: true });
    return NextResponse.json({ services });
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

  const validation = validateBody(createServiceSchema, rawBody);
  if (isValidationFailure(validation)) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;
  try {
    const service = await createService({
      name: data.name,
      type: data.type,
      url: data.url,
      health_endpoint: data.health_endpoint ?? null,
      enabled: data.enabled,
      source: SOURCES[0],
      proxied: data.proxied,
      upstream: data.upstream ?? null,
      required_scope: data.required_scope ?? null,
      auth_type: data.auth_type,
      auth_secret: data.auth_secret ?? null,
    });
    return NextResponse.json({ service }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
