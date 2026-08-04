/**
 * usage/mistral.ts — Mistral usage fetcher (used-limit mode, PLAN 2.7).
 *
 * Admin API `GET /v1/admin/usage?month=MM&year=YYYY` with an x-api-key Admin
 * Key (created in the Backoffice, stored in the connection's `consoleApiKey`
 * field). Natural-month reset window. Mistral is post-paid — there is no
 * pre-paid balance, so this reports the current month's consumption in the
 * `usage` quota entry (used-limit); manual limit > tier (platform default) >
 * usage-only fallback is a display-layer concern.
 */

import { getUsageConfig } from "@/shared/constants/providers/usageConfigs";
import { sanitizeErrorMessage } from "../../utils/error.ts";
import { toNumber } from "./scalars.ts";
import { type UsageQuota } from "./quota.ts";

type JsonRecord = Record<string, unknown>;

export async function getMistralUsage(
  accessToken: string | undefined,
  providerSpecificData?: unknown
): Promise<{ plan: string; quotas: Record<string, UsageQuota> } | { message: string }> {
  const config = getUsageConfig("mistral");
  const data = (providerSpecificData ?? {}) as JsonRecord;
  const adminKey = typeof data.consoleApiKey === "string" ? data.consoleApiKey.trim() : "";
  if (!adminKey) {
    return {
      message:
        "Mistral usage queries require an Admin API key. Please add it in the connection settings.",
    };
  }

  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const year = String(now.getUTCFullYear());
  const url = `${config?.baseUrl ?? "https://api.mistral.ai"}${
    config?.endpoint ?? "/v1/admin/usage"
  }?month=${month}&year=${year}`;

  try {
    const response = await fetch(url, { headers: { "x-api-key": adminKey } });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          message: "Mistral Admin key rejected (401/403). Check the Admin API key.",
        };
      }
      return { message: `Mistral Admin API error (${response.status})` };
    }

    const payload = (await response.json()) as JsonRecord;
    // Admin usage response shape is still being verified live; accept common
    // amount/currency fields and degrade gracefully.
    const used = toNumber(payload.amount ?? payload.total ?? payload.spend, 0);
    const quotas: Record<string, UsageQuota> = {
      usage: {
        used,
        total: 0,
        remaining: undefined,
        resetAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
        unlimited: true,
        currency: typeof payload.currency === "string" ? payload.currency : "USD",
      },
    };
    return { plan: "Mistral", quotas };
  } catch (error) {
    return { message: `Unable to fetch Mistral usage: ${sanitizeErrorMessage(error)}` };
  }
}
