/**
 * Per-model quota windows for OpenCode Go.
 *
 * The windows must come from the provider's own per-model cost divided by the
 * plan's pool for that model — no local price table, no token counting. These
 * tests pin the arithmetic, the window anchoring (5h rolling / calendar week /
 * billing month), the explicit `scope: "model"` marking, and the fail-open
 * behaviour when the console API rejects the key.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchOpencodeQuota,
  invalidateOpencodeQuotaCache,
} from "../../open-sse/services/opencodeQuotaFetcher.ts";
import { _clearConsoleUsageCache } from "../../open-sse/services/opencodeConsoleUsage.ts";

const originalFetch = globalThis.fetch;

const ACCOUNT_USAGE = {
  rolling: { status: "ok", percent: 11, resetsAt: "2026-10-28T08:16:19.000Z" },
  weekly: { status: "ok", percent: 28, resetsAt: "2026-11-02T00:00:00.000Z" },
  monthly: { status: "ok", percent: 31, resetsAt: "2026-11-22T06:08:40.000Z" },
};

interface ConsoleCall {
  since: string;
}

function installStub(options: {
  consoleStatus?: number;
  consoleItems?: Array<{ model: string; totalCostMicroCents: string; totalRequests: string }>;
  nowMs: number;
}) {
  const consoleCalls: ConsoleCall[] = [];
  const fakeNow = options.nowMs;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/console/api/usage/models")) {
      const parsed = new URL(url);
      consoleCalls.push({ since: parsed.searchParams.get("since") ?? "" });
      if (options.consoleStatus && options.consoleStatus !== 200) {
        return new Response(JSON.stringify({ _tag: "Forbidden" }), {
          status: options.consoleStatus,
        });
      }
      return new Response(JSON.stringify({ items: options.consoleItems ?? [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // official account usage endpoint
    return new Response(JSON.stringify({ usage: ACCOUNT_USAGE }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { consoleCalls, fakeNow };
}

const NOW = Date.parse("2026-10-28T12:34:56.000Z");

function items(model: string, usd: number) {
  return {
    model,
    totalCostMicroCents: String(Math.round(usd * 1e8)),
    totalRequests: "10",
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _clearConsoleUsageCache();
});

test("per-model windows use the provider cost and the plan pool per window fraction", async () => {
  const { consoleCalls } = installStub({
    nowMs: NOW,
    consoleItems: [items("qwen3.8-flash", 4.5), items("kimi-k3", 30)],
  });
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    invalidateOpencodeQuotaCache("conn-1");
    const quota = await fetchOpencodeQuota(
      "conn-1",
      { apiKey: "oc_sk_test" },
      {
        provider: "opencode-go",
      }
    );
    assert.ok(quota, "quota should be parsed");

    // account windows keep their explicit scope
    const account = quota.windows?.["window_monthly"];
    assert.equal(account?.scope, "account");
    assert.equal(account?.source, "provider_reported");

    // 5h: 20 % of the $90 qwen pool = $18 → $4.50 is 25 %
    const qwen5h = quota.windows?.["5h:qwen3.8-flash"];
    assert.ok(qwen5h, "expected a 5h model window");
    assert.equal(qwen5h.scope, "model");
    assert.equal(qwen5h.model, "qwen3.8-flash");
    assert.equal(qwen5h.limitUsd, 18);
    assert.equal(qwen5h.usedUsd, 4.5);
    assert.ok(Math.abs((qwen5h.percentUsed ?? 0) - 0.25) < 1e-9);

    // weekly: 50 % of $90 = $45
    assert.equal(quota.windows?.["weekly:qwen3.8-flash"]?.limitUsd, 45);
    // monthly: full pool
    assert.equal(quota.windows?.["monthly:qwen3.8-flash"]?.limitUsd, 90);
    assert.ok(Math.abs((quota.windows?.["monthly:qwen3.8-flash"]?.percentUsed ?? 0) - 0.05) < 1e-9);

    // kimi pool is $60 → monthly 30/60 = 50 %
    assert.ok(Math.abs((quota.windows?.["monthly:kimi-k3"]?.percentUsed ?? 0) - 0.5) < 1e-9);

    // models outside the catalogue get no model window (only account meters)
    assert.equal(quota.windows?.["monthly:unknown-model"], undefined);

    // one console call per window, each anchored differently
    assert.equal(consoleCalls.length, 3);
    const [rolling, weekly, monthly] = consoleCalls.map((c) => c.since);
    assert.equal(rolling, new Date(NOW - 5 * 3600_000).toISOString());
    assert.equal(weekly, "2026-10-26T00:00:00.000Z"); // Monday of that week, UTC
    assert.equal(monthly, "2026-10-22T06:08:40.000Z"); // billing period start
  } finally {
    Date.now = realNow;
  }
});

test("fail-open: a rejected console key leaves only the account windows", async () => {
  installStub({ nowMs: NOW, consoleStatus: 403 });
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    invalidateOpencodeQuotaCache("conn-2");
    const quota = await fetchOpencodeQuota(
      "conn-2",
      { apiKey: "oc_sk_test" },
      {
        provider: "opencode-go",
      }
    );
    assert.ok(quota);
    assert.equal(quota.windows?.["window_5h"]?.scope, "account");
    const modelWindows = Object.keys(quota.windows ?? {}).filter((k) => k.includes(":"));
    assert.deepEqual(modelWindows, []);
  } finally {
    Date.now = realNow;
  }
});

test("providers without a plan publish no model windows", async () => {
  const { consoleCalls } = installStub({ nowMs: NOW, consoleItems: [items("qwen3.8-flash", 1)] });
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    invalidateOpencodeQuotaCache("conn-3");
    const quota = await fetchOpencodeQuota(
      "conn-3",
      { apiKey: "oc_sk_test" },
      {
        provider: "opencode-zen",
      }
    );
    assert.ok(quota);
    const modelWindows = Object.keys(quota.windows ?? {}).filter((k) => k.includes(":"));
    assert.deepEqual(modelWindows, []);
    assert.equal(consoleCalls.length, 0);
  } finally {
    Date.now = realNow;
  }
});
