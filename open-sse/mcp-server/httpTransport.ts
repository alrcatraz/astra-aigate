/**
 * MCP HTTP Transport Layer — session-aware handlers for SSE and Streamable HTTP,
 * keyed by gateway endpoint (/api/mcp/servers/[id]/{sse,stream}).
 *
 * Runs the MCP server **inside** the Next.js process so it can be toggled
 * from the dashboard without requiring `omniroute --mcp`.
 *
 * Endpoint model (gateway mode):
 *   - builtin endpoints expose a locally-registered tool domain
 *     (aigate-omniroute=all / aigate-mcp=mcp_* / aigate-infra=none)
 *   - stdio/http endpoints forward to a downstream MCP server through a
 *     per-endpoint bridge (bridge.ts); downstream tools are registered on
 *     the local server as forwarding handlers.
 *
 * Transport modes:
 *   - SSE:             GET {endpoint}/sse (event stream)  +  POST {endpoint}/sse (messages)
 *   - Streamable HTTP: POST {endpoint}/stream (messages)  +  GET {endpoint}/stream (SSE stream)  +  DELETE {endpoint}/stream (session end)
 */

import { randomUUID } from "node:crypto";
import { createMcpServer, type McpToolDomain } from "./server.ts";
import { resolveMcpCallerAuthInfo, withMcpHttpAuthContext } from "./httpAuthContext.ts";
import { requestPresentsApiKey, scopeMatches } from "./scopeEnforcement.ts";
import {
  closeBridge,
  getBridgeStatus,
  getOrCreateBridge,
  registerDownstreamTools,
  type McpBridgeStatus,
  type McpEndpointBridge,
} from "./bridge.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpServer, type McpServer as McpServerRow } from "@/lib/db/mcpServers";

type StreamableSession = {
  sessionId: string;
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  startedAt: number;
  lastActivityAt: number;
};

type EndpointRuntime = {
  id: string;
  row: McpServerRow;
  domain: McpToolDomain;
  sse: {
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
    startedAt: number;
  } | null;
  streamableSessions: Map<string, StreamableSession>;
  bridge: McpEndpointBridge | null;
  ready: boolean;
  error: string | null;
};

const _endpoints = new Map<string, EndpointRuntime>();

const MCP_SESSION_IDLE_MS = 5 * 60 * 1000;

const _mcpSessionSweep = setInterval(() => {
  const now = Date.now();
  for (const endpoint of _endpoints.values()) {
    for (const [sessionId, session] of endpoint.streamableSessions) {
      if (now - session.lastActivityAt > MCP_SESSION_IDLE_MS) {
        try {
          closeStreamableSession(endpoint.id, sessionId);
        } catch {}
      }
    }
  }
}, 60_000);
if (typeof _mcpSessionSweep === "object" && "unref" in _mcpSessionSweep) {
  (_mcpSessionSweep as { unref?: () => void }).unref?.();
}

/**
 * Tool domain for the built-in gateway entries. Anything not listed here
 * defaults to "all" (incl. user-created builtin entries).
 */
const BUILTIN_DOMAINS: Record<string, McpToolDomain> = {
  "aigate-omniroute": "all",
  "aigate-mcp": "mcp",
  "aigate-infra": "none",
};

function domainFor(row: McpServerRow): McpToolDomain {
  if (row.kind === "builtin") return BUILTIN_DOMAINS[row.id] ?? "all";
  return "all";
}

async function ensureEndpointRuntime(id: string): Promise<EndpointRuntime> {
  const existing = _endpoints.get(id);
  if (existing?.ready) return existing;

  const row = await getMcpServer(id);
  if (!row) {
    throw new Error(`MCP server not found: ${id}`);
  }

  const runtime: EndpointRuntime = {
    id,
    row,
    domain: domainFor(row),
    sse: null,
    streamableSessions: new Map(),
    bridge: null,
    ready: false,
    error: null,
  };
  _endpoints.set(id, runtime);

  // stdio/http endpoints need their downstream bridge up before any local
  // server is exposed, so tools/list answers are complete on first contact.
  if (row.kind !== "builtin") {
    try {
      runtime.bridge = await getOrCreateBridge(row);
    } catch (error) {
      runtime.error =
        error instanceof Error ? error.message : "Failed to connect downstream MCP server";
      runtime.ready = true; // ready-but-error: sessions return a clear 503.
      return runtime;
    }
  }

  runtime.ready = true;
  return runtime;
}

