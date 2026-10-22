/**
 * Static failure-signal tables for account fallback decisions, extracted
 * from accountFallback.ts so the matcher logic stays readable. Each table
 * is the single source of truth for one failure family (deactivation,
 * credits, OAuth expiry, context overflow).
 */

// T06 (sub2api PR #1037): Signals that indicate permanent account deactivation.
// When a 401 body contains these strings, the account is permanently dead
// and should NOT be retried after token refresh.
export const ACCOUNT_DEACTIVATED_SIGNALS = [
  "account_deactivated",
  "account has been deactivated",
  "account has been disabled",
  "your account has been suspended",
  "this account is deactivated",
  // AG (Antigravity/Google Cloud Code) permanent ban signals
  "verify your account to continue",
  "this service has been disabled in this account for violation",
  "this service has been disabled in this account",
];

// T10 (sub2api PR #1169): Signals that indicate billing credits are exhausted.
// Distinct from rate-limit 429 — the account won't recover until credits are added.
export const CREDITS_EXHAUSTED_SIGNALS = [
  "insufficient_quota",
  "billing_hard_limit_reached",
  "exceeded your current quota",
  "exceeded your current usage quota",
  "credit_balance_too_low",
  "your credit balance is too low",
  "credits exhausted",
  "out of credits",
  "payment required",
  "free tier of the model has been exhausted",
  // #5239: providers (e.g. DeepSeek/GLM-style) return "Insufficient account balance"
  // on a depleted key. 402 is already terminalized by status, but catch non-402
  // out-of-credit bodies here too.
  "insufficient balance",
  "insufficient_balance",
  "insufficient account balance",
];

// T11: Signals that indicate OAuth token is invalid/expired (not permanent deactivation)
export const OAUTH_INVALID_TOKEN_SIGNALS = [
  "invalid authentication credentials",
  "oauth 2",
  "login cookie",
  "valid authentication credential",
  "invalid credentials",
];

// Context overflow patterns — the prompt exceeds the model's maximum context length.
// Different providers phrase this differently. Used to decide whether a 400 error
// should trigger combo fallback (a different model may have a larger context window).
// Exported so combo.ts's isContextOverflow400() guard (open-sse/services/combo.ts)
// can reuse this single source of truth instead of maintaining its own,
// independently-drifting pattern list (see issue #6637).
export const CONTEXT_OVERFLOW_PATTERNS = [
  /\binput is too long\b/i,
  /\binput too long\b/i,
  /\bcontext.*(too long|exceeded|overflow|limit)/i,
  /\btoo many tokens\b/i,
  /\bprompt is too long\b/i,
  /\bcontext window/i,
  /\bmaximum context/i,
  /\bmax.*token/i,
  /\btoken limit/i,
  /\brequest too large\b/i,
];
