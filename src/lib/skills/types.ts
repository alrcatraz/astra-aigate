import type { AgentTarget, SkillArtifact, SkillSourceKind } from "./sourceKind";

export enum SkillStatus {
  PENDING = "pending",
  RUNNING = "running",
  SUCCESS = "success",
  ERROR = "error",
  TIMEOUT = "timeout",
}

export enum SkillMode {
  AUTO = "auto",
  MANUAL = "manual",
  HYBRID = "hybrid",
}

export interface SkillSchema {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface Skill {
  id: string;
  apiKeyId: string;
  name: string;
  version: string;
  description: string;
  schema: SkillSchema;
  handler: string;
  enabled: boolean;
  mode?: "on" | "off" | "auto";
  // ── Skill Hub 多源 (Phase 4 M0) ──
  sourceProvider?: "skillsmp" | "skillssh" | "local";
  sourceKind?: SkillSourceKind; // 7 枚举（扩展源，§3.3）
  sourceRef?: string; // 源内标识（如 "project:astra-sre"）
  sourceUrl?: string;
  externalId?: string; // 源内 skill 唯一 ID
  artifact?: SkillArtifact; // agentskill / ai-gate-exec / agent-plugin
  enabledTargets?: AgentTarget[]; // 已分发的 Agent 目标
  updatePending?: boolean; // 源有新版本待用户确认（手动更新流）
  tags?: string[];
  installCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillExecution {
  id: string;
  skillId: string;
  apiKeyId: string;
  sessionId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: SkillStatus;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface SkillConfig {
  enabled: boolean;
  mode: SkillMode;
  allowedSkills: string[];
  timeout: number;
  maxRetries: number;
}

export type SkillHandler = (
  input: Record<string, unknown>,
  // provider/model (#7339): optional so existing handlers stay untouched — only the
  // web_fetch builtin uses them to resolve a per-model pinned fetch backend.
  context: { apiKeyId: string; sessionId: string; provider?: string; model?: string }
) => Promise<Record<string, unknown>>;
