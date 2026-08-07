/**
 * @file 3.6a — mcp_* admin tools declare read:mcp / write:mcp tool scopes.
 *
 * The aigate-mcp endpoint tool set gates on tool-level scopes declared via
 * withScopeEnforcement(toolName, handler, toolScopes): read group (list/get/
 * health) requires read:mcp, write group (register/unregister) requires
 * write:mcp. Enforce mode mirrors MCP_ENFORCE_SCOPES (OMNIROUTE_MCP_ENFORCE_SCOPES).
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

async function freshImport(modulePath: string) {
  return import(`${modulePath}?q=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test("3.6a read-group tools are declared with read:mcp", async () => {
  const { evaluateToolScopes } = await freshImport("../../open-sse/mcp-server/scopeEnforcement.ts");
  const { MCP_READ_SCOPE, MCP_WRITE_SCOPE } = await freshImport(
    "../../src/shared/constants/mcpScopes.ts"
  );

  const readTools = ["mcp_list_servers", "mcp_get_server", "mcp_server_health"];
  const writeTools = ["mcp_register_server", "mcp_unregister_server"];

  for (const tool of readTools) {
    const granted = evaluateToolScopes(tool, [MCP_READ_SCOPE], true, [MCP_READ_SCOPE]);
    assert.equal(granted.allowed, true, `${tool} allowed with read:mcp`);
    const denied = evaluateToolScopes(tool, [MCP_WRITE_SCOPE], true, [MCP_READ_SCOPE]);
    assert.equal(denied.allowed, false, `${tool} denied without read:mcp`);
    assert.deepEqual(denied.missing, [MCP_READ_SCOPE], `${tool} reports missing read:mcp`);
  }

  for (const tool of writeTools) {
    const granted = evaluateToolScopes(tool, [MCP_WRITE_SCOPE], true, [MCP_WRITE_SCOPE]);
    assert.equal(granted.allowed, true, `${tool} allowed with write:mcp`);
    const denied = evaluateToolScopes(tool, [MCP_READ_SCOPE], true, [MCP_WRITE_SCOPE]);
    assert.equal(denied.allowed, false, `${tool} denied without write:mcp`);
    assert.deepEqual(denied.missing, [MCP_WRITE_SCOPE], `${tool} reports missing write:mcp`);
  }
});

test("3.6a combined scopes grant both groups", async () => {
  const { evaluateToolScopes } = await freshImport("../../open-sse/mcp-server/scopeEnforcement.ts");
  const { MCP_READ_SCOPE, MCP_WRITE_SCOPE } = await freshImport(
    "../../src/shared/constants/mcpScopes.ts"
  );

  const both = evaluateToolScopes(
    "mcp_unregister_server",
    [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
    true,
    [MCP_WRITE_SCOPE]
  );
  assert.equal(both.allowed, true, "write:mcp alone is enough for the write group");

  const readOnly = evaluateToolScopes("mcp_register_server", [MCP_READ_SCOPE], true, [
    MCP_WRITE_SCOPE,
  ]);
  assert.equal(readOnly.allowed, false, "read-only key cannot register servers");
});

test("3.6a enforce-off mode always allows (mirrors MCP_ENFORCE_SCOPES=false)", async () => {
  const { evaluateToolScopes } = await freshImport("../../open-sse/mcp-server/scopeEnforcement.ts");
  const deniedKey = evaluateToolScopes("mcp_unregister_server", [], false, ["write:mcp"]);
  assert.equal(deniedKey.allowed, true, "enforce=false bypasses scope checks");
});

test("3.6a undeclared tool in enforce mode is rejected (tool_definition_missing)", async () => {
  const { evaluateToolScopes } = await freshImport("../../open-sse/mcp-server/scopeEnforcement.ts");
  const missing = evaluateToolScopes("mcp_unknown_tool", ["read:mcp", "write:mcp"], true);
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, "tool_definition_missing");
});
