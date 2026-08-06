-- 135_services.sql
-- Phase 3.8: auxiliary services registry (Services Monitor). One row per
-- non-MCP service hosted behind the AI Gate gateway — health-checked via
-- `health_endpoint` and optionally proxied behind the gateway.
-- `last_status` is the most recent probe result; full history lives in
-- `health_logs`.
--
-- No preset rows: services are user-added via the panel. (Deployment-specific
-- presets — Camofox/SearXNG pointing at a private LAN — were removed before
-- release so published images ship an empty registry.)
--
-- `url` is the USER-FACING access path (LAN/VPN reachable from a browser),
-- `health_endpoint` is the gateway-container-internal path used for probes.

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'web' CHECK (type IN ('web', 'http')),
  url TEXT NOT NULL,
  health_endpoint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  system INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'marketplace')),
  last_status TEXT NOT NULL DEFAULT 'unknown' CHECK (last_status IN ('up', 'down', 'unknown')),
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_enabled
  ON services (enabled);

-- Health probe history (bounded by the probe route — older rows pruned).
CREATE TABLE IF NOT EXISTS health_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('up', 'down', 'unknown')),
  latency_ms INTEGER,
  error TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_logs_service
  ON health_logs (service_id, checked_at DESC);
