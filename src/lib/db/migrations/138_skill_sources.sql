-- 138_skill_sources.sql
-- Skill Hub 多源统一模型 (Phase 4 M0) — 扩展 skills 表 + 新增 skill_sources 表。
--
-- 背景（见 _references/skill-hub-multisource-design.md §3.3/§3.6）：
--   现有 `source_provider` 枚举过窄（skillsmp/skillssh/local），无法表达
--   「项目附属 GitHub 发布 / Gitea 私有 / 外部 GitHub 搜索 / OmniRoute 内置」
--   等新源。保持 source_provider 向后兼容（旧读路径不回退），新增结构化字段。
--
-- `source_kind`      : 7 枚举（skillssh/skillsmp/github-search/local/
--                      github-public/gitea/omniroute-builtin）
-- `source_ref`       : 源内标识，如 "project:astra-sre"（用户登记的源实例 id）
-- `source_url`       : 源 repo/URL（只读拉取用）
-- `external_id`      : 源内 skill 唯一 ID（resolve 同 skill 不同来源共存）
-- `artifact`         : agentskill(SKILL.md 装远端 Agent) / ai-gate-exec(AI Gate 执行型)
--                      / agent-plugin(Agent Plugins 包，M5+)
-- `enabled_targets`  : JSON 数组，该 skill 已分发的 Agent 目标
--                      (hermes/opencode/claude/cursor/ai-gate)
-- `update_pending`   : 源 repo 有新版本待用户确认（手动更新流，决策 4）

ALTER TABLE skills ADD COLUMN source_kind TEXT;
ALTER TABLE skills ADD COLUMN source_ref TEXT;
ALTER TABLE skills ADD COLUMN source_url TEXT;
ALTER TABLE skills ADD COLUMN external_id TEXT;
ALTER TABLE skills ADD COLUMN artifact TEXT NOT NULL DEFAULT 'agentskill';
ALTER TABLE skills ADD COLUMN enabled_targets TEXT NOT NULL DEFAULT '[]';
ALTER TABLE skills ADD COLUMN update_pending INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_skills_source_kind ON skills(source_kind);

-- 用户登记的 skill 源实例（决策 5：源由用户登记，不自动扫全盘）
-- `kind`             : 源类型（source_kind 枚举）
-- `name`             : 源显示名（如 "astra-sre"）
-- `url`              : repo 地址
-- `skills_path`      : repo 内 skills/ 相对路径
-- `credential_ref`   : 认证引用（只读拉取用，绝不用于 push；值不入库，存引用）
-- `auto_update`      : 决策 4 默认 0（以 Repo 为准 + 手动确认）
-- `last_sync_at`     : 上次 discover/拉取时间
-- `enabled`          : 该源是否启用
CREATE TABLE IF NOT EXISTS skill_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  skills_path TEXT NOT NULL DEFAULT 'skills',
  credential_ref TEXT,
  auto_update INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skill_sources_kind ON skill_sources(kind);
CREATE INDEX IF NOT EXISTS idx_skill_sources_name ON skill_sources(name);
