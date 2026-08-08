import { sanitizePII } from "./piiSanitizer";

const SENSITIVE_KEYS = new Set([
  "api_key",
  "apiKey",
  "api-key",
  "authorization",
  "Authorization",
  "x-api-key",
  "X-Api-Key",
  "x-goog-api-key",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "password",
  "secret",
  "token",
]);

type JsonRecord = Record<string, unknown>;

/**
 * True for any binary/opaque byte view (Uint8Array, Buffer, DataView, other
 * typed arrays). `Array.isArray()` returns false for these, so callers that
 * branch on it before recursing would otherwise fall into the generic-object
 * branch and enumerate one JS property key per decoded byte (#7297).
 */
function isOpaqueBinary(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function describeOpaqueBinary(value: ArrayBufferView): string {
  const byteLength = value.byteLength;
  return `[binary ${byteLength} bytes]`;
}

export function cloneLogPayload<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // Some payloads legitimately hold non-cloneable values (Promise
      // instances, locked ReadableStreams, functions) — e.g. a body stream
      // attached to a response object during logging. structuredClone throws
      // "could not be cloned" on those; fall back to a safe JSON snapshot so
      // the copy-on-write logging path never aborts the request pipeline.
      return safeJsonClone(value);
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeJsonClone<T>(value: T): T {
  if (typeof value === "function" || typeof value === "symbol") return undefined as unknown as T;
  if (typeof value === "object" && value !== null) {
    if (value instanceof Promise) {
      return { __promise: true } as unknown as T;
    }
    if (typeof globalThis.structuredClone === "function") {
      try {
        return globalThis.structuredClone(value);
      } catch {
        /* fall through to recursive copy */
      }
    }
    if (Array.isArray(value)) return value.map(safeJsonClone) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = safeJsonClone(v) as unknown as T;
    }
    return out as unknown as T;
  }
  return value;
}

export function normalizePayloadForLog(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;

  const trimmed = payload.trim();
  if (!trimmed) return "";

  try {
    return JSON.parse(trimmed);
  } catch {
    return { _rawText: payload };
  }
}

export function redactPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  if (isOpaqueBinary(payload)) return describeOpaqueBinary(payload);
  if (Array.isArray(payload)) return payload.map(redactPayload);

  const redacted: JsonRecord = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.has(key)) {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.startsWith("Bearer ")) {
      redacted[key] = "Bearer [REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      redacted[key] = redactPayload(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function sanitizePayloadPII(payload: unknown): unknown {
  if (typeof payload === "string") {
    return sanitizePII(payload).text;
  }
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (isOpaqueBinary(payload)) {
    return describeOpaqueBinary(payload);
  }
  if (Array.isArray(payload)) {
    return payload.map(sanitizePayloadPII);
  }

  const sanitized: JsonRecord = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = sanitizePayloadPII(value);
  }
  return sanitized;
}

export function protectPayloadForLog(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null;
  const normalized = normalizePayloadForLog(payload);
  const piiSanitized = sanitizePayloadPII(normalized);
  return redactPayload(piiSanitized);
}

export function serializePayloadForStorage(payload: unknown, maxLength = 65536): string | null {
  if (payload === null || payload === undefined) return null;

  const exact = JSON.stringify(payload);
  if (exact.length <= maxLength) {
    return exact;
  }

  return JSON.stringify({
    _truncated: true,
    _originalSize: exact.length,
    _preview: exact.slice(0, maxLength),
  });
}

export function parseStoredPayload(value: unknown): unknown | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { _rawText: value };
  }
}
