import type { QuotaDimension, QuotaWindow } from "./dimensions";

interface KnownPlanShape {
  provider: string;
  dimensions: QuotaDimension[];
  /**
   * The provider's smaller windows expressed as a fraction of the monthly
   * limit declared on the same dimension (e.g. Go Plus: 5h = 20 %, weekly =
   * 50 %, monthly = 100 %). Keeps the catalogue to one pool per model while
   * still surfacing the shorter windows.
   */
  windowFractions?: Partial<Record<QuotaWindow, number>>;
}

/**
 * OpenCode Go / Go Plus accounting (verified against the provider's own
 * meter, 2026-10):
 *
 *   - The subscription exposes ONE dollar meter per window: Go +$48/5h,
 *     $120/week, $240/month (that is 4x the Go tier's $12/$30/$60 because
 *     Go Plus is billed at 4x).
 *   - Every model has its own monthly pool expressed in *list-price dollars*
 *     (qwen3.8-flash $90, kimi-k3 $60, …). Consumption of a model is converted
 *     into meter units as `listCost * 240 / pool`, which is why a $0.47 kimi
 *     bill moves the meter by $1.88.
 *   - 5h and weekly are fractions of the same pool (20 % / 50 %).
 *
 * The pools below are catalogue defaults; a DB override (`provider_plans`)
 * wins, and the fetcher can refine them per connection from the provider's own
 * `allowance`/`list_cost` pair. Models absent here simply have no per-model
 * window — only the account meters apply, which is the safe direction.
 */
const OPENCODE_GO_BILLING_ANCHOR = "2026-10-22T06:08:40.000Z"; // plan period start (22nd 06:08 UTC)

const OPENCODE_GO_MODEL_POOLS: ReadonlyArray<[string, number]> = [
  ["deepseek-v4.1-flash", 160],
  ["glm-5.3-flash", 180],
  ["mimo-v2.6-flash", 120],
  ["qwen3.8-flash", 90],
  ["gpt-6-luna", 60],
  ["kimi-k3", 60],
];

function opencodeGoDimensions(): QuotaDimension[] {
  const account: QuotaDimension[] = [
    {
      unit: "usd",
      window: "5h",
      limit: 48,
      scope: "account",
      period: { kind: "rolling", hours: 5 },
    },
    {
      unit: "usd",
      window: "weekly",
      limit: 120,
      scope: "account",
      period: { kind: "calendar", unit: "week", weekStartsOn: "monday" },
    },
    {
      unit: "usd",
      window: "monthly",
      limit: 240,
      scope: "account",
      period: { kind: "billing", anchor: OPENCODE_GO_BILLING_ANCHOR },
    },
  ];
  const perModel: QuotaDimension[] = OPENCODE_GO_MODEL_POOLS.map(([model, limit]) => ({
    unit: "usd" as const,
    window: "monthly" as const,
    limit,
    scope: "model" as const,
    model,
    period: { kind: "billing" as const, anchor: OPENCODE_GO_BILLING_ANCHOR },
  }));
  return [...account, ...perModel];
}

