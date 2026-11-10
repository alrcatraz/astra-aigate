-- 139_model_capabilities.sql
-- Promote `model_capabilities` from a lazily-created runtime table to a real migration.
--
-- 背景（移植自上游 OmniRoute #16809 / v3.8.50 的 `169_model_capabilities.sql`）：
--   该表此前只由 src/lib/modelsDevSync.ts 的 `ensureCapabilitiesTable()` 在首次
--   models.dev capability 同步时按需创建。于是「数据库里有没有这张表」取决于
--   运行时时机，而不是 schema 版本 —— 全新安装与升级后的安装因结构性原因产生
--   分叉：跑过同步的旧库有表，没跑过同步的新库没有表。
--
--   这里正式建表让两条安装路径确定性收敛。`ensureCapabilitiesTable()` 保留为
--   幂等安全网（`CREATE TABLE IF NOT EXISTS`，现在总是 no-op）。
--
-- IF NOT EXISTS 是必需的而非装饰：任何跑过 models.dev 同步的库已经有这张表，
-- 本迁移对它们必须是 no-op。
--
-- 注意：上游 main 分支曾把它编号为 163，但 release 线的 163 号已被
-- `163_radar_feed_cache_generated_at.sql` 占用（上游自身已分裂为两条编号线）。
-- 本仓库迁移号段到 138 为止且禁止新缺口（scripts/check/check-migration-numbering.mjs），
-- 故本迁移取下一个号 139。

CREATE TABLE IF NOT EXISTS model_capabilities (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  tool_call BOOLEAN,
  reasoning BOOLEAN,
  attachment BOOLEAN,
  structured_output BOOLEAN,
  temperature BOOLEAN,
  modalities_input TEXT,
  modalities_output TEXT,
  knowledge_cutoff TEXT,
  release_date TEXT,
  last_updated TEXT,
  status TEXT,
  family TEXT,
  open_weights BOOLEAN,
  limit_context INTEGER,
  limit_input INTEGER,
  limit_output INTEGER,
  interleaved_field TEXT,
  last_synced TEXT,
  PRIMARY KEY (provider, model_id)
);