function closeSseTransport(endpointId: string): void {
  const endpoint = _endpoints.get(endpointId);
  if (!endpoint?.sse) return;
  try {
    endpoint.sse.transport.close();
  } catch {
    // ignore shutdown errors
  }
  endpoint.sse = null;
}

function closeStreamableSession(endpointId: string, sessionId: string): void {
  const session = _endpoints.get(endpointId)?.streamableSessions.get(sessionId);
  if (!session) return;
  try {
    session.transport.close();
  } catch {
    // ignore shutdown errors
  }
  _endpoints.get(endpointId)?.streamableSessions.delete(sessionId);
}

function closeAllStreamableSessions(): void {
  for (const endpoint of _endpoints.values()) {
    for (const sessionId of endpoint.streamableSessions.keys()) {
      closeStreamableSession(endpoint.id, sessionId);
    }
  }
}

/** Create the local server for an endpoint with its tool set populated. */
function createEndpointServer(runtime: EndpointRuntime): McpServer {
  const server = createMcpServer(runtime.domain);
  if (runtime.row.kind !== "builtin" && runtime.bridge?.status === "ready") {
    // Downstream tools were fetched during ensureEndpointRuntime; register them
    // as forwarding handlers so tools/list is complete before first contact.
    registerDownstreamTools(server, runtime.bridge);
  }
  return server;
}

function ensureSseServer(runtime: EndpointRuntime): {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
} {
  if (runtime.sse) {
    return runtime.sse;
  }

  closeAllStreamableSessions();

  const server = createEndpointServer(runtime);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  runtime.sse = { server, transport, startedAt: Date.now() };

  void server.connect(transport);

  console.log(`[MCP] HTTP transport started (sse:${runtime.id})`);
  return runtime.sse;
}

function createStreamableSession(runtime: EndpointRuntime): StreamableSession {
  if (runtime.sse) {
    closeSseTransport(runtime.id);
  }

  const sessionId = randomUUID();
  const server = createEndpointServer(runtime);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });
  const session = {
    sessionId,
    server,
    transport,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  void server.connect(transport);
  runtime.streamableSessions.set(sessionId, session);
  console.log(`[MCP] HTTP transport started (streamable-http:${runtime.id}:${sessionId})`);
  return session;
}

async function isInitializeRequest(request: Request): Promise<boolean> {
  if (request.method !== "POST") {
    return false;
  }

  try {
    const body = (await request.clone().json()) as { method?: unknown };
    return body?.method === "initialize";
  } catch {
    return false;
  }
}

/**
 * Resolve the caller's per-key scopes (#7895) and hand the request to the
 * transport with `authInfo` populated, so `extra.authInfo.scopes` reaching
 * tool handlers reflects the real `api_keys.scopes` row instead of the
 * `OMNIROUTE_MCP_SCOPES` env fallback. When no per-key auth can be resolved
 * (no key, invalid key, stdio has no `Request` at all), `authInfo` stays
 * `undefined` and `scopeEnforcement.ts` falls through to its existing
 * meta/env chain unchanged.
 */
async function handleRequestWithAuthInfo(
  transport: WebStandardStreamableHTTPServerTransport,
  request: Request
): Promise<Response> {
  const authInfo = await resolveMcpCallerAuthInfo(request);
  return transport.handleRequest(request, { authInfo });
}

/**
 * Endpoint-level scope gate (Phase 3.6): a registry row with a non-null
 * `required_scope` (e.g. the aigate-mcp management endpoint's `admin:mcp`)
 * only accepts callers whose API-key scopes (or the OMNIROUTE_MCP_SCOPES env
 * fallback) match — exact, `*`, or `prefix*` per scopeMatches(). Rows without
 * a required_scope are open at the endpoint layer; their tools are still gated
 * individually via withScopeEnforcement().
 */
