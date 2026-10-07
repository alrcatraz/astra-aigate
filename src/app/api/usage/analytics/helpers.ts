/**
 * Aggregation helpers for the usage analytics route: value coercion, cost
 * rounding/pricing resolution and row grouping. Extracted from route.ts.
 */

export type PricingByProvider = Record<string, Record<string, Record<string, unknown>>>;
export type UsageRows = Array<Record<string, unknown>>;
export type ComputeCostFromPricing = (
  pricing: Record<string, unknown> | null | undefined,
  tokens: Record<string, number | undefined> | null | undefined,
  options?: Record<string, unknown>
) => number;
export type GetCodexFastCostMultiplier = (
  provider: string | null | undefined,
  model: string | null | undefined,
  serviceTier: string | null | undefined
) => number;

/** 0.6.0 — cost pair { amount, currency } in the provider's billing currency. */
export type CostWithCurrency = { amount: number; currency: "USD" | "CNY" };
export type ComputeCostWithCurrency = (
  pricing: Record<string, unknown> | null | undefined,
  tokens: Record<string, number | undefined> | null | undefined,
  options?: Record<string, unknown>
) => CostWithCurrency;

export function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizeServiceTier(value: unknown): "standard" | "priority" | "flex" {
  const tier = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (tier === "priority" || tier === "fast") return "priority";
  if (tier === "flex") return "flex";
  return "standard";
}

export function getServiceTierLabelId(serviceTier: string): string {
  return normalizeServiceTier(serviceTier);
}

export function appendWhereCondition(whereClause: string, condition: string): string {
  return whereClause ? `${whereClause} AND (${condition})` : `WHERE (${condition})`;
}

export function findKeyInsensitive(obj: Record<string, any> | undefined | null, key: string): any {
  if (!obj || !key) return undefined;
  return obj[key.toLowerCase()];
}

export function uniqueValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function makeApiKeyUsageGroup(apiKeyId: string, fallbackName: string): string {
  return apiKeyId ? `id:${apiKeyId}` : `name:${fallbackName}`;
}

export function addApiKeyAlias(target: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) target.add(trimmed);
}

export function stripCodexEffortSuffix(model: string): string {
  return model.replace(/-(?:xhigh|high|medium|low|none)$/i, "");
}

export function getPricingModelCandidates(
  model: string,
  normalizeModelName: (model: string) => string
): string[] {
  const normalizedModel = normalizeModelName(model);
  const lowerModel = model.toLowerCase();
  const lowerNormalized = normalizedModel.toLowerCase();
  const hyphenModel = lowerModel.replace(/\./g, "-");
  const hyphenNormalized = lowerNormalized.replace(/\./g, "-");
  const effortBaseModel = stripCodexEffortSuffix(lowerNormalized);

  return uniqueValues([
    lowerModel,
    lowerNormalized,
    hyphenModel,
    hyphenNormalized,
    effortBaseModel,
    effortBaseModel.replace(/\./g, "-"),
    lowerNormalized === "codex-auto-review" ? "gpt-5.5" : null,
  ]);
}

export function resolveModelPricing(
  pricingByProvider: PricingByProvider,
  providerAliasMap: Record<string, string>,
  providerRaw: string,
  model: string,
  normalizeModelName: (model: string) => string
): Record<string, unknown> | null {
  const pLower = (providerRaw || "").toLowerCase();

  let providerPricing = findKeyInsensitive(pricingByProvider, pLower);

  if (!providerPricing) {
    // providerAliasMap maps ID -> ALIAS. So if pLower is "codex", alias is "cx".
    const alias = providerAliasMap[pLower];
    if (alias) {
      providerPricing = findKeyInsensitive(pricingByProvider, alias);
    }
  }

  if (!providerPricing) {
    // In case pLower was ALIAS and we want to try the ID (reverse search values)
    for (const [id, alias] of Object.entries(providerAliasMap)) {
      if (alias.toLowerCase() === pLower) {
        providerPricing = findKeyInsensitive(pricingByProvider, id);
        if (providerPricing) break;
      }
    }
  }

  if (!providerPricing) {
    const np = pLower.replace(/-cn$/, "");
    if (np && np !== pLower) {
      providerPricing = findKeyInsensitive(pricingByProvider, np);
    }
  }

  // Hardcoded known fallbacks
  if (!providerPricing) {
    if (pLower === "antigravity") providerPricing = findKeyInsensitive(pricingByProvider, "ag");
  }

  const modelCandidates = getPricingModelCandidates(model, normalizeModelName);

  const tryFind = (prov: Record<string, unknown> | null | undefined) => {
    if (!prov || typeof prov !== "object") return null;
    for (const candidate of modelCandidates) {
      const pricing = findKeyInsensitive(prov as Record<string, unknown>, candidate);
      if (pricing) return pricing;
    }
    return null;
  };

  let pricing = providerPricing ? tryFind(providerPricing) : null;

  if (!pricing) {
    // Global fallback: search all providers for this exact model (helps with aliases)
    for (const prov of Object.values(pricingByProvider)) {
      const found = tryFind(prov as Record<string, unknown>);
      if (found) {
        pricing = found;
        break;
      }
    }
  }

  // Last resort fallback for historical usage (e.g. "gpt-4" missing, matches "gpt-4.1" or first available)
  if (!pricing && providerPricing && typeof providerPricing === "object") {
    for (const [key, val] of Object.entries(providerPricing as Record<string, unknown>)) {
      const lm = model.toLowerCase();
      if (key.includes(lm) || lm.includes(key)) {
        pricing = val;
        break;
      }
    }
    if (!pricing) {
      const keys = Object.keys(providerPricing as Record<string, unknown>);
      if (keys.length > 0) pricing = (providerPricing as Record<string, unknown>)[keys[0]];
    }
  }

  return pricing as Record<string, unknown> | null;
}
