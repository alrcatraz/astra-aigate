import type { RegistryEntry } from "../../shared.ts";

/**
 * DMXAPI (www.dmxapi.cn) — RMB-priced Chinese multi-modal aggregator.
 *
 * OpenAI-compatible: one key serves chat + image + video + audio across
 * 562 models (`GET /v1/models` with a valid key, 2026-08-01). The image
 * capability is registered separately in imageRegistry (qwen-image family,
 * verified 200). Chat endpoint verified live 2026-08-01: deepseek-v3.1,
 * DeepSeek-V3.2, DMXAPI-glm-5 all return 200 on
 * `POST /v1/chat/completions`.
 *
 * Model list: only models verified reachable via the chat endpoint under
 * the default distributor group. `passthroughModels` lets live model-sync
 * pick up the full 562-model catalogue; entries here are the curated
 * stable subset. Unverified variants (e.g. z-image-turbo, which 404s on
 * its endpoint) are deliberately NOT registered.
 */

// The curated stable model subset (shared across all three DMXAPI sites —
// same engine/back-end, only billing currency & host differ). Declared before
// the entries below so the object literals can reference it (TS TDZ guard).
const DMXAPI_CURATED_MODELS: RegistryEntry["models"] = [
  { id: "deepseek-v3.1", name: "DeepSeek V3.1" },
  { id: "DeepSeek-V3.2", name: "DeepSeek V3.2" },
  { id: "DeepSeek-V3.2-Thinking", name: "DeepSeek V3.2 Thinking" },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { id: "DMXAPI-glm-5", name: "GLM 5 (DMXAPI)" },
  { id: "DMXAPI-glm-5.1", name: "GLM 5.1 (DMXAPI)" },
  { id: "DMXAPI-kimi-k3", name: "Kimi K3 (DMXAPI)" },
];

export const dmxapiProvider: RegistryEntry = {
  id: "dmxapi",
  alias: "dmxapi",
  format: "openai",
  executor: "default",
  baseUrl: "https://www.dmxapi.cn/v1/chat/completions",
  authType: "apikey",
  authHeader: "bearer",
  models: DMXAPI_CURATED_MODELS,
  passthroughModels: true,
  // Absolute modelsUrl: deriveConfigFromRegistryModelsUrl() requires a non-empty
  // modelsUrl to return a model-discovery config — WITHOUT it, model discovery
  // short-circuits to the 8-model local catalog and never live-fetches the 562
  // upstream catalogue (BUG-5). This absolute URL is also honoured by
  // validateOpenAILikeProvider (it prefers modelsUrl over addModelsSuffix).
  modelsUrl: "https://www.dmxapi.cn/v1/models",
};

// ── DMXAPI family sites ─────────────────────────────────────────────────────
// Connections register with a site-specific provider id (`dmxapi-cn` /
// `dmxapi-com` / `dmxapi-ssvip`), so `getRegistryEntry` must resolve every one
// of them or connection testing / model discovery short-circuits to
// "Provider test not supported" (BUG-1). baseUrl per site mirrors
// src/shared/constants/providers/usageConfigs.ts (single source of truth for
// quota base URLs) — cn hosts www.dmxapi.cn (RMB), com hosts dmxapi.com (USD),
// ssvip shares the dmxapi.cn back-end but bills USD.
function dmxapiFamilyEntry(id: string, baseHost: string): RegistryEntry {
  return {
    id,
    alias: id,
    format: "openai",
    executor: "default",
    baseUrl: `${baseHost}/v1/chat/completions`,
    authType: "apikey",
    authHeader: "bearer",
    models: DMXAPI_CURATED_MODELS,
    passthroughModels: true,
    // Absolute modelsUrl per site (see dmxapiProvider — BUG-5): required for
    // deriveConfigFromRegistryModelsUrl to return a live model-discovery config.
    modelsUrl: `${baseHost}/v1/models`,
  };
}

export const dmxapiCnProvider = dmxapiFamilyEntry("dmxapi-cn", "https://www.dmxapi.cn");
export const dmxapiComProvider = dmxapiFamilyEntry("dmxapi-com", "https://dmxapi.com");
export const dmxapiSsvipProvider = dmxapiFamilyEntry("dmxapi-ssvip", "https://www.dmxapi.cn");
