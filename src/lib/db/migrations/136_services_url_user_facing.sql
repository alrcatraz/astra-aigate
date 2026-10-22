-- 136_services_url_user_facing.sql
-- Phase 3.8 follow-up: `services.url` semantics changed from
-- gateway-container-internal view (127.0.0.1 / host.containers.internal)
-- to USER-FACING access paths (LAN/VPN reachable from a browser).
-- Health probes keep using `health_endpoint` (unchanged).
-- Applies to deployments that already ran 135.

-- Deployment-specific service URLs (camofox / searxng) are intentionally NOT
-- seeded here: the upstream product ships only generic defaults. Operators
-- configure their own endpoints via the Services admin UI / private config.
