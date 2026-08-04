/**
 * Provider usage/quota API configuration — single source of truth (PLAN 2.7).
 *
 * Consumed by:
 * - `open-sse/services/usage.ts` + `open-sse/services/usage/*.ts` — dispatch
 *   and fetchers read baseUrl/endpoint/authMode
 * - `EditConnectionModal` / `AgentrouterConsoleFields` — renders a system
 *   admin-token field when `needsSystemToken` is true
 * - ProviderLimits UI — renders by `displayMode`
 *
 * Convention (AGENTS.md): never inline usage config into catalog entries or
 * duplicate it in fetcher/UI. Adding a quota-capable provider touches exactly:
 * usageConfigs.ts + open-sse/services/usage.ts case + USAGE_SUPPORTED_PROVIDERS
 * + PROVIDER_LIMITS_APIKEY_PROVIDERS (providerLimits.ts — apikey connections
 * are rejected with HTTP 400 unless whitelisted there; oauth-only providers
 * skip this 4th site).
 */

export type UsageDisplayMode = "balance" | "used-limit" | "usage-only";

export type UsageAuthMode = "bearer" | "bearer+userHeader" | "x-api-key-admin";

export type UsageResetWindow = "daily" | "weekly" | "monthly";

export interface UsageConfig {
  /** API base URL (provider catalog entries carry no baseUrl field). */
  baseUrl?: string;
  /** Usage/quota API path (relative to baseUrl). */
  endpoint: string;
  authMode: UsageAuthMode;
  /** Header name carrying the target user id (bearer+userHeader mode). */
  userHeaderName?: string;
  /**
   * Raw quota → currency conversion factor (raw units per 1 unit of
   * `quotaCurrency`; e.g. 500_000 raw units = ¥1 on dmxapi-cn). Absent =
   * fetcher returns raw units unchanged.
   */
  quotaPerUnit?: number;
  /** Currency of the converted balance ("CNY" | "USD"). Absent = raw units. */
  quotaCurrency?: string;
  /** True if a system admin token is required in addition to the API key. */
  needsSystemToken: boolean;
  /** How the dashboard renders the quota (Quota 页通用双模式机制). */
  displayMode: UsageDisplayMode;
  /** Refresh window for used-limit mode. */
  resetWindow?: UsageResetWindow;
}

export const USAGE_CONFIGS: Record<string, UsageConfig> = {
  // ── DMXAPI family ────────────────────────────────────────────────────────
  // cn/ssvip share the self-hosted backend at www.dmxapi.cn (doc:
  // doc.dmxapi.cn/yuer.html — GET /api/user/self, Bearer 系统访问令牌 +
  // Dmx-Api-User 用户 ID 头, 两项须同账号; data.quota 原始额度,
  // 500_000 原始额度 = 1 货币单位). com is a separate New API deployment.
  // Currency (user-corrected 2026-08-03): cn = RMB (¥); com/ssvip = USD ($).
  // All need a system admin token; balance mode (user-corrected 2026-08-02:
  // 「手动限额 vs 层级限额」取舍仅属 Mistral).
  "dmxapi-cn": {
    baseUrl: "https://www.dmxapi.cn",
    endpoint: "/api/user/self",
    authMode: "bearer+userHeader",
    userHeaderName: "Dmx-Api-User",
    quotaPerUnit: 500_000,
    quotaCurrency: "CNY",
    needsSystemToken: true,
    displayMode: "balance",
  },
  "dmxapi-com": {
    baseUrl: "https://dmxapi.com",
    endpoint: "/api/user/self",
    authMode: "bearer+userHeader",
    userHeaderName: "Dmx-Api-User",
    quotaPerUnit: 500_000,
    quotaCurrency: "USD",
    needsSystemToken: true,
    displayMode: "balance",
  },
  "dmxapi-ssvip": {
    // Shares the dmxapi.cn self-hosted backend (user-confirmed 2026-08-02)
    // but bills in USD (user-corrected 2026-08-03).
    baseUrl: "https://www.dmxapi.cn",
    endpoint: "/api/user/self",
    authMode: "bearer+userHeader",
    userHeaderName: "Dmx-Api-User",
    quotaPerUnit: 500_000,
    quotaCurrency: "USD",
    needsSystemToken: true,
    displayMode: "balance",
  },

  // ── SiliconFlow ──────────────────────────────────────────────────────────
  // totalBalance is a plain currency value (CNY on cn, USD on intl);
  // fetcher passes it through as `currency` on the credits row.
  siliconflow: {
    baseUrl: "https://api.siliconflow.com/v1",
    endpoint: "/user/info",
    authMode: "bearer",
    needsSystemToken: false,
    displayMode: "balance",
    quotaCurrency: "USD",
  },
  "siliconflow-cn": {
    baseUrl: "https://api.siliconflow.cn/v1",
    endpoint: "/user/info",
    authMode: "bearer",
    needsSystemToken: false,
    displayMode: "balance",
    quotaCurrency: "CNY",
  },

  // ── Zhipu GLM ────────────────────────────────────────────────────────────
  // baseUrl is region-driven (global-sg → api.z.ai, china-beijing →
  // open.bigmodel.cn); fetcher resolves it from alibabaProviderRegions.
  zhipu: {
    endpoint: "/api/paas/v4/user/info",
    authMode: "bearer",
    needsSystemToken: false,
    displayMode: "balance",
  },

  // ── Mistral ──────────────────────────────────────────────────────────────
  // Admin API (x-api-key Admin Key), used-limit with a monthly window;
  // 后付费无「余额」概念 — manual limit > tier default > usage-only.
  mistral: {
    baseUrl: "https://api.mistral.ai",
    endpoint: "/v1/admin/usage",
    authMode: "x-api-key-admin",
    needsSystemToken: true,
    displayMode: "used-limit",
    resetWindow: "monthly",
  },
};

export function getUsageConfig(providerId: string | undefined): UsageConfig | undefined {
  return providerId ? USAGE_CONFIGS[providerId] : undefined;
}
