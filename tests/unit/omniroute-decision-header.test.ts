import test from "node:test";
import assert from "node:assert/strict";
import { OMNIROUTE_RESPONSE_HEADERS } from "../../src/shared/constants/headers.ts";
import {
  buildOmniRouteDecisionHeaderValue,
  buildOmniRouteResponseMetaHeaders,
} from "../../src/domain/omnirouteResponseMeta.ts";
import { assembleStreamingResponseHeaders } from "../../open-sse/handlers/chatCore/streamingResponseHeaders.ts";
import { buildNonStreamingResponseHeaders } from "../../open-sse/handlers/chatCore/nonStreamingResponseHeaders.ts";

// The response-meta header family was renamed X-OmniRoute-* -> X-AI-Gate-*
// (fe247769 "legal response headers"): the literal is now resolved from the
// exported constant so a future rename cannot silently desync this suite.
const DECISION_HEADER = OMNIROUTE_RESPONSE_HEADERS.decision;

test("headers constant exposes the decision key", () => {
  assert.equal(DECISION_HEADER, "X-AI-Gate-Decision");
});

test("buildOmniRouteResponseMetaHeaders emits the decision header for a combo strategy", () => {
  const headers = buildOmniRouteResponseMetaHeaders({
    strategy: "priority",
    provider: "openai",
    model: "gpt-4o",
    latencyMs: 42,
  });
  assert.equal(headers[DECISION_HEADER], "strategy=priority; provider=openai; latency_ms=42");
});

test("strategy: single (non-combo request) still emits the header", () => {
  const headers = buildOmniRouteResponseMetaHeaders({
    strategy: "single",
    provider: "anthropic",
    latencyMs: 10,
  });
  assert.equal(headers[DECISION_HEADER], "strategy=single; provider=anthropic; latency_ms=10");
});

test("omitted strategy AND provider -> header absent entirely", () => {
  const headers = buildOmniRouteResponseMetaHeaders({ model: "gpt-4o" });
  assert.equal(DECISION_HEADER in headers, false);
});

test("control characters in strategy are stripped, no header-injection / leak surface", () => {
  const value = buildOmniRouteDecisionHeaderValue({
    strategy: "prio\r\nrity",
    provider: "openai",
    latencyMs: 5,
  });
  assert.ok(value !== null);
  assert.equal(/[\r\n]/.test(value as string), false);
  assert.equal((value as string).includes("Error:"), false);
  assert.equal((value as string).includes(" at /"), false);
});

test("assembleStreamingResponseHeaders includes the decision header with strategy=fusion", () => {
  const providerHeaders = new Headers();
  const headers = assembleStreamingResponseHeaders({
    providerHeaders,
    provider: "openai",
    model: "gpt-4o",
    pendingRequestId: "req-1",
    comboStrategy: "fusion",
  });
  assert.equal(headers[DECISION_HEADER], "strategy=fusion; provider=openai; latency_ms=0");
});

test("buildNonStreamingResponseHeaders falls back to strategy=single when comboStrategy is null", () => {
  const headers = buildNonStreamingResponseHeaders({
    provider: "openai",
    model: "gpt-4o",
    startTime: Date.now(),
    responseUsage: null,
    estimatedCost: 0,
    requestId: "req-2",
    comboStrategy: null,
  });
  assert.match(headers[DECISION_HEADER], /^strategy=single; provider=openai; latency_ms=\d+$/);
});
