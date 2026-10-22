/**
 * Request/headers shape types for the Claude-Code-compatible bridge,
 * extracted from claudeCodeCompatible.ts.
 */

export type HeaderLike =
  | Headers
  | Record<string, string | undefined>
  | { get?: (name: string) => string | null }
  | null
  | undefined;

export type MessageLike = {
  role?: string;
  content?: unknown;
};

export type BuildRequestOptions = {
  sourceBody?: Record<string, unknown> | null;
  normalizedBody?: Record<string, unknown> | null;
  claudeBody?: Record<string, unknown> | null;
  model: string;
  stream?: boolean;
  cwd?: string;
  now?: Date;
  sessionId?: string | null;
  preserveCacheControl?: boolean;
  preserveClaudeMessages?: boolean;
  redactThinking?: boolean;
  summarizeThinking?: boolean;
};
