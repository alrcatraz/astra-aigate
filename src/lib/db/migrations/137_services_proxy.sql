-- 137_services_proxy.sql
-- Phase 3.8 B 方案 (2026-08-05 定稿): services 统一端点反代。
--
-- `url` 语义更新: 对外统一入口（AI Gate 网关相对路径，部署无关——
--   显示层拼 baseUrl 成完整 https://<ai-gate>/svc/<id>/... 供复制）。
-- `proxied` 1 = 该服务经 AI Gate 反代（/api/svc/[id]/[...path] 动态转发），
--   0 = 直连（不进网关，仅登记/健康检查）。
-- `upstream` AI Gate 容器内部真实转发目标（共享 netns=127.0.0.1:port，
--   宿主侧服务=host.containers.internal:port）。
-- `required_scope` 访问该服务需要的 API-key scope（如 svc:camofox；
--   空 = 端点层开放，同 MCP 约定）。
-- `auth_type`/`auth_secret` 下游服务自身凭证（bearer/header），
--   auth_secret 加密 at-rest（照 mcp_servers 模式），转发时解密注入。

ALTER TABLE services ADD COLUMN proxied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN upstream TEXT;
ALTER TABLE services ADD COLUMN required_scope TEXT;
ALTER TABLE services ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'none'
  CHECK (auth_type IN ('none', 'bearer', 'header'));
ALTER TABLE services ADD COLUMN auth_secret TEXT;
