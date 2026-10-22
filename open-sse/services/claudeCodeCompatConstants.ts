/**
 * Request-shaping constants for the Claude-Code-compatible endpoint,
 * extracted from claudeCodeCompatible.ts.
 */

import { getStainlessTimeoutSeconds } from "@/shared/utils/runtimeTimeouts";
import { ANTHROPIC_VERSION_HEADER } from "../config/anthropicHeaders.ts";

export const CLAUDE_CODE_COMPATIBLE_PREFIX = "anthropic-compatible-cc-";
export const CLAUDE_CODE_COMPATIBLE_DEFAULT_CHAT_PATH = "/v1/messages?beta=true";
export const CLAUDE_CODE_COMPATIBLE_DEFAULT_MODELS_PATH = "/models";
export const CLAUDE_CODE_COMPATIBLE_DEFAULT_MAX_TOKENS = 64000;
export const CLAUDE_CODE_COMPATIBLE_ANTHROPIC_VERSION = ANTHROPIC_VERSION_HEADER;
export const CONTEXT_1M_BETA_HEADER = "context-1m-2025-08-07";
export const CLAUDE_CODE_COMPATIBLE_DEFAULT_SYSTEM_BLOCKS = [
  {
    type: "text",
    text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
  },
];
export const CONTEXT_1M_SUPPORTED_MODELS = [
  "claude-fable-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
];
export const CLAUDE_CODE_COMPATIBLE_STAINLESS_TIMEOUT_SECONDS = getStainlessTimeoutSeconds(
  process.env
);
