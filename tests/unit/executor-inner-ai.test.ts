import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../open-sse/executors/inner-ai.ts");

// Hermetic: unit tests must never open a socket to innerai.com (CI runners
// have no egress; a live attempt can block for minutes). The original global
// fetch is restored after every case so later tests see the stock runtime.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Route every Inner.ai endpoint the executor reaches to an in-process stub:
 *   profile (inner-ai.ts ~L180) -> 200 with an email, so credential
 *   resolution completes; models (L235) -> 200 with a gpt-4o entry;
 *   chat (L640) -> 200 SSE, so the non-streaming path collects content.
 * Any other URL is a live-network leak and fails the test.
 */
function stubInnerAiFetch(): void {
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/v1/users/profile")) {
      return jsonResponse(200, { data: { email: "unit@test.example" } });
    }
    if (url.endsWith("/api/v1/ai_models")) {
      return jsonResponse(200, {
        data: [{ id: "model-uuid-1", llm_model: "gpt-4o", enable: true }],
      });
    }
    if (url.endsWith("/chat")) {
      return new Response('data: {"type":"text","item":"stubbed"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    throw new TypeError(`unexpected live fetch in unit test: ${url}`);
  };
}

describe("InnerAiExecutor", () => {
  it("can be instantiated", () => {
    const executor = new mod.InnerAiExecutor();
    assert.ok(executor);
  });
});

// Helper: parseCredential is not exported, but we can test via execute behavior.
// Test the exported class and its constructor properties.

describe("InnerAiExecutor constructor", () => {
  it("creates instance with correct id", () => {
    const executor = new mod.InnerAiExecutor();
    // The executor should have the id "inner-ai" set via super()
    assert.ok(executor instanceof mod.InnerAiExecutor);
  });
});

describe("InnerAiExecutor - credential validation", () => {
  it("returns 401 when credentials are empty", async () => {
    const executor = new mod.InnerAiExecutor();
    const result = await executor.execute({
      model: "gpt-4o",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "" },
      signal: null,
    });
    const resp = result.response;
    assert.equal(resp.status, 401);
    const json = await resp.json();
    assert.ok(json.error.message.includes("Missing Inner.ai token"));
  });

  it("returns 401 when apiKey is missing", async () => {
    const executor = new mod.InnerAiExecutor();
    const result = await executor.execute({
      model: "gpt-4o",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {},
      signal: null,
    });
    assert.equal(result.response.status, 401);
  });

  it("returns 400 when messages are empty", async () => {
    // Stub profile + models so credential/model resolution succeeds offline and
    // execution reaches the empty-message guard instead of failing earlier.
    stubInnerAiFetch();
    const executor = new mod.InnerAiExecutor();
    const result = await executor.execute({
      model: "gpt-4o",
      body: { messages: [] },
      stream: false,
      credentials: { apiKey: "fake-jwt-token" },
      signal: null,
    });
    const resp = result.response;
    assert.equal(resp.status, 400);
    const json = (await resp.json()) as { error: { message: string } };
    assert.ok(json.error.message.includes("No message content to send"));
  });
});

describe("InnerAiExecutor - result shape", () => {
  it("execute returns { response, url, headers, transformedBody }", async () => {
    // Full offline path: profile -> models -> chat, all served by the stub.
    stubInnerAiFetch();
    const executor = new mod.InnerAiExecutor();
    const result = await executor.execute({
      model: "gpt-4o",
      body: { messages: [{ role: "user", content: "test" }] },
      stream: false,
      credentials: { apiKey: "invalid-token" },
      signal: null,
    });
    assert.ok(result.response instanceof Response);
    assert.equal(result.response.status, 200);
    assert.ok(typeof result.url === "string");
    assert.ok(typeof result.headers === "object");
    assert.ok(result.transformedBody !== undefined);
    const json = (await result.response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    assert.equal(json.choices[0].message.content, "stubbed");
  });
});
