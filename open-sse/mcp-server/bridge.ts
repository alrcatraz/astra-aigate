/**
 * Gateway Bridge — connects stdio/http downstream MCP servers and exposes
 * their tools through a local McpServer instance (the gateway endpoint).
 *
 *   Client (Claude Desktop, …) ── MCP ──▶ gateway endpoint (McpServer)
 *                                              │
 *                                              ▼ (bridge)
 *                                     StdioClientTransport / StreamableHTTP/SSE client
 *                                              │
 *                                              ▼
 *                                    downstream MCP server
 *
 * Downstream tools are discovered at connect time (listTools) and
 * registered on the local server as forwarding handlers. The downstream
 * connection itself is endpoint-scoped (one child process / one HTTP
 * session per registry entry), shared by all client sessions of that
 * endpoint. SSRF protection comes from injecting safeOutboundFetch into
 * the HTTP client transports (same pattern as open-sse/handlers/search.ts).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { safeOutboundFetch } from "@/shared/network/safeOutboundFetch";
import type { McpServer as McpServerRow } from "@/lib/db/mcpServers";

export type McpBridgeStatus = "connecting" | "ready" | "error";

export interface DownstreamTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpEndpointBridge {
  id: string;
  kind: "stdio" | "http";
  status: McpBridgeStatus;
  client: Client | null;
  transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | null;
  tools: DownstreamTool[];
  error: string | null;
  startedAt: number | null;
}

const BRIDGE_CONNECT_TIMEOUT_MS = 15_000;

const _bridges = new Map<string, McpEndpointBridge>();

/**
 * Convert a downstream JSON Schema (as returned by tools/list) into a Zod
 * schema for local registration. The MCP server SDK only accepts Zod
 * schemas, while the protocol carries JSON Schema — so forwarded tools need
 * this translation. Covers the shapes that actually occur in MCP tool
 * schemas; anything unrecognised degrades to `z.unknown()` so registration
 * never fails on an exotic schema.
 */
function jsonSchemaToZod(schema: Record<string, unknown> | undefined): z.ZodType | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const type = schema.type;
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;

  if (enumValues) {
    const strings = enumValues.filter((v): v is string => typeof v === "string");
    if (strings.length > 0) return z.enum(strings);
    return z.unknown();
  }

  if (type === "object" || schema.properties !== undefined) {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    const shape: Record<string, z.ZodType> = {};
    for (const [name, prop] of Object.entries(properties)) {
      const converted = jsonSchemaToZod(prop);
      shape[name] =
        required.includes(name) && converted ? converted : (converted ?? z.unknown()).optional();
    }
    if (Object.keys(shape).length > 0) return z.object(shape);
    // zod v4 requires an explicit key type for record().
    return z.record(z.string(), z.unknown());
  }

  if (type === "string") return z.string();
  if (type === "number" || type === "integer") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "array") {
    const items = (schema.items as Record<string, unknown> | undefined) ?? undefined;
    return z.array(jsonSchemaToZod(items) ?? z.unknown());
  }

  if (Array.isArray(type) && type.includes("null")) {
    const nonNull = type.filter((t): t is string => t !== "null");
    const base =
      nonNull.length === 1 ? jsonSchemaToZod({ ...schema, type: nonNull[0] }) : undefined;
    return (base ?? z.unknown()).nullable();
  }

  return z.unknown();
}

/** Default header name for `auth_type: "header"` downstream auth injection. */
const MCP_HEADER_AUTH_NAME = "X-MCP-Api-Key";

export function buildDownstreamHeaders(row: McpServerRow): Record<string, string> {
  if (!row.auth_secret) return {};
  if (row.auth_type === "bearer") return { Authorization: `Bearer ${row.auth_secret}` };
  if (row.auth_type === "header") return { [MCP_HEADER_AUTH_NAME]: row.auth_secret };
  return {};
}

function createTransport(
  row: McpServerRow
): StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport {
  if (row.kind === "stdio") {
    const args = row.args ? row.args.split(/\s+/).filter(Boolean) : [];
    return new StdioClientTransport({ command: row.command ?? "", args, stderr: "pipe" });
  }
  const url = new URL(row.url ?? "");
  const headers = buildDownstreamHeaders(row);
  const requestInit = Object.keys(headers).length ? { headers } : undefined;
  if (url.pathname.endsWith("/sse")) {
    return new SSEClientTransport(url, { fetch: safeOutboundFetch, requestInit });
  }
  return new StreamableHTTPClientTransport(url, {
    fetch: safeOutboundFetch,
    requestInit,
  });
}

