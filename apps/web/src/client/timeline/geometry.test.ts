import type { CalendarConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  addDays,
  barGeometry,
  computeRange,
  dateToX,
  DAY_WIDTH,
  daysBetween,
  eachDay,
  formatDay,
  headerCells,
  nonWorkingReason,
  parseDay,
  rangeWidth,
  xToDate,
} from "./geometry.ts";

/**
 * Bar geometry is arithmetic, so it is tested as arithmetic. A UI test
 * asserting "a bar is visible" passes whether or not its edges land on
 * the right dates — these assert the numbers.
 */

const calendar: CalendarConfig = {
  timezone: "UTC",
  first_day_of_week: 0,
  working_days: [1, 2, 3, 4, 5],
  holidays: [{ date: "2026-12-25", label: "Christmas Day" }],
};

describe("parseDay / formatDay", () => {
  it("parses YYYY-MM-DD at UTC midnight", () => {
    expect(formatDay(parseDay("2026-03-02") as number)).toBe("2026-03-02");
  });

  it("rejects a date that is not a real calendar day", () => {
    // Some engines roll 2026-02-31 forward to March. A rolled date
    // would place a bar on a day the user never typed.
    expect(parseDay("2026-02-31")).toBeUndefined();
  });

  it("rejects garbage and undefined rather than yielding NaN", () => {
    expect(parseDay("not a date")).toBeUndefined();
    expect(parseDay(undefined)).toBeUndefined();
  });
});

