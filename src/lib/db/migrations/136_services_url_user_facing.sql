-- 136_services_url_user_facing.sql
-- Phase 3.8 follow-up: `services.url` semantics changed from
-- gateway-container-internal view (127.0.0.1 / host.containers.internal)
-- to USER-FACING access paths (LAN/VPN reachable from a browser).
-- Health probes keep using `health_endpoint` (unchanged).
-- Applies to deployments that already ran 135.

UPDATE services
SET url = 'http://192.168.0.200:9377'
WHERE id = 'camofox';

UPDATE services
SET url = 'http://10.0.40.1:8080'
WHERE id = 'searxng';
