/**
 * Anti-cheat system — server-side validation and anomaly detection.
 *
 * @module lib/gamification/antiCheat
 */

import { getAsyncDb } from "../db/core";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreValidation {
  allowed: boolean;
  reason?: string;
}

interface AnomalyFlag {
  apiKeyId: string;
  xpLastHour: number;
  zScore: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const MAX_XP_PER_WINDOW = 1000;
const ANOMALY_Z_THRESHOLD = 3;
const ANOMALY_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * SQLite `datetime('now', '-1 hour')` produces the canonical `YYYY-MM-DD
 * HH:MM:SS` (UTC) text that `xp_audit_log.created_at` stores. Reproduce that
 * exact text in JS so the `created_at > ?` comparison stays a text-to-text
 * comparison in BOTH drivers. Postgres' dialect rewrites `datetime('now', ...)`
 * to `NOW() - INTERVAL` (a timestamptz), which breaks against the TEXT
 * `created_at` column (`operator does not exist: text > timestamp with time
 * zone`) — passing the cutoff as a plain text parameter avoids that entirely.
 */
function anomalyWindowCutoff(): string {
  return new Date(Date.now() - ANOMALY_WINDOW_MS).toISOString().slice(0, 19).replace("T", " ");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate a score change. Returns true if allowed, false if suspicious.
 */
export async function validateScoreChange(
  apiKeyId: string,
  _action: string,
  amount: number
): Promise<ScoreValidation> {
  // Rate limiting: max XP per window
  const recentXp = await getRecentXp(apiKeyId, RATE_LIMIT_WINDOW_MS);
  if (recentXp + amount > MAX_XP_PER_WINDOW) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${recentXp + amount} > ${MAX_XP_PER_WINDOW} XP/min`,
    };
  }

  // Anomaly detection: check if this user's XP velocity is abnormal
  const isAnomaly = await detectAnomaly(apiKeyId);
  if (isAnomaly) {
    return { allowed: false, reason: "Anomalous XP velocity detected" };
  }

  return { allowed: true };
}

/**
 * Get flagged anomalies for admin review.
 */
export async function getAnomalies(): Promise<AnomalyFlag[]> {
  const d = getAsyncDb();
  const cutoff = anomalyWindowCutoff();

  const rows = (await d
    .prepare(
      `SELECT api_key_id, SUM(xp_earned) AS hourly_total
       FROM xp_audit_log
       WHERE created_at > ?
       GROUP BY api_key_id
       HAVING SUM(xp_earned) > 1000`
    )
    .all(cutoff)) as Array<{ api_key_id: string; hourly_total: number }>;

  const results: AnomalyFlag[] = [];
  for (const r of rows) {
    const z = await computeZScore(r.api_key_id);
    results.push({
      apiKeyId: r.api_key_id,
      xpLastHour: r.hourly_total,
      zScore: z ?? 0,
    });
  }
  return results;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Compute the z-score for a user's hourly XP against the global distribution.
 * Returns null if insufficient data.
 */
async function computeZScore(apiKeyId: string): Promise<number | null> {
  const d = getAsyncDb();
  const cutoff = anomalyWindowCutoff();

  const userRow = (await d
    .prepare(
      `SELECT COALESCE(SUM(xp_earned), 0) AS total
       FROM xp_audit_log
       WHERE api_key_id = ? AND created_at > ?`
    )
    .get(apiKeyId, cutoff)) as { total: number };

  const statsRow = (await d
    .prepare(
      `SELECT AVG(hourly_total) AS mean,
              CASE WHEN AVG(hourly_total) = 0 THEN 1
                   ELSE AVG(hourly_total * hourly_total) - AVG(hourly_total) * AVG(hourly_total)
              END AS variance
       FROM (
         SELECT api_key_id, SUM(xp_earned) AS hourly_total
         FROM xp_audit_log
         WHERE created_at > ?
         GROUP BY api_key_id
       )`
    )
    .get(cutoff)) as { mean: number; variance: number } | undefined;

  if (!statsRow || statsRow.variance <= 0) return null;

  const stdDev = Math.sqrt(statsRow.variance);
  return (userRow.total - statsRow.mean) / stdDev;
}

/**
 * Get total XP earned in the last N milliseconds.
 */
async function getRecentXp(apiKeyId: string, windowMs: number): Promise<number> {
  const d = getAsyncDb();
  const since = new Date(Date.now() - windowMs).toISOString();

  const row = (await d
    .prepare(
      "SELECT COALESCE(SUM(xp_earned), 0) AS total FROM xp_audit_log WHERE api_key_id = ? AND created_at > ?"
    )
    .get(apiKeyId, since)) as { total: number };

  return row.total;
}

/**
 * Detect anomalous XP velocity using z-score.
 */
async function detectAnomaly(apiKeyId: string): Promise<boolean> {
  const z = await computeZScore(apiKeyId);
  return z !== null && z > ANOMALY_Z_THRESHOLD;
}
