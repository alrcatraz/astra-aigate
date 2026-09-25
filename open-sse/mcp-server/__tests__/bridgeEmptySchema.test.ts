import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDownstreamTools, type McpEndpointBridge } from "../bridge";

/**
 * Regression test for tools/call returning JSON-RPC -32602 on tools whose
 * inputSchema is an object with empty/absent `properties`.
 *
 * Root cause: `jsonSchemaToZod` mapped such schemas to
 * `z.record(z.string(), z.unknown())`. The SDK's `normalizeObjectSchema`
 * returns `undefined` for a ZodRecord (no `shape`), so `tools/list` fell back
 * to `{ type: "object", properties: {} }` (client sees no required params),
 * while `tools/call` validated against the raw record. A client that omits
 * `arguments` (as the list response permits) then failed record validation
 * with -32602.
 */

function makeBridge(tools: McpEndpointBridge["tools"]): {
  bridge: McpEndpointBridge;
  callTool: ReturnType<typeof vi.fn>;
} {
  const callTool = vi.fn().mockResolvedValue({
    content: [{ type: "text" as const, text: "ok" }],
    isError: false,
  });
  const bridge: McpEndpointBridge = {
    id: "astra-kb-mcp",
    kind: "http",
    status: "ready",
    client: { callTool } as unknown as McpEndpointBridge["client"],
    transport: null,
    tools,
    error: null,
    startedAt: Date.now(),
  };
  return { bridge, callTool };
}

describe("registerDownstreamTools empty-object inputSchema", () => {
  const clients: Client[] = [];

  async function setup(tools: McpEndpointBridge["tools"]) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const { bridge, callTool } = makeBridge(tools);
    const count = registerDownstreamTools(server, bridge);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    clients.push(client);
    return { client, callTool, count };
  }

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  it("registers tools whose inputSchema has empty or absent properties", async () => {
    const { client, count } = await setup([
      {
        name: "empty_props",
        description: "empty properties object",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "no_props",
        description: "absent properties key",
        inputSchema: { type: "object" },
      },
    ]);

    expect(count).toBe(2);

    const { tools } = await client.listTools();
    for (const name of ["empty_props", "no_props"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `tool ${name} should be listed`).toBeDefined();
      expect(tool?.inputSchema).toMatchObject({
        type: "object",
        properties: {},
      });
    }
  });

  it("accepts omitted, empty, and extra arguments on call without -32602", async () => {
    const { client, callTool } = await setup([
      {
        name: "empty_props",
        description: "empty properties object",
        inputSchema: { type: "object", properties: {} },
      },
    ]);

    // Omitted arguments is the exact -32602 reproduction: tools/list shows no
    // required fields, so a client legitimately omits `arguments`.
    const omitted = await client.callTool({ name: "empty_props" });
    expect(omitted.isError).toBeFalsy();

    const empty = await client.callTool({ name: "empty_props", arguments: {} });
    expect(empty.isError).toBeFalsy();

    const extra = await client.callTool({
      name: "empty_props",
      arguments: { a: 1 },
    });
    expect(extra.isError).toBeFalsy();

    expect(callTool).toHaveBeenCalledTimes(3);
  });
});
