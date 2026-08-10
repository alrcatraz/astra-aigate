/**
 * Service gateway dynamic reverse proxy — /api/svc/[id]/[[...path]]
 *
 * Phase 3.8 B 方案 (2026-08-05 定稿): proxies requests to auxiliary services
 * registered in the `services` table with `proxied=1` behind the AI Gate
 * unified endpoint.
 *
 *   /api/svc/camofox/...            → upstream http://127.0.0.1:9377/...
 *   /api/svc/searxng/search?q=...   → upstream http://host.containers.internal:8080/search?q=...
 *
 * Auth mirrors the MCP gateway dual channel (Phase 3.6b): an API-key request
 * (Bearer / x-api-key) skips the admin-session gate — the key + required_scope
 * are validated downstream by resolveMcpCallerAuthInfo + checkServiceScopeAccess.
 * The caller's own Authorization header is never forwarded; instead the
 * service's registered downstream credential (auth_type/auth_secret, decrypted
 * at rest) is injected. Every call is audited.
 *
 * WebSocket upgrade is intentionally not implemented yet (camofox is pure
 * REST; the shared-netns layout keeps the WS upgrade path for a later phase).
 */

import { NextRequest } from "next/server";
import { SafeOutboundFetchError } from "@/shared/network/safeOutboundFetch";
import { safeOutboundFetch } from "@/shared/network/safeOutboundFetch";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import { logAuditEvent } from "@/lib/compliance";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  hasServiceApiKeyAuth,
  resolveServiceEndpoint,
  checkServiceScopeAccess,
} from "@/lib/api/serviceEndpoint";

export const dynamic = "force-dynamic";

/** Headers copied from the upstream response to the caller. */
const RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "etag"] as const;

function buildTargetUrl(
  service: { upstream: string | null },
  path: string[],
  request: Request
): { url: string; error?: never } | { url?: never; error: string } {
  if (!service.upstream) {
    return { error: `Service has no upstream target configured.` };
  }
  const base = service.upstream.replace(/\/+$/, "");
  const suffix = path.length > 0 ? `/${path.join("/")}` : "";
  // Preserve the caller's query string (including an empty one).
  const search = new URL(request.url).search;
  return { url: `${base}${suffix}${search}` };
}

async function bridge(request: NextRequest, id: string, path: string[]): Promise<Response> {
  const resolved = await resolveServiceEndpoint(id);
  if (resolved.ok === false) return resolved.response;

  const service = resolved.service;

  // 匿名开放：auth_type=none 且无 required_scope 的服务端点跳过第一道鉴权。
  // 这类服务自身不需下游 key（Hermes 的 SEARXNG_URL 这类纯 URL 客户端无鉴权能力），
  // required_scope 为 null 时 checkServiceScopeAccess 内部也直接放行。
  const isPublic = service.auth_type === "none" && !service.required_scope;
  if (!isPublic) {
    // Dual channel (Phase 3.6b pattern): admin session OR API key.
    if (!hasServiceApiKeyAuth(request)) {
      const authError = await requireManagementAuth(request);
      if (authError) return authError;
    }
  }

  const scopeError = await checkServiceScopeAccess(service, request);
  if (scopeError) return scopeError;

  const target = buildTargetUrl(service, path, request);
  if ("error" in target) {
    return new Response(JSON.stringify({ error: target.error }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Forwarded headers: content-type/accept only, plus the registered
  // downstream credential. The caller's Authorization/cookie/host are never
  // proxied (the AI Gate key must not leak to the upstream service).
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);
  if (service.auth_type === "bearer" && service.auth_secret) {
    headers.set("authorization", `Bearer ${service.auth_secret}`);
  } else if (service.auth_type === "header" && service.auth_secret) {
    headers.set("x-api-key", service.auth_secret);
  }

  let upstream: Response;
  try {
    upstream = await safeOutboundFetch(target.url, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      timeoutMs: 30_000,
      allowRedirect: false,
      retry: false,
      guard: "none", // admin-registered upstream URL, same convention as MCP bridges
    });
  } catch (err: unknown) {
    await logAuditEvent({
      action: "service.proxy",
      actor: "gateway",
      target: `svc:${id}`,
      details: {
        method: request.method,
        path: path.join("/") || "/",
        error: sanitizeErrorMessage(err),
      },
      status: "error",
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
    });
    const status = err instanceof SafeOutboundFetchError ? 502 : 500;
    return new Response(
      JSON.stringify({ error: `Gateway upstream error: ${sanitizeErrorMessage(err)}` }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }

  await logAuditEvent({
    action: "service.proxy",
    actor: "gateway",
    target: `svc:${id}`,
    details: {
      method: request.method,
      path: path.join("/") || "/",
      upstreamStatus: upstream.status,
    },
    status: upstream.status < 400 ? "success" : "error",
    ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
  });

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ id: string; path?: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id, path = [] } = await context.params;
  return bridge(request, id, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id, path = [] } = await context.params;
  return bridge(request, id, path);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id, path = [] } = await context.params;
  return bridge(request, id, path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id, path = [] } = await context.params;
  return bridge(request, id, path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id, path = [] } = await context.params;
  return bridge(request, id, path);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  const { id, path = [] } = await context.params;
  return bridge(request, id, path);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  const { id, path = [] } = await context.params;
  return bridge(request, id, path);
}
