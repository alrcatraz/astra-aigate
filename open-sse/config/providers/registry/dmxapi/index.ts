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
export const dmxapiProvider: RegistryEntry = {
  id: "dmxapi",
  alias: "dmxapi",
  format: "openai",
  executor: "default",
  baseUrl: "https://www.dmxapi.cn/v1/chat/completions",
  authType: "apikey",
  authHeader: "bearer",
  models: [
    { id: "deepseek-v3.1", name: "DeepSeek V3.1" },
    { id: "DeepSeek-V3.2", name: "DeepSeek V3.2" },
    { id: "DeepSeek-V3.2-Thinking", name: "DeepSeek V3.2 Thinking" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "DMXAPI-glm-5", name: "GLM 5 (DMXAPI)" },
    { id: "DMXAPI-glm-5.1", name: "GLM 5.1 (DMXAPI)" },
    { id: "DMXAPI-kimi-k3", name: "Kimi K3 (DMXAPI)" },
  ],
  passthroughModels: true,
};
