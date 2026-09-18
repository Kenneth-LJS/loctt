import { describe, expect, it } from "vitest";

import { dayHeading, dayKey, previousDay, timeIn, todayIn } from "./days.ts";

/**
 * CMT-13's last bullet and CMT-31, which are the same requirement seen
 * twice: the day an entry belongs to, and the words "Today" and
 * "Yesterday", are decided by `calendar.yaml`'s timezone rather than
 * the browser's.
 *
 * Every fixture here places an instant where the two zones **disagree**,
 * because a fixture where they agree cannot tell a timezone-aware
 * implementation from one that ignores its argument.
 */

describe("dayKey", () => {
  /** @verifies CMT-13 */
  it("returns the calendar day in the given zone, not UTC", () => {
    // 15:50Z is 23:50 in Singapore on the same date; 16:10Z is 00:10
    // the next day. UTC never crosses.
    expect(dayKey("2026-08-27T15:50:00.000Z", "Asia/Singapore")).toBe("2026-08-27");
    expect(dayKey("2026-08-27T16:10:00.000Z", "Asia/Singapore")).toBe("2026-08-28");
    expect(dayKey("2026-08-27T16:10:00.000Z", "UTC")).toBe("2026-08-27");
  });

  /** @verifies CMT-13 */
  it("crosses backwards for zones behind UTC", () => {
    // 02:00Z on the 28th is still 19:00 on the 27th in Los Angeles.
    expect(dayKey("2026-08-28T02:00:00.000Z", "America/Los_Angeles")).toBe("2026-08-27");
    expect(dayKey("2026-08-28T02:00:00.000Z", "UTC")).toBe("2026-08-28");
  });

  /**
   * P7. A `calendar.yaml` with a typo'd zone is config drift, and a
   * thrown `RangeError` would take the whole section down over it.
   */
  it("falls back to UTC rather than throwing on an unknown timezone", () => {
    expect(dayKey("2026-08-27T16:10:00.000Z", "Not/AZone")).toBe("2026-08-27");
  });
});

describe("dayHeading", () => {
  /** @verifies CMT-31 */
  it("names today and yesterday relative to the workspace's own day", () => {
    expect(dayHeading("2026-08-29", "2026-08-29")).toBe("Today");
    expect(dayHeading("2026-08-28", "2026-08-29")).toBe("Yesterday");
  });

  /**
   * CMT-31's second bullet, as a *heading*: at 23:50 in Los Angeles on
   * the 28th, a Singapore workspace is already on the 29th. The entry
   * written a moment ago is "Today" by the workspace's reckoning, and
   * would be "Tomorrow" — a heading that cannot exist — by the
   * browser's. Composed from the two functions the panel composes, so
   * it fails if either half drops the zone.
   */
  /** @verifies CMT-31 */
  it("computes Today from the workspace clock, not the browser's", () => {
    const nowUtc = Date.parse("2026-08-29T06:50:00.000Z"); // 23:50 on the 28th in LA
    const entry = "2026-08-29T06:50:00.000Z";

    const sgToday = todayIn("Asia/Singapore", nowUtc);
    expect(sgToday).toBe("2026-08-29");
    expect(dayHeading(dayKey(entry, "Asia/Singapore"), sgToday)).toBe("Today");

    // The same instant, read by a Los Angeles browser, is the 28th —
    // which is what the workspace zone exists to override.
    const laToday = todayIn("America/Los_Angeles", nowUtc);
    expect(laToday).toBe("2026-08-28");
    expect(dayHeading(dayKey(entry, "America/Los_Angeles"), laToday)).toBe("Today");
    expect(sgToday).not.toBe(laToday);
  });

  /**
   * CMT-31's first bullet. A weekend and a holiday get their own
   * headings like any other day — nothing here consults
   * `first_day_of_week` or `holidays`, so a run of consecutive dates
   * yields a run of consecutive distinct headings, none merged and
   * none skipped.
   */
  /** @verifies CMT-31 */
  it("gives every calendar day its own heading, weekends included", () => {
    // 2026-08-29 is a Saturday; the 30th a Sunday.
    const headings = ["2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"]
      .map(d => dayHeading(d, "2026-09-05"));
    expect(new Set(headings).size).toBe(4);
    expect(headings[1]).toContain("Saturday");
    expect(headings[2]).toContain("Sunday");
  });

  it("writes an older day out in full", () => {
    expect(dayHeading("2026-08-27", "2026-08-29"))
      .toBe("Thursday, August 27, 2026");
  });
});

describe("previousDay", () => {
  it("steps back across a month boundary", () => {
    expect(previousDay("2026-09-01")).toBe("2026-08-31");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });
});

describe("timeIn", () => {
  it("renders the clock time in the workspace zone", () => {
    expect(timeIn("2026-08-27T16:10:00.000Z", "Asia/Singapore")).toBe("12:10 AM");
    expect(timeIn("2026-08-27T16:10:00.000Z", "UTC")).toBe("4:10 PM");
  });
});
