/**
 * Provider-limits sync constants, extracted from providerLimits.ts.
 */

export const PROVIDER_LIMITS_APIKEY_PROVIDERS = new Set([
  "glm",
  "glm-cn",
  "zai",
  "glmt",
  "opencode-go",
  "ollama-cloud",
  "minimax",
  "minimax-cn",
  "crof",
  "nanogpt",
  "deepseek",
  "xiaomi-mimo",
  "vertex",
  "vertex-partner",
  "kimi-coding-apikey",
  "kiro",
  // Qoder connections are PAT-based (authType "apikey"); the usage fetcher
  // exchanges the PAT for a job token and reads openapi.qoder.sh/user/status.
  "qoder",
  "promptql", // PromptQL playground JWT → getCreditSummary USD credits
  "pql",
  // Adobe Firefly: web-cookie / JWT stored as apikey → credits/balance
  "adobe-firefly",
  "firefly",
  // HyperAgent session cookie → billing/usage creditBlocks
  "hyperagent",
  "ha",
  "firecrawl",
  // DMXAPI sites (system admin token + Dmx-Api-User header → /api/user/self) — balance
  "dmxapi-cn",
  "dmxapi-com",
  "dmxapi-ssvip",
  // SiliconFlow (GET /v1/user/info) — balance, intl + CN
  "siliconflow",
  "siliconflow-cn",
  // NOTE: zhipu & mistral removed 2026-08-03 — Zhipu exposes no public
  // balance API (all /user/info & anthropic usage endpoints 404; balance is
  // console-only) and Mistral's Admin API is Enterprise-only (Backoffice).
  // Fetchers/configs stay in usageConfigs.ts for when platforms add APIs.
]);
export const DEFAULT_PROVIDER_LIMITS_SYNC_INTERVAL_MINUTES = 70;
export const PROVIDER_LIMITS_AUTO_SYNC_SETTING_KEY = "provider_limits_auto_sync_last_run";
export const DEFAULT_PROVIDER_LIMITS_POST_USAGE_REFRESH_DELAY_MS = 5_000;
