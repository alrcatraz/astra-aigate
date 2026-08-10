/**
 * sourceKind.ts — Skill Hub 多源统一模型核心类型 (Phase 4 M0)
 *
 * 设计见 _references/skill-hub-multisource-design.md：
 *   §3.1 Skill 三维身份 = { source + artifact + target }
 *   §3.2 SourceAdapter 统一接口
 *   §3.3 SkillSourceKind 枚举（全部只读，hub 不写远端 repo）
 *   §3.5 InstallTarget 开放枚举（优先 Hermes+OpenCode，覆盖面开放）
 *   §3.6 DB 扩展
 *
 * 所有源 adapter 均为只读消费者（writable=false，单一数据源原则）——
 * hub 只管 读源 / 写自身 DB / 落地 Agent 目录，绝不反写 GitHub/Gitea。
 */

/** Skill 源类型（7 枚举）。全部只读拉取。 */
export const SKILL_SOURCE_KINDS = [
  "skillssh", // 外部 hub — skills.sh 公开目录
  "skillsmp", // 外部 hub — SkillsMP
  "github-search", // 外部 GitHub 搜索（githubCollector）
  "local", // 本地独立 skill（不入 repo）
  "github-public", // 项目附属·GitHub 发布（读写归开发流程，hub 只读）
  "gitea", // 项目附属·Gitea 私有（含个人信息，只读，绝不推 GitHub）
  "omniroute-builtin", // OmniRoute 自带（分桶隔离，预置只读锁）
] as const;
export type SkillSourceKind = (typeof SKILL_SOURCE_KINDS)[number];

/** Agent 安装目标（开放枚举，优先实现 hermes+opencode，覆盖面开放）。 */
export const AGENT_TARGETS = [
  "hermes", // Hermes Agent  — ~/.hermes/skills/<category>/<name>
  "opencode", // OpenCode      — ~/.config/opencode/skills/<name>
  "claude", // Claude        — ~/.claude/skills/<name>（扩展位，非优先）
  "cursor", // Cursor        — 扩展位
  "ai-gate", // AI Gate DB    — 现有执行型 skill 行为
] as const;
export type AgentTarget = (typeof AGENT_TARGETS)[number];

/** Skill 产物/格式类型（区分两类 skill 语义，决策 D6）。 */
export const SKILL_ARTIFACTS = [
  "agentskill", // Agent Skills（SKILL.md）— 可分发给 Hermes/OpenCode 等
  "ai-gate-exec", // AI Gate 执行型（schema→handler→sandbox，现有 DB 语义）
  "agent-plugin", // Agent Plugins 便携包（M5+ 输出打包）
] as const;
export type SkillArtifact = (typeof SKILL_ARTIFACTS)[number];

/** Skill 唯一身份（同一 skill 名不同源可共存）。 */
export interface SkillIdentity {
  sourceRef: string; // 源内标识，如 "project:astra-sre" 或 source_kind 值
  externalId: string; // 源内 skill 唯一 ID
  name: string;
  version?: string;
}

/** SourceAdapter 统一接口 — 每个源实现此接口，hub 经 adapter 聚合。 */
export interface SkillSourceAdapter {
  kind: SkillSourceKind;
  /** 源实例 id（如用户登记的 "project:astra-sre"）。 */
  id: string;
  displayName: string;
  /** 恒为 false — hub 只读源，不写远端 repo（单一数据源原则）。 */
  readonly writable: false;
  /** 发现源下所有 skill 元数据。 */
  discover(): Promise<SkillMeta[]>;
  /** 拉取一个 skill 的完整内容（SKILL.md + references + scripts）。 */
  fetch(skill: SkillMeta): Promise<SkillContent>;
  /**
   * 检查源内 skill 是否有新版本（手动更新流，决策 4）。
   * 不自动应用，只返回变更信息由用户确认。
   */
  pollForUpdates?(lastSyncAt?: string): Promise<UpdateCheck>;
}

/** 源下发现的 skill 元数据。 */
export interface SkillMeta {
  name: string;
  version?: string;
  description?: string;
  /** 源内唯一 ID（external_id 的载体）。 */
  externalId: string;
  /** 子资源相对引用（如 repo 内 skills/<name> 路径）。 */
  ref?: string;
  tags?: string[];
  /** 可选：该 skill 配套的 Agent Skills frontmatter（compatibility 等）。 */
  artifact?: SkillArtifact;
  /** Source repo clean URL (token stripped) for smart-agent tracing. */
  sourceUrl?: string;
  /** Commit SHA captured from archive top-dir at fetch time. */
  commitSha?: string;
}

/** 拉取到的 skill 完整内容。 */
export interface SkillContent {
  name: string;
  version: string;
  skillMd: string; // SKILL.md 全文
  references?: Record<string, string>; // references/<f> → content
  scripts?: Record<string, string>; // scripts/<f> → content
}

/** 手动更新检查结果（决策 4：只标记，不自动应用）。 */
export interface UpdateCheck {
  sourceRef: string;
  updated: boolean;
  /** 若有更新：可更新技能 + 各自新版本。 */
  availableUpdates?: Array<{ name: string; oldVersion?: string; newVersion: string }>;
  checkedAt: string;
}

/** 用户登记的 skill 源实例（skill_sources 表的映射）。 */
export interface SkillSourceInstance {
  id: string;
  kind: SkillSourceKind;
  name: string;
  url?: string;
  skillsPath: string;
  credentialRef?: string;
  autoUpdate: boolean; // 决策 4：默认 false
  lastSyncAt?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
