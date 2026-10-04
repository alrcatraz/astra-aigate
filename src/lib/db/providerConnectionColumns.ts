/**
 * Provider-connection column metadata, extracted from `providers.ts`.
 *
 * The gateway keeps its own allowlists here so the file that owns the
 * connection CRUD logic stays focused on queries and projection handling.
 */

export const CONNECTION_CREDENTIAL_FIELDS = [
  "apiKey",
  "accessToken",
  "refreshToken",
  "idToken",
] as const;

export const PROVIDER_CONNECTIONS_COLUMNS = new Set([
  "id",
  "provider",
  "auth_type",
  "name",
  "email",
  "priority",
  "is_active",
  "access_token",
  "refresh_token",
  "expires_at",
  "token_expires_at",
  "scope",
  "project_id",
  "test_status",
  "error_code",
  "last_error",
  "last_error_at",
  "last_error_type",
  "last_error_source",
  "backoff_level",
  "rate_limited_until",
  "health_check_interval",
  "last_health_check_at",
  "last_tested",
  "api_key",
  "id_token",
  "provider_specific_data",
  "expires_in",
  "display_name",
  "global_priority",
  "default_model",
  "token_type",
  "consecutive_use_count",
  "rate_limit_protection",
  "last_used_at",
  "group",
  "max_concurrent",
  "proxy_enabled",
  "per_key_proxy_enabled",
  "quota_window_thresholds_json",
  "rate_limit_overrides_json",
  "created_at",
  "updated_at",
]);