describe("daysBetween", () => {
  // @verifies TML-4
  it("counts whole days, signed, with same-day zero", () => {
    expect(daysBetween("2026-03-02", "2026-03-06")).toBe(4);
    expect(daysBetween("2026-03-02", "2026-03-02")).toBe(0);
    expect(daysBetween("2026-03-06", "2026-03-02")).toBe(-4);
  });

  /**
   * The DST case the brief called out. 2026-03-08 is US spring-forward:
   * in a local-time implementation that day is 23 hours, so a division
   * by 86_400_000 yields 8.958… and rounds or truncates a bar one
   * column off for every task after it in the year.
   */
  it("is exact across a DST boundary", () => {
    expect(daysBetween("2026-03-01", "2026-03-10")).toBe(9);
    // And across the autumn transition, which is 25 hours locally.
    expect(daysBetween("2026-10-30", "2026-11-05")).toBe(6);
  });

  it("crosses a month and a year boundary", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
    // 2028 is a leap year: Feb has 29 days.
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("addDays", () => {
  it("adds and subtracts across month ends", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2026-03-02", -3)).toBe("2026-02-27");
  });
});

describe("barGeometry", () => {
  const range = { start: "2026-03-01", end: "2026-03-31" };

  // @verifies TML-4
  it("draws a single-day task exactly one column wide", () => {
    const bar = barGeometry(range, "2026-03-02", "2026-03-02", "day");
    expect(bar.width).toBe(DAY_WIDTH.day);
    expect(bar.width).toBeGreaterThan(0);
  });

  // @verifies TML-4
  it("draws an inclusive 5-day span as 5 columns, right edge at the end of the due day", () => {
    const bar = barGeometry(range, "2026-03-02", "2026-03-06", "day");
    expect(bar.width).toBe(5 * DAY_WIDTH.day);
    // The right edge sits at the END of 2026-03-06 — i.e. where
    // 2026-03-07's column starts — not at its start.
    expect(bar.left + bar.width).toBe(dateToX(range, "2026-03-07", "day"));
  });

  // @verifies TML-4
  it("aligns the left edge with the start_date gridline", () => {
    const bar = barGeometry(range, "2026-03-02", "2026-03-06", "day");
    expect(bar.left).toBe(dateToX(range, "2026-03-02", "day"));
  });

  // @verifies TML-3
  it("rescales the same span consistently across all three zooms", () => {
    // TML-3: 5 day-columns at day zoom, ~one column at week zoom, a
    // fraction of one column at month zoom.
    const day = barGeometry(range, "2026-03-02", "2026-03-06", "day");
    const week = barGeometry(range, "2026-03-02", "2026-03-06", "week");
    const month = barGeometry(range, "2026-03-02", "2026-03-06", "month");
    expect(day.width).toBe(5 * DAY_WIDTH.day);
    expect(week.width).toBe(5 * DAY_WIDTH.week);
    expect(month.width).toBe(5 * DAY_WIDTH.month);
    // A week column is 7 days wide, so a 5-day bar is under one.
    expect(week.width).toBeLessThan(7 * DAY_WIDTH.week);
    // A month column is ~30 days; the bar is a fraction of it.
    expect(month.width).toBeLessThan(30 * DAY_WIDTH.month);
  });

  // @verifies TML-3
  it("keeps left edges on the start gridline at every zoom", () => {
    for (const zoom of ["day", "week", "month"] as const) {
      const bar = barGeometry(range, "2026-03-10", "2026-03-12", zoom);
      expect(bar.left).toBe(dateToX(range, "2026-03-10", zoom));
    }
  });

  it("yields zero width, never negative, for a reversed pair", () => {
    // TML-18 (M3.3b) owns the anomaly presentation; this just makes
    // sure the renderer cannot draw a backwards bar in the meantime.
    const bar = barGeometry(range, "2026-03-10", "2026-03-04", "day");
    expect(bar.width).toBe(0);
  });
});

describe("xToDate", () => {
  const range = { start: "2026-03-01", end: "2026-03-31" };

  // @verifies TML-12
  it("snaps to whole days with no time component", () => {
    const d = xToDate(range, 3.7 * DAY_WIDTH.day, "day");
    expect(d).toBe("2026-03-04");
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // @verifies TML-12
  it("returns the day UNDER the cursor, not the nearest boundary", () => {
    // 90% of the way through the column for 2026-03-04 is still
    // 2026-03-04. Rounding would return the 5th and make the committed
    // date disagree with the date under the pointer.
    expect(xToDate(range, 3.9 * DAY_WIDTH.day, "day")).toBe("2026-03-04");
    expect(xToDate(range, 3.0 * DAY_WIDTH.day, "day")).toBe("2026-03-04");
  });

  // @verifies TML-12
  it("snaps to whole days at month zoom, where a day is a few pixels", () => {
    // TML-12's second bullet: at month zoom the snap target is still a
    // whole day under the cursor.
    const d = xToDate(range, 10 * DAY_WIDTH.month + 2, "month");
    expect(d).toBe("2026-03-11");
  });

  // @verifies TML-3
  it("inverts dateToX exactly at every zoom", () => {
    for (const zoom of ["day", "week", "month"] as const) {
      for (const date of ["2026-03-01", "2026-03-15", "2026-03-31"]) {
        expect(xToDate(range, dateToX(range, date, zoom), zoom)).toBe(date);
      }
    }
  });
});

describe("computeRange / rangeWidth / eachDay", () => {
  // @verifies TML-16
  it("always includes today even when every task is elsewhere", () => {
    // TML-16: the today marker needs a column to land in, so today is
    // inside the range even when no task is near it.
    const range = computeRange(["2026-01-05", "2026-01-09"], "2026-06-01");
    expect(range.start <= "2026-06-01").toBe(true);
    expect(range.end >= "2026-06-01").toBe(true);
  });

  it("pads either side of the task span", () => {
    const range = computeRange(["2026-03-10", "2026-03-12"], "2026-03-11", 7);
    expect(range.start).toBe("2026-03-03");
    expect(range.end).toBe("2026-03-19");
  });

  it("ignores unparseable dates rather than producing an invalid range", () => {
    const range = computeRange(["nonsense", "2026-03-10"], "2026-03-10", 0);
    expect(range.start).toBe("2026-03-10");
    expect(range.end).toBe("2026-03-10");
  });

  it("counts the range inclusively", () => {
    const range = { start: "2026-03-01", end: "2026-03-07" };
    expect(eachDay(range)).toHaveLength(7);
    expect(rangeWidth(range, "day")).toBe(7 * DAY_WIDTH.day);
  });
});

describe("nonWorkingReason", () => {
  // @verifies TML-13
  it("shades Saturday and Sunday for a Mon-Fri week", () => {
    // 2026-03-07 is a Saturday, 2026-03-08 a Sunday.
    expect(nonWorkingReason("2026-03-07", calendar)).toBe("");
    expect(nonWorkingReason("2026-03-08", calendar)).toBe("");
    // 2026-03-06 is a Friday — a working day.
    expect(nonWorkingReason("2026-03-06", calendar)).toBeUndefined();
  });

  // @verifies TML-13
  it("returns a holiday's label for tooltip use", () => {
    expect(nonWorkingReason("2026-12-25", calendar)).toBe("Christmas Day");
  });

  // @verifies TML-13
  it("moves the shading when working_days changes — it is not hardcoded to Sat/Sun", () => {
    // TML-13's third bullet. working_days [0,1,2,3,4] = Sun..Thu, so
    // the non-working pair becomes Friday/Saturday.
    const friSat: CalendarConfig = { ...calendar, working_days: [0, 1, 2, 3, 4] };
    expect(nonWorkingReason("2026-03-06", friSat)).toBe(""); // Friday
    expect(nonWorkingReason("2026-03-07", friSat)).toBe(""); // Saturday
    expect(nonWorkingReason("2026-03-08", friSat)).toBeUndefined(); // Sunday now works
  });

  it("shades nothing while the calendar is still loading", () => {
    expect(nonWorkingReason("2026-03-07", undefined)).toBeUndefined();
  });

  it("prefers the holiday label when a date is both a holiday and a weekend", () => {
    // 2026-12-26 is a Saturday; make it a holiday too.
    const both: CalendarConfig = {
      ...calendar,
      holidays: [{ date: "2026-12-26", label: "Boxing Day" }],
    };
    expect(nonWorkingReason("2026-12-26", both)).toBe("Boxing Day");
  });
});

describe("headerCells", () => {
  // @verifies TML-3
  it("labels individual dates at day zoom", () => {
    const cells = headerCells({ start: "2026-03-01", end: "2026-03-03" }, "day", calendar);
    expect(cells.map(c => c.label)).toEqual(["1", "2", "3"]);
    expect(cells[0]?.width).toBe(DAY_WIDTH.day);
  });

  // @verifies TML-3
  it("labels week-starting dates at week zoom and spans 7 columns", () => {
    // 2026-03-01 is a Sunday, and first_day_of_week is 0, so the first
    // cell is a full week.
    const cells = headerCells({ start: "2026-03-01", end: "2026-03-14" }, "week", calendar);
    expect(cells).toHaveLength(2);
    expect(cells[0]?.width).toBe(7 * DAY_WIDTH.week);
    expect(cells[0]?.label).toBe("03-01");
    expect(cells[1]?.label).toBe("03-08");
  });

  // @verifies TML-3
  it("labels month names at month zoom", () => {
    const cells = headerCells({ start: "2026-03-01", end: "2026-04-15" }, "month", calendar);
    expect(cells.map(c => c.label)).toEqual(["March 2026", "April 2026"]);
    // March has 31 days in range, April 15.
    expect(cells[0]?.width).toBe(31 * DAY_WIDTH.month);
    expect(cells[1]?.width).toBe(15 * DAY_WIDTH.month);
  });

  // @verifies TML-3
  it("starts week cells on the configured first_day_of_week", () => {
    // Monday-start workspace: a range beginning Sunday 2026-03-01
    // yields a 1-day partial cell, then full Monday weeks.
    const monday: CalendarConfig = { ...calendar, first_day_of_week: 1 };
    const cells = headerCells({ start: "2026-03-01", end: "2026-03-14" }, "week", monday);
    expect(cells[0]?.width).toBe(1 * DAY_WIDTH.week);
    expect(cells[1]?.label).toBe("03-02");
    expect(cells[1]?.width).toBe(7 * DAY_WIDTH.week);
  });

  it("never emits a cell that starts before the chart does", () => {
    const cells = headerCells({ start: "2026-03-04", end: "2026-03-20" }, "week", calendar);
    expect(cells[0]?.left).toBe(0);
    // And the cells tile the range exactly, with no gaps or overlaps.
    let x = 0;
    for (const c of cells) {
      expect(c.left).toBe(x);
      x += c.width;
    }
    expect(x).toBe(rangeWidth({ start: "2026-03-04", end: "2026-03-20" }, "week"));
  });
});
