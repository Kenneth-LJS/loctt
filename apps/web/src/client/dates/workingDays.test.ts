import type { CalendarConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { classifyNonWorkingDay } from "./workingDays.ts";

// Mon–Fri working; Christmas is a holiday. 2026-03-06 is a Friday,
// 2026-03-07 Saturday, 2026-03-08 Sunday.
const calendar: CalendarConfig = {
  timezone: "UTC",
  first_day_of_week: 1,
  working_days: [1, 2, 3, 4, 5],
  holidays: [{ date: "2026-12-25", label: "Christmas Day" }],
};

describe("classifyNonWorkingDay", () => {
  it("returns undefined on a working weekday", () => {
    expect(classifyNonWorkingDay("2026-03-06", calendar)).toBeUndefined(); // Fri
  });

  it("returns the weekday index for a non-working weekend day", () => {
    expect(classifyNonWorkingDay("2026-03-07", calendar)).toEqual({ weekday: 6 }); // Sat
    expect(classifyNonWorkingDay("2026-03-08", calendar)).toEqual({ weekday: 0 }); // Sun
  });

  it("returns the holiday label, and it wins over the weekday", () => {
    // 2026-12-25 is a Friday (working) but also Christmas — holiday wins.
    expect(classifyNonWorkingDay("2026-12-25", calendar)).toEqual({ holiday: "Christmas Day" });
  });

  it("is undefined with no calendar", () => {
    expect(classifyNonWorkingDay("2026-03-07", undefined)).toBeUndefined();
  });

  it("treats a rolled-over invalid date as no date, not a spurious weekday", () => {
    // Date.parse rolls 2026-02-31 forward in some engines; the round-trip
    // guard rejects it so callers do not shade/label a nonexistent day.
    expect(classifyNonWorkingDay("2026-02-31", calendar)).toBeUndefined();
  });

  it("respects a non-Mon–Fri working week", () => {
    const sunThu: CalendarConfig = { ...calendar, working_days: [0, 1, 2, 3, 4], holidays: [] };
    expect(classifyNonWorkingDay("2026-03-06", sunThu)).toEqual({ weekday: 5 }); // Fri now off
    expect(classifyNonWorkingDay("2026-03-08", sunThu)).toBeUndefined(); // Sun now works
  });
});
