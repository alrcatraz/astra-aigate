/**
 * Window period anchoring. These semantics decide whether a "used since X"
 * reading is comparable to the provider's own meter, so each kind is pinned:
 *
 *   rolling  — trailing span (OpenCode's 5h allowance)
 *   calendar — civil boundary (OpenCode's weekly window = Monday 00:00 UTC)
 *   billing  — anniversary period that keeps advancing from a static anchor
 *
 * The weekly case is a regression guard: measuring a calendar-week window with
 * a rolling 7-day span silently mixes two periods and produced a week of
 * unusable measurements in production.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  shiftMonths,
  startOfUtcMonth,
  startOfUtcWeek,
  windowPeriodEnd,
  windowPeriodStart,
  windowPeriodStartIso,
  startOfUtcWeekSunday,
} from "../../src/lib/quota/windowPeriods.ts";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

test("rolling: trailing span from now", () => {
  const now = new Date("2026-10-28T12:34:56.000Z");
  const start = windowPeriodStart({ kind: "rolling", hours: 5 }, now);
  assert.equal(iso(start), "2026-10-28T07:34:56.000Z");
  assert.equal(
    iso(windowPeriodEnd({ kind: "rolling", hours: 5 }, now)),
    "2026-10-28T17:34:56.000Z"
  );
});

test("calendar week: Monday 00:00 UTC", () => {
  // Wednesday
  const now = new Date("2026-10-28T12:00:00.000Z");
  assert.equal(iso(startOfUtcWeek(now)), "2026-10-26T00:00:00.000Z");
  // Sunday belongs to the week that started the previous Monday
  assert.equal(
    iso(startOfUtcWeek(new Date("2026-11-01T23:59:59.000Z"))),
    "2026-10-26T00:00:00.000Z"
  );
  // Monday at 00:00 is the boundary itself
  assert.equal(
    iso(startOfUtcWeek(new Date("2026-11-02T00:00:00.000Z"))),
    "2026-11-02T00:00:00.000Z"
  );
  assert.equal(
    iso(startOfUtcWeekSunday(new Date("2026-10-28T12:00:00.000Z"))),
    "2026-10-25T00:00:00.000Z"
  );
});

test("calendar month and reset instant", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");
  assert.equal(iso(startOfUtcMonth(now)), "2026-10-01T00:00:00.000Z");
  assert.equal(
    iso(windowPeriodEnd({ kind: "calendar", unit: "month" }, now)),
    "2026-11-01T00:00:00.000Z"
  );
  assert.equal(
    iso(windowPeriodEnd({ kind: "calendar", unit: "week" }, now)),
    "2026-11-02T00:00:00.000Z"
  );
});

test("billing: static anchor keeps advancing month by month", () => {
  const anchor = { kind: "billing" as const, anchor: "2026-10-22T06:08:40.000Z" };

  // inside the first period
  assert.equal(
    iso(windowPeriodStart(anchor, new Date("2026-10-28T12:00:00.000Z"))),
    "2026-10-22T06:08:40.000Z"
  );
  // inside the second period
  assert.equal(
    iso(windowPeriodStart(anchor, new Date("2026-11-25T00:00:00.000Z"))),
    "2026-11-22T06:08:40.000Z"
  );
  // boundary instant belongs to the new period
  assert.equal(
    iso(windowPeriodStart(anchor, new Date("2026-11-22T06:08:40.000Z"))),
    "2026-11-22T06:08:40.000Z"
  );
  // reset of the second period
  assert.equal(
    iso(windowPeriodEnd(anchor, new Date("2026-11-25T00:00:00.000Z"))),
    "2026-12-22T06:08:40.000Z"
  );
  // far future still resolves by whole months
  assert.equal(
    iso(windowPeriodStart(anchor, new Date("2027-03-01T00:00:00.000Z"))),
    "2027-02-22T06:08:40.000Z"
  );
  // anchor in the future → previous period
  assert.equal(
    iso(
      windowPeriodStart(
        { kind: "billing", anchor: "2026-12-22T06:08:40.000Z" },
        new Date("2026-12-01T00:00:00.000Z")
      )
    ),
    "2026-11-22T06:08:40.000Z"
  );
});

test("shiftMonths clamps to the target month length", () => {
  assert.equal(
    iso(shiftMonths(new Date("2026-01-31T00:00:00.000Z"), 1)),
    "2026-02-28T00:00:00.000Z"
  );
  assert.equal(
    iso(shiftMonths(new Date("2026-03-31T00:00:00.000Z"), -1)),
    "2026-02-28T00:00:00.000Z"
  );
});

test("unknown period resolves to null instead of guessing", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");
  assert.equal(windowPeriodStartIso(undefined, now), null);
  assert.equal(
    iso(windowPeriodStart({ kind: "billing", anchor: "not-a-date" } as never, now)),
    null
  );
});
