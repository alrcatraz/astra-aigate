/**
 * Value coercion helpers for the MCP server, extracted from server.ts.
 */

import {
  getComboModelProvider,
  getComboModelString,
  getComboStepTarget,
} from "../../src/lib/combos/steps.ts";
import { getAsyncDb } from "../../src/lib/db/core.ts";
import type { McpAccessibilityConfig } from "../services/compression/engines/mcpAccessibility/constants.ts";
import {
  DEFAULT_MCP_ACCESSIBILITY_CONFIG,
  clampMcpAccessibilityConfig,
} from "../services/compression/engines/mcpAccessibility/constants.ts";
// #7879: local `toNumber` definitions are barred — reuse the canonical coercion
// from the shared numeric helpers and re-export it for the host module.
import { toNumber } from "@/shared/utils/numeric";

export { toNumber };

export type JsonRecord = Record<string, unknown>;

export function readMcpDescriptionCompressionEnabled(): boolean {
  try {
    const row = getAsyncDb()
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get("compression", "mcpDescriptionCompressionEnabled") as { value?: string } | undefined;
    if (!row?.value) return true;
    return JSON.parse(row.value) !== false;
  } catch {
    return true;
  }
}

export function readMcpAccessibilityConfig(): McpAccessibilityConfig {
  try {
    const row = getAsyncDb()
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get("compression", "mcpAccessibility") as { value?: string } | undefined;
    if (!row?.value) return { ...DEFAULT_MCP_ACCESSIBILITY_CONFIG };
    // clampMcpAccessibilityConfig bounds every field (and folds in the non-object guard), so a
    // persisted out-of-range maxTextChars can't make smartFilterText truncate the whole text.
    return clampMcpAccessibilityConfig(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_MCP_ACCESSIBILITY_CONFIG };
  }
}

export type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function toStringArray(value: unknown, fallback: string[] = []): string[] {
  const values = toArray(value).filter((entry): entry is string => typeof entry === "string");
  return values.length > 0 ? values : fallback;
}

export function normalizeComboModels(
  rawModels: unknown
): Array<{ provider: string; model: string; priority: number }> {
  return toArray(rawModels).map((rawModel, index) => {
    const modelRecord = toRecord(rawModel);
    const modelString = getComboModelString(rawModel);
    const target = getComboStepTarget(rawModel);
    const provider =
      getComboModelProvider(rawModel) ||
      (modelString ? "unknown" : target ? "combo" : toString(modelRecord.provider, "unknown"));

    return {
      provider,
      model: modelString || target || toString(modelRecord.model, "unknown"),
      priority: toNumber(modelRecord.priority, index + 1),
    };
  });
}
