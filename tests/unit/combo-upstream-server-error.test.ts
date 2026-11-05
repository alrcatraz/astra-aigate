// Upstream failures that arrive as HTTP 400 must not end the attempt on the
// preferred model (measured: 169 of the recorded 400s were
// "Upstream request failed: [server_error] Upstream response was not valid JSON",
// while genuine bad requests in the same logs say "Unsupported value", "Model does
// not exist" or "unsupported image").

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-400class-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const { handleComboChat } = await import("../../open-sse/services/combo.ts");
const core = await import("../../src/lib/db/core.ts");
const { resetAllComboMetrics } = await import("../../open-sse/services/comboMetrics.ts");
const { resetAllCircuitBreakers } = await import("../../src/shared/utils/circuitBreaker.ts");
const { resetAll: resetAllSemaphores } =
  await import("../../open-sse/services/rateLimitSemaphore.ts");
const { _resetAllDecks } = await import("../../src/shared/utils/shuffleDeck.ts");
const { clearSessions } = await import("../../open-sse/services/sessionManager.ts");

const MODELS = ["openai/gpt-4o-mini", "claude/sonnet", "gemini/flash"];

function createLog() {
  const push = () => () => {};
  return { info: push(), warn: push(), error: push(), debug: push() };
}

const okResponse = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const errorResponse = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

function combo(name: string) {
  return {
    name,
    strategy: "priority",
    models: MODELS,
    config: { maxRetries: 2, retryDelayMs: 0, fallbackDelayMs: 0 },
  };
}

const body = () => ({ model: MODELS[0], messages: [{ role: "user", content: "hi" }] });

test.beforeEach(() => {
  resetAllComboMetrics();
  resetAllCircuitBreakers();
  resetAllSemaphores();
  _resetAllDecks();
  clearSessions();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
});

test("an upstream server_error 400 gets retried on the same model", async () => {
  const dispatched: string[] = [];

  await handleComboChat({
    body: body(),
    combo: combo("retry-400-server-error"),
    handleSingleModel: async (_received: Record<string, unknown>, modelStr: string) => {
      dispatched.push(modelStr);
      if (modelStr === MODELS[0] && dispatched.length === 1) {
        return errorResponse(
          400,
          "Upstream request failed: [server_error] Upstream response was not valid JSON"
        );
      }
      return okResponse();
    },
    isModelAvailable: async () => true,
    log: createLog(),
    settings: null,
    allCombos: null,
  } as never);

  assert.equal(
    dispatched.filter((m) => m === MODELS[0]).length,
    2,
    `expected one retry on ${MODELS[0]}, dispatched: ${JSON.stringify(dispatched)}`
  );
});

test("the server_error 400 class gets one retry, not the whole budget", async () => {
  const dispatched: string[] = [];

  await handleComboChat({
    body: body(),
    combo: combo("retry-400-budget"),
    handleSingleModel: async (_received: Record<string, unknown>, modelStr: string) => {
      dispatched.push(modelStr);
      if (modelStr === MODELS[0]) {
        return errorResponse(400, "[server_error] Upstream response was not valid JSON");
      }
      return okResponse();
    },
    isModelAvailable: async () => true,
    log: createLog(),
    settings: null,
    allCombos: null,
  } as never);

  assert.equal(
    dispatched.filter((m) => m === MODELS[0]).length,
    2,
    `two attempts on a persistently broken upstream is pure latency: ${JSON.stringify(dispatched)}`
  );
  assert.equal(
    dispatched[dispatched.length - 1],
    MODELS[1],
    "the request must still fall through and succeed on the next model"
  );
});

test("a genuine bad-request 400 is not retried", async () => {
  const dispatched: string[] = [];

  await handleComboChat({
    body: body(),
    combo: combo("no-retry-400-client"),
    handleSingleModel: async (_received: Record<string, unknown>, modelStr: string) => {
      dispatched.push(modelStr);
      if (modelStr === MODELS[0]) {
        return errorResponse(400, "Unsupported value: 'minimal' is not supported");
      }
      return okResponse();
    },
    isModelAvailable: async () => true,
    log: createLog(),
    settings: null,
    allCombos: null,
  } as never);

  assert.equal(
    dispatched.filter((m) => m === MODELS[0]).length,
    1,
    `a client-side 400 must not be retried: ${JSON.stringify(dispatched)}`
  );
});