async function connectBridge(row: McpServerRow): Promise<McpEndpointBridge> {
  if (row.kind === "builtin") {
    throw new Error(`Bridge cannot be created for builtin entry: ${row.id}`);
  }
  const bridge: McpEndpointBridge = {
    id: row.id,
    kind: row.kind,
    status: "connecting",
    client: null,
    transport: null,
    tools: [],
    error: null,
    startedAt: null,
  };
  _bridges.set(row.id, bridge);

  const transport = createTransport(row);
  bridge.transport = transport;

  const client = new Client(
    { name: "astra-aigate-gateway", version: "1.0.0" },
    { capabilities: {} }
  );
  bridge.client = client;

  try {
    const startedAt = Date.now();
    await withTimeout(client.connect(transport), BRIDGE_CONNECT_TIMEOUT_MS);
    const { tools } = await withTimeout(client.listTools(), BRIDGE_CONNECT_TIMEOUT_MS);
    bridge.tools = tools.map((t) => ({
      name: t.name,
      description: typeof t.description === "string" ? t.description : undefined,
      inputSchema: (t.inputSchema as Record<string, unknown> | undefined) ?? undefined,
    }));
    bridge.status = "ready";
    bridge.startedAt = startedAt;
    console.log(`[MCP] bridge ready: ${row.id} (${bridge.tools.length} downstream tools)`);
  } catch (error) {
    bridge.status = "error";
    bridge.error =
      error instanceof Error ? error.message : "Failed to connect downstream MCP server";
    console.error(`[MCP] bridge failed: ${row.id} — ${bridge.error}`);
    await closeBridgeClient(bridge);
    throw error;
  }
  return bridge;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Connection timed out after ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeBridgeClient(bridge: McpEndpointBridge): Promise<void> {
  if (bridge.client) {
    try {
      await bridge.client.close();
    } catch {
      // ignore shutdown errors
    }
    bridge.client = null;
  }
  if (bridge.transport) {
    try {
      await bridge.transport.close();
    } catch {
      // ignore shutdown errors
    }
    bridge.transport = null;
  }
}

/** Get the bridge for a stdio/http registry entry, connecting on first use. */
export async function getOrCreateBridge(row: McpServerRow): Promise<McpEndpointBridge> {
  const existing = _bridges.get(row.id);
  if (existing) {
    if (existing.status === "ready") return existing;
    if (existing.status === "connecting") {
      // Wait for the in-flight connect to settle rather than racing a second one.
      let timer: NodeJS.Timeout | undefined;
      try {
        await new Promise<void>((resolve) => {
          const poll = setInterval(() => {
            const b = _bridges.get(row.id);
            if (b && b.status !== "connecting") {
              clearInterval(poll);
              resolve();
            }
          }, 50);
          timer = setTimeout(() => {
            clearInterval(poll);
            resolve();
          }, BRIDGE_CONNECT_TIMEOUT_MS + 5_000);
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
      const settled = _bridges.get(row.id);
      if (settled?.status === "ready") return settled;
    }
    // error (or timed-out connecting): drop and reconnect.
    _bridges.delete(row.id);
  }
  return connectBridge(row);
}

/**
 * Register every downstream tool on a local gateway server as a forwarding
 * handler. Safe to call after connect; subsequent tools (rare) can be added
 * by calling again.
 */
export function registerDownstreamTools(server: McpServer, bridge: McpEndpointBridge): number {
  if (bridge.status !== "ready") return 0;
  let registered = 0;
  for (const tool of bridge.tools) {
    const handler = async (
      args: unknown
    ): Promise<{
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }> => {
      if (!bridge.client) {
        return {
          content: [{ type: "text", text: `Bridge for ${bridge.id} is not connected` }],
          isError: true,
        };
      }
      const result = await bridge.client.callTool({
        name: tool.name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
      const content = Array.isArray(result.content)
        ? (result.content as Array<{ type: "text"; text: string }>)
        : [{ type: "text" as const, text: JSON.stringify(result) }];
      return { content, isError: result.isError === true };
    };
    server.registerTool(
      tool.name,
      {
        description: tool.description ?? `Forwarded from downstream MCP server ${bridge.id}`,
        // Downstream tools/list carries JSON Schema; the SDK only accepts Zod.
        inputSchema: jsonSchemaToZod(tool.inputSchema) ?? undefined,
      },
      handler as never
    );
    registered += 1;
  }
  return registered;
}

export function getBridgeStatus(id: string): McpBridgeStatus | "idle" {
  return _bridges.get(id)?.status ?? "idle";
}

export function getBridgeError(id: string): string | null {
  return _bridges.get(id)?.error ?? null;
}

export function getBridgeToolCount(id: string): number {
  return _bridges.get(id)?.tools.length ?? 0;
}

export async function closeBridge(id: string): Promise<void> {
  const bridge = _bridges.get(id);
  if (!bridge) return;
  await closeBridgeClient(bridge);
  _bridges.delete(id);
  console.log(`[MCP] bridge closed: ${id}`);
}
