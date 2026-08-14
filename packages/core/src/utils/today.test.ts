import { describe, expect, it } from "vitest";

import { todayInZone } from "./today.js";

describe("todayInZone", () => {
  // The bug: 16:00 UTC on the 13th is already the 14th in Singapore
  // (UTC+8). Resolving in UTC returned the 13th, so `due_date < today`
  // used yesterday's boundary and tasks due today dropped out.
  const evening = new Date("2026-08-13T16:00:00Z");

  it("resolves ahead-of-UTC zones past the date boundary", () => {
    expect(todayInZone("Asia/Singapore", evening)).toBe("2026-08-14");
    expect(todayInZone("UTC", evening)).toBe("2026-08-13");
  });

  it("resolves behind-UTC zones that haven't reached the boundary", () => {
    // 02:00 UTC on the 14th is still the 13th in New York (UTC-4).
    const earlyMorning = new Date("2026-08-14T02:00:00Z");
    expect(todayInZone("America/New_York", earlyMorning)).toBe("2026-08-13");
    expect(todayInZone("UTC", earlyMorning)).toBe("2026-08-14");
  });

  it("defaults to UTC when no zone is given", () => {
    expect(todayInZone(undefined, evening)).toBe("2026-08-13");
  });

  it("pads single-digit months and days to a parseable YYYY-MM-DD", () => {
    // en-CA is ISO-ordered, but the 2-digit options are what keep
    // "2026-01-05" from rendering as "2026-1-5".
    expect(todayInZone("UTC", new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });

  it("handles a half-hour offset zone", () => {
    // Kolkata is UTC+5:30 — 19:00 UTC is already the next day there.
    expect(todayInZone("Asia/Kolkata", new Date("2026-08-13T19:00:00Z"))).toBe("2026-08-14");
  });

  it("falls back to UTC for a zone the runtime rejects", () => {
    expect(todayInZone("Not/AZone", evening)).toBe("2026-08-13");
  });

  it("returns a string the date comparison path can order lexically", () => {
    // Query comparisons compare YYYY-MM-DD as strings, so the format
    // has to sort correctly.
    const a = todayInZone("UTC", new Date("2026-08-09T12:00:00Z"));
    const b = todayInZone("UTC", new Date("2026-08-10T12:00:00Z"));
    expect(a < b).toBe(true);
  });
});
