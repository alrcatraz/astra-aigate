import type { RegistryEntry } from "../../shared.ts";
import { buildOpenAiCompatibleRegistryEntry } from "../../shared.ts";

/**
 * SiliconFlow CN (api.siliconflow.cn) — RMB-priced mainland-China site.
 *
 * Chat entry mirrors the international `siliconflow` provider's catalogue
 * (same vendor, dual-site; model IDs share the `Vendor/Model` format on both
 * sites — the CN media registries for embedding/rerank/tts/stt were verified
 * against the CN model directory 2026-07-31 and use identical IDs). Chat
 * model availability per-site is NOT individually verified; passthroughModels
 * lets live model-sync correct the catalogue from /v1/models.
 *
 * Media capabilities (embedding/rerank/tts/stt/image) live in the media
 * registries and link back here via `providerId: "siliconflow-cn"`.
 */
export const siliconflow_cnProvider: RegistryEntry = buildOpenAiCompatibleRegistryEntry({
  id: "siliconflow-cn",
  alias: "siliconflow-cn",
  baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
  passthroughModels: true,
  models: [
    // DeepSeek
    { id: "deepseek-ai/DeepSeek-V3.2", name: "DeepSeek V3.2" },
    { id: "deepseek-ai/DeepSeek-V3.2-Exp", name: "DeepSeek V3.2 Exp" },
    { id: "deepseek-ai/DeepSeek-V3.1", name: "DeepSeek V3.1" },
    { id: "deepseek-ai/DeepSeek-V3.1-Terminus", name: "DeepSeek V3.1 Terminus" },
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "deepseek-ai/deepseek-vl2", name: "DeepSeek VL2" },
    { id: "nex-agi/DeepSeek-V3.1-Nex-N1", name: "DeepSeek V3.1 Nex N1" },
    // Qwen
    { id: "Qwen/Qwen3.6-35B-A3B", name: "Qwen 3.6 35B A3B" },
    { id: "Qwen/Qwen3.6-27B", name: "Qwen 3.6 27B" },
    { id: "Qwen/Qwen3.5-397B-A17B", name: "Qwen 3.5 397B A17B" },
    { id: "Qwen/Qwen3.5-122B-A10B", name: "Qwen 3.5 122B A10B" },
    { id: "Qwen/Qwen3.5-35B-A3B", name: "Qwen 3.5 35B A3B" },
    { id: "Qwen/Qwen3.5-27B", name: "Qwen 3.5 27B" },
    { id: "Qwen/Qwen3.5-9B", name: "Qwen 3.5 9B" },
    { id: "Qwen/Qwen3-Next-80B-A3B-Instruct", name: "Qwen3 Next 80B Instruct" },
    { id: "Qwen/Qwen3-Next-80B-A3B-Thinking", name: "Qwen3 Next 80B Thinking" },
    { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B A22B" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen3 235B A22B Instruct" },
    { id: "Qwen/Qwen3-32B", name: "Qwen3 32B" },
    { id: "Qwen/Qwen3-30B-A3B", name: "Qwen3 30B A3B" },
    { id: "Qwen/Qwen3-14B", name: "Qwen3 14B" },
    { id: "Qwen/Qwen3-8B", name: "Qwen3 8B" },
    { id: "Qwen/Qwen3-4B", name: "Qwen3 4B" },
    { id: "Qwen/Qwen3-1.7B", name: "Qwen3 1.7B" },
    { id: "Qwen/Qwen3-0.6B", name: "Qwen3 0.6B" },
    { id: "Qwen/Qwen3-0.6B-Instruct", name: "Qwen3 0.6B Instruct" },
    // GLM / Kimi / MiniMax
    { id: "zai-org/GLM-5", name: "GLM 5" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "MiniMaxAI/MiniMax-M2", name: "MiniMax M2" },
    { id: "MiniMaxAI/MiniMax-M1", name: "MiniMax M1" },
    // Inclusion AI
    { id: "inclusionAI/Ling-flash-2.0", name: "Ling Flash 2.0" },
    { id: "inclusionAI/Ling-mini-2.0", name: "Ling Mini 2.0" },
    { id: "inclusionAI/Ring-flash-2.0", name: "Ring Flash 2.0" },
    // Others
    { id: "google/gemma-4-31B-it", name: "Gemma 4 31B" },
    { id: "google/gemma-4-26B-A4B-it", name: "Gemma 4 26B" },
    { id: "ByteDance-Seed/Seed-OSS-36B-Instruct", name: "Seed OSS 36B" },
  ],
});
