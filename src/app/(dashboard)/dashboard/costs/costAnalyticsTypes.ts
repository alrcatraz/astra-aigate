/**
 * Usage-analytics payload shapes for the cost overview tab, extracted from
 * CostOverviewTab.tsx.
 */

export interface UsageAnalyticsSummary {
  totalCost: number;
  totalCostUsd: number;
  totalCostCny: number;
  costCurrency: "USD" | "CNY";
  fxRateUsdCny: number;
  totalRequests: number;
  uniqueModels: number;
  uniqueAccounts: number;
  uniqueApiKeys: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  fallbackCount: number;
  fallbackRatePct: number;
  requestedModelCoveragePct: number;
  streak: number;
  flexRequests?: number;
  flexCost?: number;
  flexSavings?: number;
  flexUsageSavingsTokens?: number;
}

export interface UsageAnalyticsProviderRow {
  provider: string;
  requests: number;
  totalTokens: number;
  cost: number;
  currency?: "USD" | "CNY";
}

export interface UsageAnalyticsModelRow {
  model: string;
  requests: number;
  totalTokens: number;
  cost: number;
}

export interface UsageAnalyticsTrendRow {
  date: string;
  cost: number;
}

export interface UsageAnalyticsApiKeyRow {
  apiKey: string;
  apiKeyId: string | null;
  apiKeyName: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageAnalyticsAccountRow {
  account: string;
  totalTokens: number;
  requests: number;
  cost: number;
  currency?: "USD" | "CNY";
}

export interface UsageAnalyticsServiceTierRow {
  serviceTier: "standard" | "priority" | "flex";
  label: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  savings?: number;
  usageSavingsTokens?: number;
}

export interface UsageAnalyticsPayload {
  summary: UsageAnalyticsSummary;
  byProvider: UsageAnalyticsProviderRow[];
  byModel: UsageAnalyticsModelRow[];
  byApiKey: UsageAnalyticsApiKeyRow[];
  byAccount: UsageAnalyticsAccountRow[];
  byServiceTier?: UsageAnalyticsServiceTierRow[];
  dailyTrend: UsageAnalyticsTrendRow[];
  weeklyPattern: Array<{ day: string; avgTokens: number; totalTokens: number }>;
  activityMap: Record<string, number>;
  presetSummaries?: Record<string, { totalCost: number }>;
}
