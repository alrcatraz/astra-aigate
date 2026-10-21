import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../open-sse/executors/poe-web.ts");

// Hermetic: unit tests must never open a socket to poe.com (CI runners have no
// egress; a live attempt can block for minutes). The original global fetch is
// restored after every case so later tests see the stock runtime.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("PoeWebExecutor", () => {
  it("can be instantiated", () => {
    const executor = new mod.PoeWebExecutor();
    assert.ok(executor);
  });

  it("execute returns error on fetch failure", async () => {
    // Stub the exact failure the executor's catch branch expects: a rejected
    // fetch with TypeError("fetch failed"). No live POST to
    // https://www.poe.com/api/gql_POST is issued.
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    const executor = new mod.PoeWebExecutor();
    const result = await executor.execute({
      model: "poe-default",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "" },
      signal: null,
    });
    assert.ok(result.response instanceof Response);
    // Executor catch branch: makeExecutorErrorResult(502, "Poe fetch failed: …", body, GQL_URL)
    assert.equal(result.response.status, 502);
    const errBody = (await result.response.json()) as {
      error: { message: string; code: string };
    };
    assert.equal(errBody.error.message, "Poe fetch failed: fetch failed");
    assert.equal(errBody.error.code, "HTTP_502");
    // Parse the host instead of substring-matching the URL: a bare
    // `.includes("poe.com")` would also accept hostile URLs like
    // `https://evil.com/?x=poe.com` (CodeQL js/incomplete-url-substring-sanitization).
    const host = new URL(result.url).hostname;
    assert.ok(host === "poe.com" || host.endsWith(".poe.com"), `unexpected host: ${host}`);
  });
});
