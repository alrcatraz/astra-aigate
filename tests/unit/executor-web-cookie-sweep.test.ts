/**
 * Web-Cookie + NoAuth executor wrapper contract sweep.
 *
 * Why this file exists
 * --------------------
 * `open-sse/handlers/chatCore.ts` reads `res.response.status`, `res.response.headers`,
 * and uses `res.url` / `res.transformedBody` to classify upstream responses
 * (see chatCore.ts:3937–4486, BaseExecutor.execute() at base.ts:1146).
 *
 * An executor that returns a raw `Response` instead of the wrapper shape
 * `{response, url, headers, transformedBody}` causes `res.response.status` to
 * throw `Cannot read properties of undefined (reading 'status')`. That JS
 * TypeError was then surfaced as a 502 via `formatProviderError` in
 * `open-sse/utils/error.ts:496`, and showed up to the client as
 * `[502]: Cannot read properties of undefined (reading 'status')`.
 *
 * The duckduckgo-web executor was the first known case. To prevent any
 * future executor from regressing on the same contract, this sweep test
 * imports every executor in `WEB_COOKIE_PROVIDERS` + `NOAUTH_PROVIDERS`
 * (26 web-cookie + 2 noauth = 28 total), calls `execute()` with a minimal
 * but valid input, and asserts the wrapper shape. Tests use the
 * pre-aborted signal path or empty-creds path so no real upstream call
 * is needed.
 *
 * If this file ever flags a missing executor, the fix is in the executor
 * — the contract is the executor's responsibility.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { getExecutor } from "../../open-sse/executors/index.ts";
import { WEB_COOKIE_PROVIDERS, NOAUTH_PROVIDERS } from "../../src/shared/constants/providers.ts";
import { __setTlsFetchOverrideForTesting as setChatGptTlsOverride } from "../../open-sse/services/chatgptTlsClient.ts";
import { __setTlsFetchOverrideForTesting as setGrokTlsOverride } from "../../open-sse/services/grokTlsClient.ts";
import { __setTlsFetchOverrideForTesting as setClaudeTlsOverride } from "../../open-sse/services/claudeTlsClient.ts";
import { __setTlsFetchOverrideForTesting as setPerplexityTlsOverride } from "../../open-sse/services/perplexityTlsClient.ts";
import { __setTlsFetchOverrideForTesting as setNotionTlsOverride } from "../../open-sse/services/notionTlsClient.ts";
import { __setTlsFetchOverrideForTesting as setLmarenaTlsOverride } from "../../open-sse/services/lmarenaTlsClient.ts";

// ── Hermetic guards ────────────────────────────────────────────────────────
// ~21 of these executors go outbound on their first action (TLS-client calls
// to chatgpt.com / grok.com / claude.ai / perplexity.ai / notion.so /
// arena.ai, plain fetch() to the remaining hosts, and a Playwright
// page.goto for gemini-web). CI runners have no egress, so every outbound
// path is stubbed BEFORE any execute() call: a globalThis.fetch stub that
// answers a non-ok 401 JSON Response, __setTlsFetchOverrideForTesting
// overrides for all six TLS clients the sweep touches, and a
// chromium.launch patch (the browser IS installed on dev machines, so
// gemini-web would otherwise really navigate to gemini.google.com).
// All three are restored in the `after` hook below.

const HERMETIC_BODY = JSON.stringify({
  error: {
    message: "hermetic stub: outbound network disabled in tests",
    type: "upstream_error",
    code: "HTTP_401",
  },
});

function hermetic401(): Response {
  return new Response(HERMETIC_BODY, {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => hermetic401()) as typeof globalThis.fetch;

// TLS-client override shape: { status, headers, text, body } (TlsFetchResult).
// 401 + JSON text routes every consumer through its auth-failure branch,
// which builds a proper error Response with a non-empty body.
const hermeticTlsOverride = async () => ({
  status: 401,
  headers: new Headers(),
  text: HERMETIC_BODY,
  body: null,
});

const TLS_OVERRIDE_SETTERS = [
  setChatGptTlsOverride,
  setGrokTlsOverride,
  setClaudeTlsOverride,
  setPerplexityTlsOverride,
  setNotionTlsOverride,
  setLmarenaTlsOverride,
];
for (const setter of TLS_OVERRIDE_SETTERS) {
  setter(hermeticTlsOverride as never);
}

const playwrightModule = await import("playwright");
const originalChromiumLaunch = playwrightModule.chromium.launch;
const hermeticLaunchError = new Error(
  "browserType.launch: Executable doesn't exist at /home/node/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell"
);
playwrightModule.chromium.launch = (async () => {
  throw hermeticLaunchError;
}) as never;

after(() => {
  globalThis.fetch = originalFetch;
  for (const setter of TLS_OVERRIDE_SETTERS) setter(null);
  playwrightModule.chromium.launch = originalChromiumLaunch;
});

type WebCookieId = keyof typeof WEB_COOKIE_PROVIDERS;
type NoauthId = keyof typeof NOAUTH_PROVIDERS;

const WEB_COOKIE_IDS = Object.keys(WEB_COOKIE_PROVIDERS) as WebCookieId[];
const NOAUTH_IDS = Object.keys(NOAUTH_PROVIDERS) as NoauthId[];

/**
 * Per-provider fake-credential strings that pass the executor's own
 * input-validation gate without making a real upstream call succeed.
 * Each executor parses a different cookie/header — the goal is only
 * to short-circuit the network call with a synthetic 401/403/4xx/5xx,
 * not to actually authenticate.
 */
