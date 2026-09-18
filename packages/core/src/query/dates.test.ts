import { describe, expect, it } from "vitest";

import { dateFnFromWord, isBoundaryFn, offsetError, parseOffset, resolveBoundaryDate } from "./dates.js";

// @verifies K80
describe("date-function helpers (K80)", () => {
  it("resolves function names case-insensitively to the canonical form", () => {
    expect(dateFnFromWord("now")).toBe("now");
    expect(dateFnFromWord("STARTOFWEEK")).toBe("startOfWeek");
    expect(dateFnFromWord("endofmonth")).toBe("endOfMonth");
    expect(dateFnFromWord("nope")).toBeNull();
  });

  it("knows which functions take an offset", () => {
    expect(isBoundaryFn("startOfWeek")).toBe(true);
    expect(isBoundaryFn("now")).toBe(false);
  });

  it("validates offsets", () => {
    expect(offsetError("+1w")).toBeNull();
    expect(offsetError("-3d")).toBeNull();
    expect(offsetError("+12m")).toBeNull();
    expect(offsetError("1w")).toMatch(/needs a sign/);
    expect(offsetError("+1y")).toMatch(/unknown offset unit "y"/);
    expect(offsetError("+xw")).toMatch(/invalid offset/);
    expect(parseOffset("-3d")).toEqual({ sign: -1, n: 3, unit: "d" });
  });
});

// @verifies K80
describe("resolveBoundaryDate (K80)", () => {
  // 2026-06-15 is a Monday.
  const today = "2026-06-15";

  it("startOfDay/endOfDay are the day itself", () => {
    expect(resolveBoundaryDate("startOfDay", today, 1)).toBe("2026-06-15");
    expect(resolveBoundaryDate("endOfDay", today, 1)).toBe("2026-06-15");
  });

  it("week boundaries respect a Monday week start", () => {
    // Monday 15th → week is Mon 15 … Sun 21.
    expect(resolveBoundaryDate("startOfWeek", today, 1)).toBe("2026-06-15");
    expect(resolveBoundaryDate("endOfWeek", today, 1)).toBe("2026-06-21");
    // A Wednesday in the same week resolves to the same boundaries.
    expect(resolveBoundaryDate("startOfWeek", "2026-06-17", 1)).toBe("2026-06-15");
    expect(resolveBoundaryDate("endOfWeek", "2026-06-17", 1)).toBe("2026-06-21");
  });

  it("week boundaries respect a Sunday week start", () => {
    // Sunday start → the week containing Mon 15 is Sun 14 … Sat 20.
    expect(resolveBoundaryDate("startOfWeek", today, 0)).toBe("2026-06-14");
    expect(resolveBoundaryDate("endOfWeek", today, 0)).toBe("2026-06-20");
  });

  it("month boundaries", () => {
    expect(resolveBoundaryDate("startOfMonth", today, 1)).toBe("2026-06-01");
    expect(resolveBoundaryDate("endOfMonth", today, 1)).toBe("2026-06-30");
    // February in a non-leap year clamps to the 28th.
    expect(resolveBoundaryDate("endOfMonth", "2026-02-10", 1)).toBe("2026-02-28");
    // 2028 is a leap year.
    expect(resolveBoundaryDate("endOfMonth", "2028-02-10", 1)).toBe("2028-02-29");
  });

  it("applies the offset after the boundary", () => {
    // endOfWeek is Sun 21; +1w → Sun 28.
    expect(resolveBoundaryDate("endOfWeek", today, 1, { sign: 1, n: 1, unit: "w" })).toBe("2026-06-28");
    // startOfDay -7d.
    expect(resolveBoundaryDate("startOfDay", today, 1, { sign: -1, n: 7, unit: "d" })).toBe("2026-06-08");
    // startOfMonth +1m → 2026-07-01.
    expect(resolveBoundaryDate("startOfMonth", today, 1, { sign: 1, n: 1, unit: "m" })).toBe("2026-07-01");
    // endOfMonth +1m from June → end of July (31), clamped correctly.
    expect(resolveBoundaryDate("endOfMonth", today, 1, { sign: 1, n: 1, unit: "m" })).toBe("2026-07-31");
  });

  it("month offset crosses a year boundary", () => {
    expect(resolveBoundaryDate("startOfMonth", "2026-12-15", 1, { sign: 1, n: 1, unit: "m" })).toBe("2027-01-01");
    expect(resolveBoundaryDate("startOfMonth", "2026-01-15", 1, { sign: -1, n: 1, unit: "m" })).toBe("2025-12-01");
  });

  it("does not drift across a spring-forward DST date (string math, not local Date)", () => {
    // US DST began 2026-03-08. A day offset around it stays exact.
    expect(resolveBoundaryDate("startOfDay", "2026-03-08", 1, { sign: 1, n: 1, unit: "d" })).toBe("2026-03-09");
    expect(resolveBoundaryDate("startOfDay", "2026-03-08", 1, { sign: -1, n: 1, unit: "d" })).toBe("2026-03-07");
  });
});
