/**
 * Expiry check for OAuth-style tokens, extracted from chatCore.ts so the core
 * handler stays under its frozen size budget.
 */

/**
 * True when the token's expiry timestamp falls within `bufferMs` of now.
 * Returns false for a missing expiry (treated as "no known deadline").
 */
export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return expiresAtMs - Date.now() < bufferMs;
}
