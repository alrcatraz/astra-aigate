-- 134_mcp_servers.sql
-- Phase 3: MCP gateway registry. One row per MCP endpoint exposed by the
-- AI Gate gateway. `kind` is pure connection semantics (builtin | stdio | http),
-- not a brand; preset rows are `system=1` (cannot be deleted, only disabled).
-- `auth_secret` holds downstream-service credentials encrypted via
-- src/lib/db/encryption.ts (encryptConnectionFields) — the gateway injects
-- them when forwarding to stdio/http backends, so consumers only ever hold
-- one AI Gate API key.

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_id TEXT NOT NULL DEFAULT 'custom',
  kind TEXT NOT NULL CHECK (kind IN ('builtin', 'stdio', 'http')),
  command TEXT,
  args TEXT,
  url TEXT,
  auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'header')),
  auth_secret TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  system INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'marketplace')),
  required_scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_group
  ON mcp_servers (group_id);

-- Preset entries (Phase 3): aigate group, system=1 — disable-only, never delete.
-- aigate-omniroute: all Phase 1-2 tools served by the existing createMcpServer().
-- aigate-mcp: Phase 3 management tools (mcp_* prefix).
-- aigate-infra: Phase 4 placeholder, disabled until implemented.
INSERT OR IGNORE INTO mcp_servers
  (id, name, group_id, kind, enabled, system, source, required_scope)
VALUES
  ('aigate-omniroute', 'OmniRoute Tools', 'aigate', 'builtin', 1, 1, 'manual', NULL),
  ('aigate-mcp', 'MCP Management', 'aigate', 'builtin', 1, 1, 'manual', 'admin:mcp'),
  ('aigate-infra', 'Infrastructure (Phase 4)', 'aigate', 'builtin', 0, 1, 'manual', NULL);
