import type { RegistryEntry } from "../../shared.ts";
import { GLM_REQUEST_DEFAULTS, GLM_TIMEOUT_MS, GLM_SHARED_MODELS } from "../../shared.ts";

/**
 * Zhipu standard API (open.bigmodel.cn) — the non-Coding-Plan tier.
 *
 * The glm / glmt / glm-cn entries all target the Coding Plan gateways
 * (endpoints under .../coding/paas/v4/chat/completions, executor "glm"
 * which appends ?beta=true). Zhipu also sells the standard API at
 * open.bigmodel.cn/api/paas/v4/chat/completions — a plain OpenAI-format
 * endpoint with its own auth domain and no ?beta quirk, so this entry
 * uses executor "default" (see executors/default.ts: case "glm" vs the
 * openai default branch).
 *
 * Mirrors GLM_SHARED_MODELS + request defaults (same model family, same
 * token budget semantics); context length 200K default like glm-cn.
 */
export const zhipuProvider: RegistryEntry = {
  id: "zhipu",
  alias: "zhipu",
  format: "openai",
  executor: "default",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  authType: "apikey",
  authHeader: "bearer",
  defaultContextLength: 200000,
  requestDefaults: GLM_REQUEST_DEFAULTS,
  timeoutMs: GLM_TIMEOUT_MS,
  models: [...GLM_SHARED_MODELS],
  passthroughModels: true,
};
