/**
 * currency.ts — Billing-currency model for cost/usage accounting (0.6.0).
 *
 * Core design (PLAN.md 0.6.0): costs are accounted in each provider's REAL
 * billing currency — a ¥-priced platform (SiliconFlow cn, DMXAPI cn, Zhipu)
 * has its costs in CNY, a $-priced platform (Mistral, HuggingFace, …) in
 * USD. The exchange rate appears ONLY at the aggregation/display layer as a
 * reference conversion — never in storage. This avoids stacking platform
 * fixed-conversion errors on top of live exchange rates.
 *
 * Sources of truth:
 * - Provider billing currency: `usageConfigs.quotaCurrency` (already encodes
 *   dmxapi-cn/siliconflow-cn = CNY, dmxapi-com/ssvip/siliconflow = USD) +
 *   the CNY_BILLING_PROVIDERS overrides below (zhipu/cn regions) + USD
 *   default.
 * - Exchange rate: settings KV `fxRateUsdCny` (user-configurable), falling
 *   back to DEFAULT_USD_CNY_RATE.
 */

import { getUsageConfig } from "@/shared/constants/providers/usageConfigs";

export type BillingCurrency = "USD" | "CNY";

export const DEFAULT_USD_CNY_RATE = 7.1;

/**
 * Providers that bill in CNY but are NOT covered by usageConfigs.quotaCurrency
 * (zhipu's region-driven base URL has no quotaCurrency entry). Kept as an
 * explicit allowlist so adding a CNY-priced platform is a one-line change.
 */
const CNY_BILLING_PROVIDERS: ReadonlySet<string> = new Set(["zhipu", "glm", "bigmodel"]);

/** settings KV key for the user-configurable USD→CNY reference rate. */
export const FX_RATE_USD_CNY_KEY = "fxRateUsdCny";

/**
 * Resolve a provider's billing currency. Uses usageConfigs.quotaCurrency when
 * present (authoritative, per-provider), then the CNY allowlist, then USD.
 *
 * Sync variant of the resolver — usageConfigs is a pure constant module so
 * this can be imported directly without a cycle (it has no DB/async deps).
 */
export function getProviderBillingCurrency(provider: string | null | undefined): BillingCurrency {
  if (!provider) return "USD";
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return "USD";

  // usageConfigs.quotaCurrency is the authoritative per-provider source
  // (dmxapi-cn/siliconflow-cn = CNY, dmxapi-com/ssvip/siliconflow = USD).
  const config = getUsageConfig(normalized);
  if (config?.quotaCurrency === "CNY" || config?.quotaCurrency === "USD") {
    return config.quotaCurrency;
  }

  if (CNY_BILLING_PROVIDERS.has(normalized)) return "CNY";
  return "USD";
}

/**
 * Read the configured USD→CNY reference rate. **Defined in `currencySettings.ts`**
 * (0.6.0 build fix): this module is imported by the frontend bundle (for
 * `convertAmount` / `BillingCurrency`), so it MUST stay free of any `@/lib/db/*`
 * import — that chain pulls `fs`-dependent dataPaths into the browser bundle.
 * Backend code (API routes) imports `getFxRateUsdCny` from `./currencySettings`.
 */

/**
 * Convert an amount between USD and CNY using the configured reference rate.
 * `from`/`to` are the two supported currencies; a no-op when they match.
 */
export function convertAmount(
  amount: number,
  from: BillingCurrency,
  to: BillingCurrency,
  rateUsdCny: number = DEFAULT_USD_CNY_RATE
): number {
  if (from === to) return amount;
  if (!Number.isFinite(amount)) return 0;
  // Only USD↔CNY conversions exist today; CNY→USD divides by the rate.
  return from === "USD" ? amount * rateUsdCny : amount / rateUsdCny;
}

/** Round a cost to the display precision (4 dp) used across the UI. */
export function roundCost(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e4) / 1e4;
}
