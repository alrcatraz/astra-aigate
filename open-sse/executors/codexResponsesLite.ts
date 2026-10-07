/**
 * Codex Responses-Lite detection, extracted from `codex.ts`.
 *
 * The official Codex client marks Responses Lite over an HTTP header or, for
 * WebSocket requests, mirrors the same signal into client_metadata. Lite
 * rejects parallel tool calls, so this predicate gates the enforcement logic
 * that keeps parallel_tool_calls for delegation-dependent models.
 */

/** True when the raw header/metadata value opts into Responses Lite. */
export function isEnabledResponsesLiteFlag(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

const CODEX_RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
const CODEX_RESPONSES_LITE_WS_METADATA_KEY =
  "ws_request_header_x_openai_internal_codex_responses_lite";

/** True when the request opts into Responses Lite (header or ws client_metadata). */
export function isCodexResponsesLiteRequest(
  bodyInput: unknown,
  clientHeaders?: Record<string, string> | null
): boolean {
  const hasLiteHeader = Object.entries(clientHeaders ?? {}).some(
    ([key, value]) =>
      key.toLowerCase() === CODEX_RESPONSES_LITE_HEADER && isEnabledResponsesLiteFlag(value)
  );
  if (hasLiteHeader) return true;

  if (!bodyInput || typeof bodyInput !== "object" || Array.isArray(bodyInput)) return false;
  const metadata = (bodyInput as Record<string, unknown>).client_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;

  return isEnabledResponsesLiteFlag(
    (metadata as Record<string, unknown>)[CODEX_RESPONSES_LITE_WS_METADATA_KEY]
  );
}
