/**
 * @file 3.7 — endpoint dual-channel auth gate (hasMcpApiKeyAuth).
 *
 * Phase 3.6b declared endpoints accept EITHER an admin session OR an API key,
 * but the route layer unconditionally ran requireManagementAuth first —
 * API-key requests died with AUTH_001 before ever reaching httpTransport.
 * Fixed: routes skip the session gate when an API-key credential is present
 * (hasMcpApiKeyAuth), letting resolveMcpCallerAuthInfo + checkEndpointScopeAccess
 * validate downstream.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { hasMcpApiKeyAuth } from "../../src/lib/api/mcpEndpoint";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/mcp/servers/aigate-mcp/stream", { headers });
}

test("Bearer token present → true", () => {
  assert.equal(hasMcpApiKeyAuth(req({ authorization: "Bearer sk-abc123" })), true);
});

test("Bearer with extra spaces → true", () => {
  assert.equal(hasMcpApiKeyAuth(req({ authorization: "  Bearer   sk-abc123  " })), true);
});

test("lowercase bearer → true", () => {
  assert.equal(hasMcpApiKeyAuth(req({ authorization: "bearer sk-abc123" })), true);
});

test("x-api-key header → true", () => {
  assert.equal(hasMcpApiKeyAuth(req({ "x-api-key": "sk-abc123" })), true);
});

test("no auth headers → false", () => {
  assert.equal(hasMcpApiKeyAuth(req({})), false);
});

test("empty Bearer → false", () => {
  assert.equal(hasMcpApiKeyAuth(req({ authorization: "Bearer" })), false);
  assert.equal(hasMcpApiKeyAuth(req({ authorization: "Bearer   " })), false);
});

test("non-Bearer Authorization (e.g. Basic) → false", () => {
  assert.equal(hasMcpApiKeyAuth(req({ authorization: "Basic dXNlcjpwYXNz" })), false);
});

test("empty x-api-key → false", () => {
  assert.equal(hasMcpApiKeyAuth(req({ "x-api-key": "   " })), false);
});
