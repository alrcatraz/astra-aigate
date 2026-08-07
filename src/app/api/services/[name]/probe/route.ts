/**
 * API: Service health probe (Phase 3.8 Services Monitor)
 * POST — Run a health check against the service's health_endpoint now and
 *        record the result (up/down) + latency into health_logs.
 */

import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { getService, recordProbe, resolveHealthUrl } from "@/lib/localDb";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

type RouteContext = { params: Promise<{ name: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const { name } = await context.params;
  try {
    const service = await getService(name);
    if (!service) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    if (!service.enabled) {
      return NextResponse.json({ error: "Service is disabled" }, { status: 409 });
    }

    const url = resolveHealthUrl(service);
    const startedAt = Date.now();
    let status: "up" | "down";
    let latencyMs: number | null = null;
    let error: string | null = null;

    try {
      // AbortController timeout is a Node 18+ global (fetch in Next runtime).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: { Accept: "*/*" },
      });
      clearTimeout(timer);
      latencyMs = Date.now() - startedAt;
      if (response.ok) {
        status = "up";
      } else {
        status = "down";
        error = `HTTP ${response.status}`;
      }
    } catch (err: unknown) {
      latencyMs = Date.now() - startedAt;
      status = "down";
      error = err instanceof Error ? err.message : String(err);
    }

    await recordProbe(name, status, latencyMs, error);
    return NextResponse.json({
      service_id: name,
      status,
      latency_ms: latencyMs,
      error,
      checked_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}