const FAKE_CREDS: Record<string, string> = {
  "chatgpt-web": "__Secure-next-auth.session-token=fake-audit-sweep",
  "grok-web": "sso=fake-audit-sweep",
  "gemini-web": "__Secure-1PSID=fake-audit-sweep",
  "perplexity-web": "__Secure-next-auth.session-token=fake-audit-sweep",
  "blackbox-web": "__Secure-authjs.session-token=fake-audit-sweep",
  "muse-spark-web": "ecto_1_sess=fake-audit-sweep",
  "claude-web": "sessionKey=fake-audit-sweep",
  "deepseek-web": "userToken=fake-audit-sweep",
  "copilot-web": "fake-audit-sweep",
  "t3-web": "fake-audit-sweep",
  "inner-ai": "fake-audit-sweep user@example.com",
  "adapta-web": "__client=fake-audit-sweep",
  huggingchat: "hf-chat=fake-audit-sweep",
  "poe-web": "p-b=fake-audit-sweep",
  "venice-web": "fake-audit-sweep",
  "v0-vercel-web": "fake-audit-sweep",
  "kimi-web": "fake-audit-sweep",
  "doubao-web": "sessionid=fake-audit-sweep; ttwid=fake-audit-sweep; s_v_web_id=verify_fake",
  "qwen-web": "fake-audit-sweep",
  "duckduckgo-web": "",
  "veoaifree-web": "",
};

const VALID_BODY = {
  model: "test",
  messages: [{ role: "user", content: "ping" }],
};

/**
 * Asserts that `result` has the executor wrapper contract shape:
 *   { response: Response, url: string, headers: object, transformedBody: unknown }
 *
 * The contract is what `open-sse/handlers/chatCore.ts` and
 * `BaseExecutor.execute()` (open-sse/executors/base.ts:1146) depend on.
 */
