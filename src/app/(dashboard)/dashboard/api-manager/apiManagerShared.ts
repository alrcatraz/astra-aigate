"use client";

/**
 * Shared constants, value types and Claude-Code model helpers for the
 * api-manager dashboard. Extracted from ApiManagerPageClient.tsx.
 */

import { useState, useEffect } from "react";

// Constants for validation
export const MAX_KEY_NAME_LENGTH = 200;
export const MAX_SELECTED_MODELS = 500;
export const CLAUDE_CODE_DEFAULT_MODEL_ID = "cc/*";
export const CLAUDE_CODE_DEFAULT_MODEL_NAME = "Claude Code default";
export const CLAUDE_CODE_DEFAULT_FAMILIES = [
  { id: "other", label: "other" },
  { id: "fable", label: "fable" },
  { id: "opus", label: "opus" },
  { id: "sonnet", label: "sonnet" },
  { id: "haiku", label: "haiku" },
] as const;
export type ClaudeCodeFamilyId = (typeof CLAUDE_CODE_DEFAULT_FAMILIES)[number]["id"];
export type ClaudeCodeBlockableFamilyId = Exclude<ClaudeCodeFamilyId, "other">;
export const CLAUDE_CODE_FAMILY_BLOCK_PATTERNS: Record<ClaudeCodeBlockableFamilyId, string[]> = {
  fable: ["claude-fable*", "fable"],
  opus: ["claude-opus*", "opus"],
  sonnet: ["claude-sonnet*", "sonnet"],
  haiku: ["claude-haiku*", "haiku"],
};
export const CLAUDE_CODE_BLOCK_PATTERN_SET = new Set(
  Object.values(CLAUDE_CODE_FAMILY_BLOCK_PATTERNS).flat()
);

// Debounce hook for search optimization
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Sanitize user input to prevent XSS
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .trim()
    .slice(0, MAX_KEY_NAME_LENGTH);
}

// Validate key name
export function validateKeyName(
  name: string,
  t: (key: string, values?: Record<string, unknown>) => string
): { valid: boolean; error?: string } {
  if (!name || !name.trim()) {
    return { valid: false, error: t("keyNameRequired") };
  }
  if (name.length > MAX_KEY_NAME_LENGTH) {
    return { valid: false, error: t("keyNameTooLong", { max: MAX_KEY_NAME_LENGTH }) };
  }
  // Allow Unicode letters (accented chars), numbers, spaces, hyphens, underscores
  if (!/^[\p{L}\p{N}_\-\s]+$/u.test(name)) {
    return {
      valid: false,
      error: t("keyNameInvalid"),
    };
  }
  return { valid: true };
}

export interface AccessSchedule {
  enabled: boolean;
  from: string;
  until: string;
  days: number[];
  tz: string;
}

export type StreamDefaultMode = "legacy" | "json";

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  allowedModels: string[] | null;
  blockedModels?: string[] | null;
  allowedCombos: string[] | null;
  allowedConnections: string[] | null;
  noLog?: boolean;
  autoResolve?: boolean;
  isActive?: boolean;
  throttleDelayMs?: number | null;
  isBanned?: boolean;
  expiresAt?: string | null;
  maxSessions?: number;
  accessSchedule?: AccessSchedule | null;
  rateLimits?: Array<{ limit: number; window: number }> | null;
  scopes?: string[];
  allowedEndpoints?: string[];
  streamDefaultMode?: StreamDefaultMode;
  disableNonPublicModels?: boolean;
  allowUsageCommand?: boolean;
  chaosModeEnabled?: boolean;
  usageLimitEnabled?: boolean;
  dailyUsageLimitUsd?: number | null;
  weeklyUsageLimitUsd?: number | null;
  allowedQuotas?: string[] | null;
  createdAt: string;
}

export interface ProviderConnection {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
}

export interface KeyUsageStats {
  totalRequests: number;
  totalCost: number;
  lastUsed: string | null;
}

export interface Model {
  id: string;
  owned_by: string;
  name?: string;
}

export interface ComboOption {
  id?: string;
  name: string;
  models?: unknown[];
}

/** Tuple type for models grouped by provider: [providerName, models[]] */
export type ProviderGroup = [provider: string, models: Model[]];

export function isClaudeCodeModel(model: Model): boolean {
  return (
    model.owned_by === "claude" || model.id.startsWith("cc/") || model.id.startsWith("claude/")
  );
}

export function withClaudeCodeDefaultModel(models: Model[]): Model[] {
  if (!models.some(isClaudeCodeModel)) return models;
  if (models.some((model) => model.id === CLAUDE_CODE_DEFAULT_MODEL_ID)) return models;
  return [
    {
      id: CLAUDE_CODE_DEFAULT_MODEL_ID,
      name: CLAUDE_CODE_DEFAULT_MODEL_NAME,
      owned_by: "claude",
    },
    ...models,
  ];
}

export function getBlockedClaudeCodeFamilies(
  blockedModels: string[]
): ClaudeCodeBlockableFamilyId[] {
  return (Object.keys(CLAUDE_CODE_FAMILY_BLOCK_PATTERNS) as ClaudeCodeBlockableFamilyId[]).filter(
    (familyId) =>
      CLAUDE_CODE_FAMILY_BLOCK_PATTERNS[familyId].some((pattern) => blockedModels.includes(pattern))
  );
}

export function isClaudeCodeFamilyModel(
  modelId: string,
  familyId: ClaudeCodeBlockableFamilyId
): boolean {
  const normalized = modelId.toLowerCase();
  return (
    normalized === familyId ||
    normalized.includes(`/${familyId}`) ||
    normalized.includes(`-${familyId}`)
  );
}
