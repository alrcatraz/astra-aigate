import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../open-sse/executors/adapta-web.ts");

const originalFetch = globalThis.fetch;

/**
 * Hermetic stand-in for the live Clerk session lookup at
 * https://clerk.agent.adapta.one/v1/client. A fake __client JWT is rejected by
 * the real host (non-2xx), which makes getSessionId() throw — the exact same
 * auth-failure path these tests exercise — without a live upstream call (CI
 * runners have no egress and would wait out the full fetch timeout).
 */
function stubClerkAuthRejection() {
  const calls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return calls;
}

describe("AdaptaWebExecutor", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("can be instantiated", () => {
    const executor = new mod.AdaptaWebExecutor();
    assert.ok(executor);
  });

  it("returns 401 when credentials are missing", async () => {
    const executor = new mod.AdaptaWebExecutor();
    const result = await executor.execute({
      model: "adapta-one",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {},
      signal: null,
    });
    assert.equal(result.response.status, 401);
    const json = await result.response.json();
    assert.ok(json.error.message.includes("Missing Adapta credentials"));
  });

  it("returns 401 when apiKey is empty", async () => {
    const executor = new mod.AdaptaWebExecutor();
    const result = await executor.execute({
      model: "adapta-one",
      body: { messages: [{ role: "user", content: "test" }] },
      stream: false,
      credentials: { apiKey: "" },
      signal: null,
    });
    assert.equal(result.response.status, 401);
  });

  it("execute returns proper result shape on auth failure", async () => {
    const clerkCalls = stubClerkAuthRejection();
    const executor = new mod.AdaptaWebExecutor();
    const result = await executor.execute({
      model: "adapta-one",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "invalid-jwt" },
      signal: null,
    });
    assert.ok(result.response instanceof Response);
    assert.ok(typeof result.url === "string");
    assert.ok(typeof result.headers === "object");
    assert.ok(result.transformedBody !== undefined);
    // The auth-failure branch must actually have gone through the Clerk
    // session lookup (mirrors the live 401 the fake JWT would receive).
    assert.equal(clerkCalls.length, 1);
    assert.match(clerkCalls[0], /^https:\/\/clerk\.agent\.adapta\.one\/v1\/client/);
    globalThis.fetch = originalFetch;
  });

  it("testConnection returns false for invalid credentials", async () => {
    // apiKey is empty, so testConnection early-returns false without any
    // upstream call — no stub needed.
    const executor = new mod.AdaptaWebExecutor();
    const connected = await executor.testConnection({ apiKey: "" });
    assert.equal(connected, false);
  });
});
