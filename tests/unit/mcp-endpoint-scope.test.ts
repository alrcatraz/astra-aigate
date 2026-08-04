/**
 * @file 3.6b — endpoint-level scope gate (checkEndpointScopeAccess).
 *
 * A registry row with a non-null `required_scope` (aigate-mcp preset:
 * admin:mcp) only accepts callers whose API-key scopes — or the
 * OMNIROUTE_MCP_SCOPES env fallback — match (exact, `*`, `prefix*`).
 * Rows without required_scope are open at the endpoint layer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const dataDir = mkdtempSync(join(tmpdir(), "mcp-endpoint-scope-"));
process.env.DATA_DIR = dataDir;
process.env.OMNIROUTE_MAX_PENDING_MIGRATIONS = "0";

async function freshImport(modulePath: string) {
  return import(`${modulePath}?q=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function mkRow(requiredScope: string | null) {
  return { id: "smoke-endpoint", required_scope: requiredScope } as {
    id: string;
    required_scope: string | null;
  };
}

function mkRequest(): Request {
  return new Request("https://ai-gate.local/api/mcp/servers/smoke-endpoint/sse");
}

test("3.6b scopeMatches: exact / wildcard / prefix* semantics", async () => {
  const { scopeMatches } = await freshImport(join(root, "open-sse/mcp-server/scopeEnforcement.ts"));
  assert.equal(scopeMatches("admin:mcp", "admin:mcp"), true, "exact match");
  assert.equal(scopeMatches("*", "admin:mcp"), true, "universal wildcard");
  assert.equal(scopeMatches("admin:*", "admin:mcp"), true, "prefix* covers child scope");
  assert.equal(scopeMatches("read:mcp", "admin:mcp"), false, "unrelated scope rejected");
  assert.equal(scopeMatches("admin", "admin:mcp"), false, "bare prefix without * is not a match");
});

test("3.6b no required_scope → endpoint layer is open", async () => {
  process.env.OMNIROUTE_MCP_SCOPES = "";
  const { checkEndpointScopeAccess } = await freshImport(
    join(root, "open-sse/mcp-server/httpTransport.ts")
  );
  const gate = await checkEndpointScopeAccess(mkRow(null), mkRequest());
  assert.equal(gate, null, "rows without required_scope must pass");
});

test("3.6b env fallback scopes satisfy required_scope", async () => {
  process.env.OMNIROUTE_MCP_SCOPES = "read:health,admin:mcp";
  const { checkEndpointScopeAccess } = await freshImport(
    join(root, "open-sse/mcp-server/httpTransport.ts")
  );
  const gate = await checkEndpointScopeAccess(mkRow("admin:mcp"), mkRequest());
  assert.equal(gate, null, "env fallback containing admin:mcp must pass");
});

test("3.6b missing scope → 403 with required scope in the message", async () => {
  process.env.OMNIROUTE_MCP_SCOPES = "read:health";
  const { checkEndpointScopeAccess } = await freshImport(
    join(root, "open-sse/mcp-server/httpTransport.ts")
  );
  const gate = await checkEndpointScopeAccess(mkRow("admin:mcp"), mkRequest());
  assert.ok(gate, "gate must reject");
  assert.equal(gate.status, 403);
  const body = await gate.json();
  assert.match(body.error?.message ?? "", /required admin:mcp/);
});

test("3.6b prefix* and universal wildcard grant access", async () => {
  for (const scope of ["admin:*", "*"]) {
    process.env.OMNIROUTE_MCP_SCOPES = scope;
    const { checkEndpointScopeAccess } = await freshImport(
      join(root, "open-sse/mcp-server/httpTransport.ts")
    );
    const gate = await checkEndpointScopeAccess(mkRow("admin:mcp"), mkRequest());
    assert.equal(gate, null, `scope "${scope}" must satisfy admin:mcp`);
  }
});
