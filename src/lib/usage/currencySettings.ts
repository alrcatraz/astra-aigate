/**
 * currencySettings.ts — settings-backed pieces of the billing-currency model.
 *
 * Split from currency.ts (0.6.0) so the pure currency helpers stay free of any
 * Node-only / DB dependency: the frontend bundle imports `convertAmount` etc.
 * from currency.ts; importing that module must NOT pull `@/lib/db/settings`
 * (and its `fs`-dependent dataPaths chain) into a browser bundle. Only this
 * module touches the DB.
 *
 * See PLAN.md 0.6.0 for the dual-currency design.
 */
import { FX_RATE_USD_CNY_KEY, DEFAULT_USD_CNY_RATE } from "./currency";

/**
 * Read the configured USD→CNY reference rate. Async because the settings KV
 * lives in the DB; callers in hot paths should cache the value. Falls back to
 * DEFAULT_USD_CNY_RATE on any failure (unconfigured, DB down, parse error).
 */
export async function getFxRateUsdCny(): Promise<number> {
  try {
    const { getSettings } = await import("@/lib/db/settings");
    const settings = await getSettings();
    const raw = (settings as Record<string, unknown>)[FX_RATE_USD_CNY_KEY];
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    // fall back to default
  }
  return DEFAULT_USD_CNY_RATE;
}
