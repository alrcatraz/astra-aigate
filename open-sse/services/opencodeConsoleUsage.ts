/**
 * opencodeConsoleUsage.ts — read-only client for OpenCode Console's per-model
 * usage API.
 *
 *   GET https://opencode.ai/console/api/usage/models?range=30d&since=<ISO>
 *   Authorization: Bearer oc_sk_…            (the connection's own key)
 *
 * Response items carry `totalCostMicroCents` — the provider's own list-price
 * cost, i.e. the number its Go quota meter is computed from. microCents × 1e-8
 * = USD.
 *
 * This is a leaf HTTP client, not a quota source of its own: the per-model
 * windows built from it are published through the connection's normal
 * QuotaFetcher, so polling, caching, fail-open and cutoff evaluation all stay
 * on the existing path.
 *
 * Fail-open by design: any non-200, malformed body or transport error yields
 * null and the caller keeps whatever the account-level windows reported.
 */

const DEFAULT_BASE_URL =
  process.env.OMNIROUTE_OPENCODE_CONSOLE_API_URL ?? "https://opencode.ai/console/api";

const CACHE_TTL_MS = 55_000;
const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = "astra-aigate-quota/1.0";

export interface ConsoleModelUsage {
  model: string;
  /** List-price cost in USD, as reported by the provider. */
  costUsd: number;
  requests: number;
}

interface CacheEntry {
  sample: ConsoleModelUsage[] | null;
  fetchedAt: number;
  apiKeyFingerprint: string;
}

const cache = new Map<string, CacheEntry>();

function fingerprint(key: string): string {
  return `${key.slice(0, 10)}:${key.length}`;
}

function microCentsToUsd(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw / 1e8;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n / 1e8;
  }
  return null;
}

/**
 * Fetch per-model list-price cost accrued since `sinceIso`.
 * Returns null when the endpoint is unavailable — callers must fail open.
 */
export async function fetchConsoleModelUsage(
  apiKey: string,
  sinceIso: string,
  options: { baseUrl?: string; now?: number } = {}
): Promise<ConsoleModelUsage[] | null> {
  const key = apiKey?.trim();
  if (!key || !sinceIso) return null;

  const now = options.now ?? Date.now();
  const cacheKey = `${options.baseUrl ?? DEFAULT_BASE_URL}|${sinceIso}`;
  const cached = cache.get(cacheKey);
  if (
    cached &&
    cached.apiKeyFingerprint === fingerprint(key) &&
    now - cached.fetchedAt < CACHE_TTL_MS
  ) {
    return cached.sample;
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = new URL(`${baseUrl}/usage/models`);
  // `range` must be one of the console's accepted enums; `since` is what
  // actually narrows the window (range=72h is rejected with HTTP 400).
  url.searchParams.set("range", "30d");
  url.searchParams.set("since", sinceIso);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("costOrder", "desc");
  url.searchParams.set("includeLegacyKeys", "true");

  let sample: ConsoleModelUsage[] | null = null;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 401/403 → the key lacks the Usage permission or was revoked; the
      // caller simply keeps account-level data. Do not throw.
      cache.set(cacheKey, { sample: null, fetchedAt: now, apiKeyFingerprint: fingerprint(key) });
      return null;
    }
    const body = (await response.json()) as unknown;
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items)) return null;

    const parsed: ConsoleModelUsage[] = [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const model = typeof item.model === "string" ? item.model : null;
      const costUsd = microCentsToUsd(item.totalCostMicroCents);
      if (!model || costUsd === null) continue;
      const requests = Number(item.totalRequests ?? 0);
      parsed.push({ model, costUsd, requests: Number.isFinite(requests) ? requests : 0 });
    }
    sample = parsed;
  } catch {
    sample = null;
  }

  cache.set(cacheKey, { sample, fetchedAt: now, apiKeyFingerprint: fingerprint(key) });
  return sample;
}

/** Test helper: drop cached samples. */
export function _clearConsoleUsageCache(): void {
  cache.clear();
}

/** Index a sample by model id for O(1) window computation. */
export function indexByModel(sample: readonly ConsoleModelUsage[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of sample) {
    map.set(entry.model.toLowerCase(), entry.costUsd);
  }
  return map;
}
