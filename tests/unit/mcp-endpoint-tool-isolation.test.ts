// tests/unit/mcp-endpoint-tool-isolation.test.ts
// Regression: /api/mcp/servers/[id] endpoints must be scoped to [id]'s OWN tool set.
//
// Bug: domainFor() returned "all" for registered (downstream) endpoints, so a
// registered endpoint (e.g. the knowledge-base MCP) advertised AIGate's entire
// builtin catalog (112 tools) PLUS its downstream tools (~17 kb_*) — [id] resolved
// correctly but the endpoint wasn't scoped to it, returning ~100+ aggregated tools.
// Fix: registered endpoints get domain "none" (hide all local builtins) while
// registerDownstreamTools routes through server.registerRawTool so the downstream
// tools bypass the domain filter and stay enabled. Builtin endpoints are unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../../open-sse/mcp-server/server.ts";

type RegisteredTool = { enabled: boolean };

/** Names of tools that are ENABLED (announced by tools/list). */
function enabledToolNames(server: unknown): string[] {
  const registry = (server as { _registeredTools?: Record<string, RegisteredTool> })
    ._registeredTools;
  if (!registry) return [];
  return Object.entries(registry)
    .filter(([, tool]) => tool.enabled)
    .map(([name]) => name);
}

/** Mirrors domainFor() in httpTransport.ts: builtin -> mapped domain, registered -> "none". */
function domainFor(kind: string, id: string): "all" | "mcp" | "none" {
  if (kind === "builtin") {
    const mapped: Record<string, string> = {
      "aigate-omniroute": "all",
      "aigate-mcp": "mcp",
      "aigate-infra": "none",
    };
    return (mapped[id] ?? "all") as "all" | "mcp" | "none";
  }
  return "none";
}

test("registered endpoint exposes ONLY its downstream tools (no local builtin leak)", async () => {
  // builtin aigate-omniroute keeps the full local catalog (regression guard).
  const builtinTools = enabledToolNames(createMcpServer(domainFor("builtin", "aigate-omniroute")));
  assert.ok(builtinTools.length > 10, "builtin endpoint must still expose the local catalog");

  // registered endpoint with domain "none" must have ZERO local tools enabled.
  const isolated = createMcpServer(domainFor("registered", "kb"));
  assert.equal(
    enabledToolNames(isolated).length,
    0,
    "registered endpoint must hide ALL local builtin tools"
  );

  // Downstream tools registered via registerRawTool stay enabled despite domain "none".
  const server = createMcpServer(domainFor("registered", "kb"));
  const raw = (
    server as unknown as {
      registerRawTool?: (name: string, config: object, handler: unknown) => unknown;
    }
  ).registerRawTool;
  assert.equal(typeof raw, "function", "createMcpServer must expose registerRawTool");
  for (const name of ["kb_list", "kb_search", "kb_add"]) {
    raw!(name, { description: "kb" }, async () => ({ content: [{ type: "text", text: "ok" }] }));
  }

  const names = enabledToolNames(server);
  assert.deepEqual(
    [...names].sort(),
    ["kb_add", "kb_list", "kb_search"],
    "registered endpoint must announce exactly its downstream tools"
  );
  assert.ok(
    names.every((n) => n.startsWith("kb_")),
    "no local builtin tool may leak into a registered endpoint"
  );
});