const KNOWN_PLANS: Record<string, KnownPlanShape> = {
  "opencode-go": {
    provider: "opencode-go",
    dimensions: opencodeGoDimensions(),
    windowFractions: { "5h": 0.2, weekly: 0.5, monthly: 1 },
  },
  codex: {
    provider: "codex",
    dimensions: [
      { unit: "percent", window: "5h", limit: 100 },
      { unit: "percent", window: "weekly", limit: 100 },
    ],
  },
  // Claude Code (Pro / Max 5x / Max 20x) is a percentage-of-plan quota over a 5h
  // rolling window + a weekly cap, shared across Claude and Claude Code. The exact
  // token caps are not published and vary by task, so % is the practical unit; the
  // provider reports % used and fair-share attributes it across keys by local count.
  claude: {
    provider: "claude",
    dimensions: [
      { unit: "percent", window: "5h", limit: 100 },
      { unit: "percent", window: "weekly", limit: 100 },
    ],
  },
  glm: {
    provider: "glm",
    dimensions: [
      // limit=0 = desconhecido; documentado. Mantido para correta detecção pelo planResolver.
      // Sliding window / fair-share devem tratar limit=0 como "manual obrigatório".
      { unit: "tokens", window: "5h", limit: Number.EPSILON },
      { unit: "tokens", window: "weekly", limit: Number.EPSILON },
    ],
  },
  minimax: {
    provider: "minimax",
    // MiniMax token plan (platform.minimax.io/docs/token-plan): monthly allowance
    // enforced over 5h-rolling + weekly windows. Tiers (M3): Plus ~1.633B ($20),
    // Max ~5.053B ($50), Ultra ~9.796B ($120). EPSILON = pick your tier in "Limite".
    dimensions: [
      { unit: "tokens", window: "5h", limit: Number.EPSILON },
      { unit: "tokens", window: "weekly", limit: Number.EPSILON },
    ],
  },
  // DeepSeek is prepaid in USD — its balance API is already wired (deepseekQuotaFetcher)
  // and shown on the quota page. fair-share supports the `usd` unit (COUNTABLE_UNITS),
  // so set a USD budget here ("fixado por valor"); the proxy sums each key's USD cost.
  deepseek: {
    provider: "deepseek",
    dimensions: [{ unit: "usd", window: "monthly", limit: Number.EPSILON }],
  },
  bailian: {
    provider: "bailian",
    dimensions: [
      { unit: "percent", window: "5h", limit: 100 },
      { unit: "percent", window: "weekly", limit: 100 },
      { unit: "percent", window: "monthly", limit: 100 },
    ],
  },
  kimi: {
    provider: "kimi",
    dimensions: [{ unit: "requests", window: "hourly", limit: 1500 }],
  },
  // Kimi "coding" plan connections register under the `kimi-coding` slug, which
  // exposes no upstream balance API. EPSILON = "unknown, set the real plan limit
  // manually in the Wizard 'Limite' step" (same convention as glm/minimax).
  "kimi-coding": {
    provider: "kimi-coding",
    dimensions: [
      { unit: "tokens", window: "5h", limit: Number.EPSILON },
      { unit: "tokens", window: "weekly", limit: Number.EPSILON },
    ],
  },
  // Xiaomi MiMo token plan (platform.xiaomimimo.com/token-plan) is a MONTHLY
  // allowance with no balance API. Default seeds the "lite" plan's 4.1B-token
  // monthly cap so the Wizard pre-fills a usable fair-share limit; adjust in the
  // "Limite" step to match the connection's actual plan.
  "xiaomi-mimo": {
    provider: "xiaomi-mimo",
    dimensions: [{ unit: "tokens", window: "monthly", limit: 4_100_000_000 }],
  },
  // Xiaomi MiMo Token Plan (token-plan-sgp): same MONTHLY allowance with no
  // balance API as the regular account plan. Adjust in the Wizard's "Limite"
  // step when the connection is on a different plan.
  "xiaomi-mimo-token-plan": {
    provider: "xiaomi-mimo-token-plan",
    dimensions: [{ unit: "tokens", window: "monthly", limit: 4_100_000_000 }],
  },
  alibaba: {
    provider: "alibaba",
    dimensions: [{ unit: "requests", window: "monthly", limit: 90_000 }],
  },
  // Grok Build (xAI) — rate limits from x-ratelimit-* headers:
  // Daily: 864 requests, 18M tokens (from API headers)
  // Weekly: derived from daily * 7
  // #6844: this static estimate is now the fallback used only when the live
  // grok-cli quota fetcher (open-sse/services/grokCliQuotaFetcher.ts) returns
  // null (both credentials missing and upstream fetch/parse failures fail
  // open to this static plan) — the shared weekly percent-based credit pool
  // it estimates is not observable from local request/token counters alone.
  "grok-cli": {
    provider: "grok-cli",
    dimensions: [
      { unit: "requests", window: "daily", limit: 864 },
      { unit: "tokens", window: "daily", limit: 18_000_000 },
      { unit: "requests", window: "weekly", limit: 6048 },
      { unit: "tokens", window: "weekly", limit: 126_000_000 },
    ],
  },
};

export function getKnownPlan(provider: string): KnownPlanShape | null {
  return KNOWN_PLANS[provider] ?? null;
}

export function knownProviders(): readonly string[] {
  return Object.keys(KNOWN_PLANS);
}
