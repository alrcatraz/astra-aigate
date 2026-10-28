/**
 * windowPeriods.ts — period anchoring for quota windows.
 *
 * A quota window is not a duration: providers anchor them differently, and the
 * difference decides whether "used since <start>" is even meaningful.
 *
 *   rolling  — a fixed span ending now (e.g. OpenCode's 5h allowance, which
 *              starts at the first request after the previous reset)
 *   calendar — a civil boundary (OpenCode's weekly window resets Monday
 *              00:00 UTC regardless of when traffic started)
 *   billing  — the subscription period (OpenCode Go's month runs from the
 *              purchase anniversary, e.g. 22nd 06:08 UTC → 22nd 06:08 UTC)
 *
 * Measuring a calendar or billing window with a rolling span (or vice versa)
 * silently mixes two periods and produces numbers that look plausible and are
 * wrong. Keep the semantics in data (`QuotaDimension.period`) and resolve them
 * here, once, for every provider.
 */

import type { WindowPeriod } from "./dimensions";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Monday 00:00:00.000 UTC of the week containing `now`. */
export function startOfUtcWeek(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  // getUTCDay(): 0=Sunday … 6=Saturday → days since Monday
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - daysSinceMonday * DAY_MS);
}

/** Sunday 00:00:00.000 UTC of the week containing `now`. */
export function startOfUtcWeekSunday(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  return new Date(d.getTime() - d.getUTCDay() * DAY_MS);
}

/** First day 00:00:00.000 UTC of the month containing `now`. */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** 00:00:00.000 UTC of the day containing `now`. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Resolve the start instant of `period` as observed at `now`.
 * Returns null when the period cannot be anchored (unknown kind / bad anchor),
 * so callers fall back to a trailing span instead of guessing silently.
 */
export function windowPeriodStart(period: WindowPeriod | undefined, now: Date): Date | null {
  if (!period) return null;

  switch (period.kind) {
    case "rolling":
      return new Date(now.getTime() - period.hours * HOUR_MS);

    case "calendar":
      if (period.unit === "day") return startOfUtcDay(now);
      if (period.unit === "month") return startOfUtcMonth(now);
      return period.weekStartsOn === "sunday" ? startOfUtcWeekSunday(now) : startOfUtcWeek(now);

    case "billing": {
      const anchorMs = Date.parse(period.anchor);
      if (!Number.isFinite(anchorMs)) return null;
      const anchor = new Date(anchorMs);
      if (anchorMs > now.getTime()) {
        // anchor lies in the future → the period containing `now` began one
        // month earlier than the anchor
        return shiftMonths(anchor, -1);
      }
      // A catalogue anchor is written once (e.g. the first purchase date) but
      // must keep resolving forward: advance by whole months until the next
      // anniversary would pass `now`.
      let start = anchor;
      let next = shiftMonths(start, 1);
      let guard = 0;
      while (next.getTime() <= now.getTime() && guard < 240) {
        start = next;
        next = shiftMonths(start, 1);
        guard += 1;
      }
      return start;
    }

    default:
      return null;
  }
}

/** Add `months` calendar months, clamping the day to the target month's length. */
export function shiftMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m,
      Math.min(day, lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      0
    )
  );
}

/**
 * Resolve the reset instant of `period` as observed at `now` — the end of the
 * current period. Rolling windows reset at now+hours.
 */
export function windowPeriodEnd(period: WindowPeriod | undefined, now: Date): Date | null {
  if (!period) return null;

  switch (period.kind) {
    case "rolling":
      return new Date(now.getTime() + period.hours * HOUR_MS);

    case "calendar":
      if (period.unit === "day") return new Date(startOfUtcDay(now).getTime() + DAY_MS);
      if (period.unit === "month") {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      }
      return new Date(
        (period.weekStartsOn === "sunday"
          ? startOfUtcWeekSunday(now)
          : startOfUtcWeek(now)
        ).getTime() +
          7 * DAY_MS
      );

    case "billing": {
      const start = windowPeriodStart(period, now);
      if (!start) return null;
      return new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth() + 1,
          start.getUTCDate(),
          start.getUTCHours(),
          start.getUTCMinutes(),
          start.getUTCSeconds(),
          0
        )
      );
    }

    default:
      return null;
  }
}

/**
 * Convenience: ISO string of the period start, safe for query params.
 * Returns null when the period is unknown so callers can skip the fetch.
 */
export function windowPeriodStartIso(
  period: WindowPeriod | undefined,
  now: Date = new Date()
): string | null {
  const start = windowPeriodStart(period, now);
  return start ? start.toISOString() : null;
}