export async function checkEndpointScopeAccess(
  row: McpServerRow,
  request: Request
): Promise<Response | null> {
  if (!row.required_scope) return null;

  const authInfo = await resolveMcpCallerAuthInfo(request);

  // B2: a presented-but-invalid key must not silently gain the
  // OMNIROUTE_MCP_SCOPES env fallback. resolveMcpCallerAuthInfo returns
  // undefined for BOTH "no key" and "unrecognised key", so distinguish them:
  // a key header present with no resolved authInfo = failed auth → 401.
  if (!authInfo && requestPresentsApiKey(request)) {
    return errorResponse(`Invalid API key for MCP endpoint ${row.id}`, -32001, 401);
  }

  const envScopes = (process.env.OMNIROUTE_MCP_SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const callerScopes = authInfo?.scopes ?? envScopes;

  if (callerScopes.some((granted) => scopeMatches(granted, row.required_scope!))) {
    return null;
  }

  return errorResponse(
    `Insufficient scopes for MCP endpoint ${row.id}: required ${row.required_scope}`,
    -32001,
    403
  );
}

function errorResponse(message: string, code: number, status = 400): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export function protectMcpSseResponse(request: Request, response: Response): Response {
  if (
    request.method !== "POST" ||
    !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  const cacheControl = headers.get("cache-control");
  if (!/(?:^|,)\s*no-transform(?:\s*(?:,|$))/i.test(cacheControl ?? "")) {
    headers.set("cache-control", [cacheControl, "no-transform"].filter(Boolean).join(", "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withSessionHeader(response: Response, sessionId: string): Response {
  if (response.headers.get("mcp-session-id")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("mcp-session-id", sessionId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleStreamableRequest(request: Request, endpointId: string): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");

  const runtime = await ensureEndpointRuntime(endpointId);
  if (runtime.error) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Downstream unavailable: ${runtime.error}` },
        id: null,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const access = await checkEndpointScopeAccess(runtime.row, request);
  if (access) return access;

  if (sessionId) {
    const session = runtime.streamableSessions.get(sessionId);
    if (!session) {
      // MCP spec (2025-03-26 / 2025-11-25, Session Management): once a session is
      // terminated/unknown, the server MUST respond with HTTP 404 Not Found so the
      // client re-initializes. A 400 here is non-recoverable for spec-compliant
      // clients (they only re-init on 404). See issue #5169.
      //
      // Auto-recovery: if the client sends an initialize request with a stale session
      // id (e.g. after a server restart or idle eviction), treat it as a fresh
      // initialization rather than hard-failing with 404. This avoids requiring users
      // to manually restart their MCP client after every server restart.
      if (await isInitializeRequest(request)) {
        const newSession = createStreamableSession(runtime);
        try {
          const response = await withMcpHttpAuthContext(request, () =>
            handleRequestWithAuthInfo(newSession.transport, request)
          );
          return withSessionHeader(response, newSession.sessionId);
        } catch (err) {
          closeStreamableSession(runtime.id, newSession.sessionId);
          console.error("[MCP] Streamable HTTP error during stale-session recovery:", err);
          return new Response(JSON.stringify({ error: "MCP transport error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return errorResponse("Not Found: Unknown Mcp-Session-Id header", -32000, 404);
    }

    try {
      session.lastActivityAt = Date.now();
      const response = await withMcpHttpAuthContext(request, () =>
        handleRequestWithAuthInfo(session.transport, request)
      );
      if (request.method === "DELETE") {
        closeStreamableSession(runtime.id, sessionId);
      }
      return withSessionHeader(response, sessionId);
    } catch (err) {
      console.error("[MCP] Streamable HTTP error:", err);
      if (request.method === "DELETE") {
        closeStreamableSession(runtime.id, sessionId);
      }
      return new Response(JSON.stringify({ error: "MCP transport error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (!(await isInitializeRequest(request))) {
    return errorResponse("Bad Request: Mcp-Session-Id header is required", -32000);
  }

  const session = createStreamableSession(runtime);

  try {
    const response = await withMcpHttpAuthContext(request, () =>
      handleRequestWithAuthInfo(session.transport, request)
    );
    return withSessionHeader(response, session.sessionId);
  } catch (err) {
    closeStreamableSession(runtime.id, session.sessionId);
    console.error("[MCP] Streamable HTTP error:", err);
    return new Response(JSON.stringify({ error: "MCP transport error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle Streamable HTTP requests (POST / GET / DELETE) for one gateway endpoint.
 * Used by the Next.js route at /api/mcp/servers/[id]/stream.
 */
export async function handleMcpStreamableHTTP(
  request: Request,
  endpointId: string
): Promise<Response> {
  return protectMcpSseResponse(request, await handleStreamableRequest(request, endpointId));
}

/**
 * Handle SSE requests for one gateway endpoint.
 * SSE transport is implemented via Streamable HTTP transport with GET for SSE stream
 * and POST for messages (the Streamable HTTP transport supports both patterns).
 */
export async function handleMcpSSE(request: Request, endpointId: string): Promise<Response> {
  const runtime = await ensureEndpointRuntime(endpointId);
  if (runtime.error) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Downstream unavailable: ${runtime.error}` },
        id: null,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const access = await checkEndpointScopeAccess(runtime.row, request);
  if (access) return access;

  const { transport } = ensureSseServer(runtime);

  try {
    const response = await withMcpHttpAuthContext(request, () =>
      handleRequestWithAuthInfo(transport, request)
    );
    return protectMcpSseResponse(request, response);
  } catch (err) {
    console.error("[MCP] SSE error:", err);
    return new Response(JSON.stringify({ error: "MCP SSE transport error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export function getMcpHttpStatus(): {
  online: boolean;
  /** True when at least one endpoint holds an active session/SSE transport.
   * This is session activity, NOT transport readiness. Prefer per-endpoint
   * `ready` for readiness and `activeSession` for session activity. */
  activeSession: boolean;
  transport: string | null;
  startedAt: number | null;
  uptime: string | null;
  endpoints: Array<{
    id: string;
    kind: string;
    ready: boolean;
    error: string | null;
    bridge: string;
    tools: number;
  }>;
} {
  const startedAts: number[] = [];
  let transport: string | null = null;
  const endpoints = Array.from(_endpoints.values()).map((runtime) => {
    if (runtime.sse) {
      startedAts.push(runtime.sse.startedAt);
      transport = "sse";
    }
    for (const session of runtime.streamableSessions.values()) {
      startedAts.push(session.startedAt);
      transport = "streamable-http";
    }
    return {
      id: runtime.id,
      kind: runtime.row.kind,
      ready: runtime.ready,
      error: runtime.error,
      bridge: runtime.bridge ? getBridgeStatus(runtime.id) : "n/a",
      tools: runtime.bridge?.tools.length ?? 0,
    };
  });

  const startedAt = startedAts.length > 0 ? Math.min(...startedAts) : null;
  return {
    online: transport !== null,
    activeSession: transport !== null,
    transport,
    startedAt,
    uptime: startedAt ? `${Math.floor((Date.now() - startedAt) / 1000)}s` : null,
    endpoints,
  };
}

export function isMcpHttpTransportReady(
  enabled: boolean,
  transport: string | null | undefined
): boolean {
  return enabled && (transport === "sse" || transport === "streamable-http");
}

export function shutdownMcpHttp(): void {
  for (const endpointId of _endpoints.keys()) {
    closeSseTransport(endpointId);
    if (_endpoints.get(endpointId)?.bridge) {
      void closeBridge(endpointId);
    }
  }
  closeAllStreamableSessions();
  _endpoints.clear();
  console.log("[MCP] HTTP transport shutdown");
}

export function isMcpHttpActive(): boolean {
  return Array.from(_endpoints.values()).some(
    (endpoint) => endpoint.sse !== null || endpoint.streamableSessions.size > 0
  );
}

export interface McpEndpointProbe {
  id: string;
  kind: string;
  domain: McpToolDomain | null;
  ready: boolean;
  error: string | null;
  bridge: McpBridgeStatus | "idle" | "n/a";
  tools: number;
}

/**
 * Force materialisation of an endpoint runtime and report its state.
 * Used by the management UI "test connection" action: stdio/http endpoints
 * get their downstream bridge connected here, so the probe doubles as a
 * connectivity check. Builtin endpoints are always ready (local server).
 */
export async function probeMcpEndpoint(endpointId: string): Promise<McpEndpointProbe> {
  let runtime: EndpointRuntime;
  try {
    runtime = await ensureEndpointRuntime(endpointId);
  } catch (error) {
    // Unknown/never-registered id: report a structured failure instead of throwing,
    // so the management API can 200-with-error (UI shows "entry not found").
    return {
      id: endpointId,
      kind: "unknown",
      domain: null,
      ready: false,
      error: error instanceof Error ? error.message : "MCP server not found",
      bridge: "error",
      tools: 0,
    };
  }
  const builtin = runtime.row.kind === "builtin";
  // Probe reports connectivity, not the ready-but-error server semantics used
  // by sessions (which stay up to answer 503). A downstream failure surfaces as
  // ready=false + bridge="error" so the UI "test connection" turns red.
  const probeReady = builtin ? true : runtime.error === null && runtime.bridge !== null;
  const bridgeState: McpEndpointProbe["bridge"] = builtin
    ? "n/a"
    : runtime.bridge
      ? getBridgeStatus(runtime.id)
      : runtime.error
        ? "error"
        : "connecting";
  return {
    id: runtime.id,
    kind: runtime.row.kind,
    domain: builtin ? runtime.domain : null,
    ready: probeReady,
    error: runtime.error,
    bridge: bridgeState,
    tools: runtime.bridge?.tools.length ?? 0,
  };
}
