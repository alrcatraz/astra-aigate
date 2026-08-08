/**
 * usage/dmxapi.ts — DMXAPI site usage fetcher (balance mode, PLAN 2.7).
 *
 * All three sites (cn/com/ssvip) query `/api/user/self` with a system admin
 * token (Bearer — the connection's `consoleApiKey`, same generic field as
 * agentrouter, #6850) plus a `Dmx-Api-User` header naming the target user
 * (user-corrected 2026-08-02 — 三家均需系统管理令牌). cn is a self-hosted
 * backend; com/ssvip are New API deployments. Endpoint/auth config lives in
 * `src/shared/constants/providers/usageConfigs.ts` (single source of truth).
 */

import { getUsageConfig } from "@/shared/constants/providers/usageConfigs";
import { sanitizeErrorMessage } from "../../utils/error.ts";
import { toNumber } from "./scalars.ts";
import { type UsageQuota } from "./quota.ts";

type JsonRecord = Record<string, unknown>;

export async function getDmxapiUsage(
  provider: string,
  accessToken: string | undefined,
  providerSpecificData?: unknown
): Promise<{ plan: string; quotas: Record<string, UsageQuota> } | { message: string }> {
  const config = getUsageConfig(provider);
  if (!config?.baseUrl) {
    return { message: "DMXAPI usage endpoint not configured for this site yet." };
  }

  const data = (providerSpecificData ?? {}) as JsonRecord;
  const systemToken = typeof data.consoleApiKey === "string" ? data.consoleApiKey.trim() : "";
  const headers: Record<string, string> = {};

  if (config.needsSystemToken) {
    if (!systemToken) {
      return {
        message:
          "DMXAPI quota queries require a system admin token. Please add it in the connection settings.",
      };
    }
    headers.Authorization = `Bearer ${systemToken}`;
  } else {
    headers.Authorization = `Bearer ${accessToken ?? ""}`;
  }
  if (config.authMode === "bearer+userHeader" && config.userHeaderName) {
    const userId = typeof data.newApiUserId === "string" ? data.newApiUserId.trim() : "";
    if (userId) headers[config.userHeaderName] = userId;
  }

  try {
    const response = await fetch(`${config.baseUrl}${config.endpoint}`, { headers });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          message: "DMXAPI token rejected (401/403). Check the system admin token.",
        };
      }
      return { message: `DMXAPI API error (${response.status})` };
    }

    const payload = (await response.json()) as JsonRecord;
    // cn 自研: { code, message, success, data: {...} }; New API: { success, message, data: {...} }
    const d = (payload.data as JsonRecord) ?? payload;
    const rawRemaining = toNumber(d.quota ?? d.balance ?? d.totalBalance, 0);
    // Raw quota units → currency: cn bills in CNY (500_000 units = ¥1),
    // com/ssvip in USD (New-API 500_000 units = $1). See usageConfigs.
    const perUnit = config.quotaPerUnit && config.quotaPerUnit > 0 ? config.quotaPerUnit : null;
    const remaining = perUnit ? rawRemaining / perUnit : rawRemaining;
    const currency = config.quotaCurrency;
    const quotas: Record<string, UsageQuota> = {
      credits: {
        used: 0,
        total: 0,
        remaining,
        // #7993 balance tier: presence of credit means the balance is available.
        // normalizeQuotas() needs a non-0 remainingPercentage or it marks the
        // provider exhausted (see deepseek.ts L42 for the reference pattern).
        remainingPercentage: remaining > 0 ? 100 : 0,
        resetAt: null,
        unlimited: remaining <= 0,
        ...(currency ? { currency } : {}),
      },
    };
    return { plan: "DMXAPI", quotas };
  } catch (error) {
    return { message: `Unable to fetch DMXAPI usage: ${sanitizeErrorMessage(error)}` };
  }
}
