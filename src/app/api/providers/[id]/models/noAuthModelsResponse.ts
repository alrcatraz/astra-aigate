/**
 * No-auth model listing helpers for the [id]/models route: hidden-model
 * filtering, upstream live-model fetching and the local-catalog fallback
 * response. Extracted from route.ts so the route stays focused on dispatch.
 */

import { NextResponse } from "next/server";
import { getSettings, getModelIsHidden } from "@/lib/localDb";
import { SAFE_OUTBOUND_FETCH_PRESETS, safeOutboundFetch } from "@/shared/network/safeOutboundFetch";
import { getProviderOutboundGuard } from "@/shared/network/outboundUrlGuardPolicy";
import { isProviderBlockedByIdOrAlias } from "@/shared/utils/noAuthProviders";
import { getRegistryEntry } from "@omniroute/open-sse/config/providerRegistry.ts";
import { getModelsByProviderId } from "@/shared/constants/models";
import { getStaticModelsForProvider } from "@/lib/providers/staticModels";
import { mergeLocalCatalogModels } from "./discovery/helpers";

/**
 * Drop hidden models while preserving order. getModelIsHidden is async —
 * a naive `.filter(m => !getModelIsHidden(...))` compared against the raw
 * Promise (always truthy → every model hidden) or never awaited (never
 * filtered), so hidden models either vanish entirely or leak through
 * depending on side. Await each check here.
 */
export async function filterExcludeHidden<T extends { id: string }>(
  models: T[],
  providerId: string
): Promise<T[]> {
  const flags = await Promise.all(models.map((m) => getModelIsHidden(providerId, m.id)));
  return models.filter((_, i) => !flags[i]);
}

export function toLiveModel(item: Record<string, unknown>): { id: string; name: string } | null {
  const itemId = typeof item.id === "string" ? item.id.trim() : "";
  if (!itemId) return null;
  const itemName =
    typeof item.display_name === "string"
      ? item.display_name
      : typeof item.name === "string"
        ? item.name
        : itemId;
  return { id: itemId, name: itemName };
}

export async function fetchLiveNoAuthModels(
  modelsUrl: string,
  providerId: string,
  connectionId: string,
  excludeHidden: boolean
): Promise<NextResponse | null> {
  try {
    const liveResponse = await safeOutboundFetch(modelsUrl, {
      ...SAFE_OUTBOUND_FETCH_PRESETS.modelsDiscovery,
      guard: getProviderOutboundGuard(),
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!liveResponse.ok) return null;

    const data = await liveResponse.json();
    const liveModels: Array<{ id: string; name: string }> = (
      (data.data || data.models || []) as Array<Record<string, unknown>>
    )
      .map(toLiveModel)
      .filter((model): model is { id: string; name: string } => model !== null);
    if (liveModels.length === 0) return null;

    const visible = excludeHidden ? await filterExcludeHidden(liveModels, providerId) : liveModels;
    return NextResponse.json({
      provider: providerId,
      connectionId,
      models: visible,
      source: "upstream",
    });
  } catch {
    // Live fetch failed — fall back to the bundled catalog.
    return null;
  }
}

export async function buildNoAuthModelsResponse(
  providerId: string,
  connectionId: string,
  excludeHidden: boolean
) {
  if (isProviderBlockedByIdOrAlias(providerId, (await getSettings()).blockedProviders)) {
    return NextResponse.json({ error: "Provider is disabled" }, { status: 403 });
  }

  const registryEntry = getRegistryEntry(providerId);
  const modelsUrl =
    typeof registryEntry?.modelsUrl === "string" && registryEntry.modelsUrl.length > 0
      ? registryEntry.modelsUrl
      : null;

  if (modelsUrl) {
    const live = await fetchLiveNoAuthModels(modelsUrl, providerId, connectionId, excludeHidden);
    if (live) return live;
  }

  const catalog = mergeLocalCatalogModels(
    getModelsByProviderId(providerId) || [],
    getStaticModelsForProvider(providerId) || []
  ).map((model) => ({ id: model.id, name: model.name || model.id }));
  const visible = excludeHidden ? await filterExcludeHidden(catalog, providerId) : catalog;
  return NextResponse.json({
    provider: providerId,
    connectionId,
    models: visible,
    source: "local_catalog",
  });
}
