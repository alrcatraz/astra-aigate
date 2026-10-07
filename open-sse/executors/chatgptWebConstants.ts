/**
 * Static chatgpt.com endpoint/UA constants, extracted from `chatgpt-web.ts`.
 *
 * Session + client-version identifiers captured from a real browser session;
 * they change only when OpenAI ships a new web client.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

export const CHATGPT_BASE = "https://chatgpt.com";
export const SESSION_URL = `${CHATGPT_BASE}/api/auth/session`;
export const SENTINEL_PREPARE_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements/prepare`;
export const SENTINEL_CR_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;
export const CONV_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;
export const USER_LAST_USED_MODEL_CONFIG_URL = `${CHATGPT_BASE}/backend-api/settings/user_last_used_model_config`;

export const DEFAULT_PRO_POLL_TIMEOUT_MS = 20 * 60_000;
export const DEFAULT_PRO_POLL_INTERVAL_MS = 4_000;

export const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

// Captured from a real chatgpt.com browser session (April 2026).
export const OAI_CLIENT_VERSION = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
export const OAI_CLIENT_BUILD_NUMBER = "6128297";
