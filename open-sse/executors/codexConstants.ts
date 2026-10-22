/**
 * Codex effort-ordering + Responses-Lite wire constants, extracted from `codex.ts`.
 *
 * Pure data so the executor keeps its request-building logic; the effort order
 * also derives the public `EffortLevel` type.
 */

// Ordered list of effort levels from lowest to highest
export const EFFORT_ORDER = ["none", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type EffortLevel = (typeof EFFORT_ORDER)[number];
export const STANDARD_EFFORT_SUFFIXES = ["none", "low", "medium", "high", "xhigh"] as const;
export const GPT_5_6_MAX_ALIAS_MODELS = new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
export const GPT_5_6_ULTRA_ALIAS_MODELS = new Set(["gpt-5.6-sol", "gpt-5.6-terra"]);
export const CODEX_FAST_WIRE_VALUE = "priority";
export const CODEX_RESPONSES_WS_URL = "wss://chatgpt.com/backend-api/codex/responses";
