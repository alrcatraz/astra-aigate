import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCompletionBodySchema } from "@/shared/validation/schemas/chatCompletion";
import {
  proxySubscriptionCreateSchema,
  proxySubscriptionUpdateSchema,
} from "@/shared/validation/schemas/proxySubscription";

test("chatCompletionBodySchema accepts a normal chat body", () => {
  const r = chatCompletionBodySchema.safeParse({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.5,
    stream: false,
  });
  assert.equal(r.success, true);
});

test("chatCompletionBodySchema passes through provider-specific fields untouched", () => {
  const r = chatCompletionBodySchema.safeParse({
    model: "m",
    messages: [{ role: "user", content: "x" }],
    custom_provider_field: { nested: 1 },
    tools: [{ type: "function" }],
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.custom_provider_field, { nested: 1 });
});

test("chatCompletionBodySchema rejects non-string model (type error -> 400)", () => {
  const r = chatCompletionBodySchema.safeParse({ model: 42, messages: [] });
  assert.equal(r.success, false);
});

test("chatCompletionBodySchema rejects missing discriminator (no messages/input/prompt)", () => {
  const r = chatCompletionBodySchema.safeParse({ model: "m" });
  assert.equal(r.success, false);
});

test("chatCompletionBodySchema rejects non-array messages (type error -> 400)", () => {
  const r = chatCompletionBodySchema.safeParse({ model: "m", messages: "not-an-array" });
  assert.equal(r.success, false);
});

test("proxySubscriptionCreateSchema enforces rule-mode requires ruleProviders", () => {
  const r = proxySubscriptionCreateSchema.safeParse({
    name: "n",
    url: "https://x",
    mode: "rule",
    ruleProviders: [],
  });
  assert.equal(r.success, false);
});

test("proxySubscriptionCreateSchema applies defaults (enabled=false, interval=60, mode=global)", () => {
  const r = proxySubscriptionCreateSchema.safeParse({ name: " n ", url: " https://x " });
  assert.equal(r.success, true);
  assert.equal(r.data.name, "n"); // trimmed
  assert.equal(r.data.url, "https://x"); // trimmed
  assert.equal(r.data.mode, "global");
  assert.equal(r.data.enabled, false);
  assert.equal(r.data.updateIntervalMinutes, 60);
  assert.equal(r.data.ruleProviders, null);
  assert.equal(r.data.localCoreEndpoint, null);
});

test("proxySubscriptionUpdateSchema rejects unknown keys (drops them, strict)", () => {
  const r = proxySubscriptionUpdateSchema.safeParse({ name: "n", bogus: 1 });
  assert.equal(r.success, false); // strict -> unknown key is a 400
});

test("proxySubscriptionUpdateSchema accepts a partial update", () => {
  const r = proxySubscriptionUpdateSchema.safeParse({ enabled: true, mode: "rule" });
  assert.equal(r.success, true);
  assert.deepEqual(r.data, { enabled: true, mode: "rule" });
});
