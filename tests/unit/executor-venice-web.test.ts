import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../open-sse/executors/venice-web.ts");

// Hermetic: unit tests must never open a socket to venice.ai (CI runners have
// no egress; a live attempt can block for minutes). The original global fetch
// is restored after every case so later tests see the stock runtime.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("VeniceWebExecutor", () => {
  it("can be instantiated", () => {
    const executor = new mod.VeniceWebExecutor();
    assert.ok(executor);
  });

  it("execute returns error on fetch failure", async () => {
    // Stub the exact failure the executor's catch branch expects: a rejected
    // fetch with TypeError("fetch failed"). No live POST to
    // https://venice.ai/api/chat is issued.
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    const executor = new mod.VeniceWebExecutor();
    const result = await executor.execute({
      model: "venice-default",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "" },
      signal: null,
    });
    assert.ok(result.response instanceof Response);
    // Executor catch branch: makeExecutorErrorResult(502, "Venice fetch failed: …", body, CHAT_URL)
    assert.equal(result.response.status, 502);
    const errBody = (await result.response.json()) as {
      error: { message: string; code: string };
    };
    assert.equal(errBody.error.message, "Venice fetch failed: fetch failed");
    assert.equal(errBody.error.code, "HTTP_502");
    assert.ok(typeof result.url === "string");
    assert.ok(result.url.includes("venice.ai"));
  });
});
