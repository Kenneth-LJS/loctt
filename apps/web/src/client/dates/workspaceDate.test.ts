import type { CalendarConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { formatWorkspaceDate, isPast, NO_TARGET_DATE } from "./workspaceDate.ts";

function cal(timezone: string): CalendarConfig {
  return { timezone, first_day_of_week: 1, working_days: [1, 2, 3, 4, 5], holidays: [] };
}

describe("formatWorkspaceDate", () => {
  // @verifies MSL-16
  it("renders an explicit phrase for an absent date, not a blank or a dash", () => {
    // MSL-16: the slot must not be blank, must not show an ambiguous
    // "—", and must not show today's date. All three would read as a
    // date the milestone does not have.
    expect(formatWorkspaceDate(undefined, cal("UTC"))).toBe(NO_TARGET_DATE);
    expect(NO_TARGET_DATE).toBe("No target date");
    expect(NO_TARGET_DATE).not.toBe("");
    expect(NO_TARGET_DATE).not.toBe("—");
    // Positive control: a real date is not swallowed into the same
    // phrase, so this assertion is not passing because the formatter
    // says "No target date" for everything.
    expect(formatWorkspaceDate("2025-01-01", cal("UTC"))).not.toBe(NO_TARGET_DATE);
  });

  // @verifies MSL-1
  it("renders the stored day in the workspace timezone, not the browser's", () => {
    // MSL-1: "formatted per the workspace locale/calendar". The
    // regression this catches is the day-shift: a date-only value
    // parsed as midnight UTC renders as the *previous* day in any
    // western zone, so a milestone due Jan 1 displays as Dec 31.
    expect(formatWorkspaceDate("2025-01-01", cal("America/Los_Angeles")))
      .toBe("Jan 1, 2025");
    expect(formatWorkspaceDate("2025-01-01", cal("Asia/Tokyo")))
      .toBe("Jan 1, 2025");
    expect(formatWorkspaceDate("2025-01-01", cal("UTC")))
      .toBe("Jan 1, 2025");
  });

  // @verifies MSL-1
  it("reads the timezone from the calendar rather than a fixed one", () => {
    // The test above cannot tell "uses the workspace zone" from "uses
    // any fixed zone": pinned to noon UTC, every zone within ±12h
    // renders the same day, so hardcoding `America/Los_Angeles`
    // survives it. Measured — that mutation passed.
    //
    // A full-ISO timestamp is not pinned to noon, so the zone actually
    // moves the answer. 2025-01-01T05:00:00Z is Jan 1 in UTC and Tokyo
    // and still Dec 31 in Los Angeles.
    const t = "2025-01-01T05:00:00Z";
    expect(formatWorkspaceDate(t, cal("UTC"))).toBe("Jan 1, 2025");
    expect(formatWorkspaceDate(t, cal("Asia/Tokyo"))).toBe("Jan 1, 2025");
    expect(formatWorkspaceDate(t, cal("America/Los_Angeles"))).toBe("Dec 31, 2024");
  });

  // @verifies MSL-1
  it("keeps the year, so a far-future date is not read as this one", () => {
    expect(formatWorkspaceDate("2099-12-31", cal("UTC"))).toBe("Dec 31, 2099");
  });

  // @verifies MSL-1
  it("returns an unparseable value verbatim rather than hiding it", () => {
    // Config drift must stay visible (P7). Rendering "No target date"
    // for a value that really is on disk would hide it.
    expect(formatWorkspaceDate("not-a-date", cal("UTC"))).toBe("not-a-date");
  });

  // @verifies MSL-1
  it("falls back to UTC when the calendar has not answered yet", () => {
    // Not the browser's zone: falling back to the local zone would
    // make the rendered day shift by a day once the calendar query
    // resolves, which reads as the value changing on its own.
    expect(formatWorkspaceDate("2025-01-01", undefined)).toBe("Jan 1, 2025");
  });
});

describe("isPast", () => {
  // @verifies MSL-17
  it("compares date-only strings chronologically", () => {
    expect(isPast("2025-01-01", "2026-09-01")).toBe(true);
    expect(isPast("2099-01-01", "2026-09-01")).toBe(false);
    // Today is not past.
    expect(isPast("2026-09-01", "2026-09-01")).toBe(false);
  });
});
