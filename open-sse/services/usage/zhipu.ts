/**
 * usage/zhipu.ts — Zhipu GLM usage fetcher (balance mode, PLAN 2.7).
 *
 * GET /api/paas/v4/user/info with a plain Bearer API key. baseUrl is
 * region-driven (global-sg → api.z.ai, china-beijing → open.bigmodel.cn);
 * resolved exactly like chat routing via alibabaProviderRegions
 * (resolveAlibabaProviderBaseUrl), so the region selector on the connection
 * drives the quota endpoint too.
 */

import { getUsageConfig } from "@/shared/constants/providers/usageConfigs";
import { resolveAlibabaProviderBaseUrl } from "@/shared/constants/alibabaProviderRegions";
import { sanitizeErrorMessage } from "../../utils/error.ts";
import { toNumber } from "./scalars.ts";
import { type UsageQuota } from "./quota.ts";

type JsonRecord = Record<string, unknown>;

export async function getZhipuUsage(
  accessToken: string | undefined,
  providerSpecificData?: unknown
): Promise<{ plan: string; quotas: Record<string, UsageQuota> } | { message: string }> {
  const apiRoot = (resolveAlibabaProviderBaseUrl("zhipu", providerSpecificData) || "").replace(
    /\/api\/paas\/v4\/chat\/completions$/i,
    ""
  );
  const config = getUsageConfig("zhipu");
  if (!apiRoot) {
    return { message: "Zhipu usage endpoint could not be resolved (region missing)." };
  }

  try {
    const response = await fetch(`${apiRoot}${config?.endpoint ?? "/api/paas/v4/user/info"}`, {
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { message: "Zhipu API key rejected (401/403). Please reconnect." };
      }
      return { message: `Zhipu API error (${response.status})` };
    }

    const payload = (await response.json()) as JsonRecord;
    const d = (payload.data as JsonRecord) ?? payload;
    const remaining = toNumber(d.totalBalance ?? d.balance ?? d.quota ?? d.credit, 0);
    const quotas: Record<string, UsageQuota> = {
      credits: {
        used: 0,
        total: 0,
        remaining,
        resetAt: null,
        unlimited: remaining <= 0,
      },
    };
    return { plan: "Zhipu", quotas };
  } catch (error) {
    return { message: `Unable to fetch Zhipu usage: ${sanitizeErrorMessage(error)}` };
  }
}