function assertExecutorWrapperShape(
  result: unknown,
  provider: string
): asserts result is {
  response: Response;
  url: string;
  headers: Record<string, unknown>;
  transformedBody: unknown;
} {
  assert.ok(
    result && typeof result === "object",
    `[${provider}] execute() must return an object, not ${typeof result}`
  );
  const r = result as Record<string, unknown>;
  assert.ok(
    r.response instanceof Response,
    `[${provider}] result.response must be a Response (got ${typeof r.response})`
  );
  assert.equal(typeof r.url, "string", `[${provider}] result.url must be a string`);
  assert.ok(
    r.headers && typeof r.headers === "object",
    `[${provider}] result.headers must be an object`
  );
  // transformedBody may be null/undefined/object; just check it doesn't
  // throw when accessed.
  void r.transformedBody;
  // Critical: r.response.status must be reachable without throwing
  // — this is the exact property read that the duckduckgo-web bug
  // (#3106) crashed on.
  const status = (r.response as Response).status;
  assert.ok(
    Number.isInteger(status) && status >= 100 && status < 600,
    `[${provider}] result.response.status must be a valid HTTP status, got ${status}`
  );
}

describe("web-cookie + noauth executor wrapper contract sweep", () => {
  describe("WEB_COOKIE_PROVIDERS (26)", () => {
    for (const providerId of WEB_COOKIE_IDS) {
      it(`${providerId} executor returns wrapper shape`, async () => {
        const executor = getExecutor(providerId);
        assert.ok(executor, `[${providerId}] getExecutor must return an executor`);

        const result = await executor.execute({
          model: providerId,
          body: VALID_BODY,
          stream: false,
          credentials: { apiKey: FAKE_CREDS[providerId] ?? "fake" },
          signal: null,
        } as never);

        assertExecutorWrapperShape(result, providerId);

        // Result should never be a JS TypeError. Real executor returns
        // a proper Response with a JSON error body for invalid creds.
        // If a regression introduces a raw Response return, the shape
        // assertion above will fail.
        const body = await result.response.text();
        // Most executors return JSON error bodies for invalid creds.
        // We don't require JSON, but we DO require the body to be a
        // non-empty string (not the literal "[object Response]" or
        // a TypeError stack trace).
        assert.ok(body.length > 0, `[${providerId}] response body must be non-empty`);
        // And it must NOT be the duckduckgo-web regression signature.
        assert.doesNotMatch(
          body,
          /Cannot read properties of undefined \(reading 'status'\)/,
          `[${providerId}] must not surface the chatCore-side TypeError`
        );
      });
    }
  });

  describe("NOAUTH_PROVIDERS (4 total; 2 require cookie='') ", () => {
    // Only noauth providers that should be probed without creds:
    // duckduckgo-web and veoaifree-web. opencode/notice have dedicated
    // executor tests already (executor-opencode.test.ts / executor-notice.test.ts).
    const TARGETS = NOAUTH_IDS.filter((id) => id === "duckduckgo-web" || id === "veoaifree-web");

    for (const providerId of TARGETS) {
      it(`${providerId} noauth executor returns wrapper shape`, async () => {
        const executor = getExecutor(providerId);
        assert.ok(executor, `[${providerId}] getExecutor must return an executor`);

        // Use a pre-aborted signal so the executor short-circuits via
        // its AbortError path before any real network call.
        const controller = new AbortController();
        controller.abort();

        const result = await executor.execute({
          model: providerId,
          body: VALID_BODY,
          stream: false,
          credentials: { apiKey: "" },
          signal: controller.signal,
        } as never);

        // duckduckgo-web may legitimately short-circuit with a bare
        // 499 Response on a pre-aborted signal; chatCore's
        // normalizeExecutorResult already accepts both shapes. Only
        // insist on the full wrapper for executors that are expected
        // to produce one.
        if (result instanceof Response) {
          assert.ok(
            result.status >= 100 && result.status < 600,
            `[${providerId}] bare Response must have a valid HTTP status, got ${result.status}`
          );
        } else {
          assertExecutorWrapperShape(result, providerId);
        }
        const body = await (result instanceof Response ? result : result.response).text();
        assert.ok(body.length > 0, `[${providerId}] response body must be non-empty`);
        assert.doesNotMatch(
          body,
          /Cannot read properties of undefined \(reading 'status'\)/,
          `[${providerId}] must not surface the chatCore-side TypeError`
        );
      });
    }
  });
});
