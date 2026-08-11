/**
 * usage/siliconflow.ts — SiliconFlow usage fetcher (balance mode, PLAN 2.7).
 *
 * GET /v1/user/info with a plain Bearer API key; cn (api.siliconflow.cn) and
 * intl (api.siliconflow.com) sites share the response shape
 * ({ code, data: { totalBalance, ... } }). Config lives in
 * `src/shared/constants/providers/usageConfigs.ts` (single source of truth).
 */

import { getUsageConfig } from "@/shared/constants/providers/usageConfigs";
import { sanitizeErrorMessage } from "../../utils/error.ts";
import { toNumber } from "./scalars.ts";
import { type UsageQuota } from "./quota.ts";

type JsonRecord = Record<string, unknown>;

export async function getSiliconflowUsage(
  provider: string,
  accessToken: string | undefined
): Promise<{ plan: string; quotas: Record<string, UsageQuota> } | { message: string }> {
  const config = getUsageConfig(provider);
  if (!config?.baseUrl) {
    return { message: "SiliconFlow usage endpoint not configured for this site." };
  }

  try {
    const response = await fetch(`${config.baseUrl}${config.endpoint}`, {
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { message: "SiliconFlow API key rejected (401/403). Please reconnect." };
      }
      return { message: `SiliconFlow API error (${response.status})` };
    }

    const payload = (await response.json()) as JsonRecord;
    const d = (payload.data as JsonRecord) ?? payload;
    // /v1/user/info is not a documented API. Since 2026-08-08 the CN endpoint
    // has been returning a degenerate payload where balance, chargeBalance and
    // totalBalance are all the *string* "0" regardless of the real balance —
    // surfacing that as "0 credits" is misleading (a genuinely exhausted
    // account would return numeric 0s). Treat the all-string-zero shape as
    // unavailable instead of as a real zero balance.
    const allStringZero =
      typeof d.balance === "string" &&
      d.balance === "0" &&
      typeof d.chargeBalance === "string" &&
      d.chargeBalance === "0" &&
      typeof d.totalBalance === "string" &&
      d.totalBalance === "0";
    if (allStringZero) {
      return {
        message:
          "SiliconFlow /v1/user/info returned an invalid all-zero balance payload; " +
          "verify the real balance in the SiliconFlow console.",
      };
    }
    const remaining = toNumber(d.totalBalance ?? d.balance, 0);
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
        ...(config.quotaCurrency ? { currency: config.quotaCurrency } : {}),
      },
    };
    return { plan: "SiliconFlow", quotas };
  } catch (error) {
    return { message: `Unable to fetch SiliconFlow usage: ${sanitizeErrorMessage(error)}` };
  }
}
