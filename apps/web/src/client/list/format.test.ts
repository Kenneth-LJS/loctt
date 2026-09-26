import { describe, expect, it } from "vitest";

import { relativeTime, shortDate } from "./format.ts";

describe("shortDate", () => {
  it("formats a date-only string as 'Mon D' in UTC", () => {
    expect(shortDate("2026-01-15")).toBe("Jan 15");
  });

  it("formats an ISO timestamp", () => {
    expect(shortDate("2026-12-03T10:00:00Z")).toBe("Dec 3");
  });

  it("returns the raw value for an unparseable date", () => {
    expect(shortDate("not-a-date")).toBe("not-a-date");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-06-08T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const SEC = 1000, MIN = 60 * SEC, HR = 60 * MIN, DAY = 24 * HR;

  it("reads 'just now' under 45s", () => {
    expect(relativeTime(ago(10 * SEC), now)).toBe("just now");
  });
  it("reads minutes", () => {
    expect(relativeTime(ago(5 * MIN), now)).toBe("5m ago");
  });
  it("reads hours", () => {
    expect(relativeTime(ago(3 * HR), now)).toBe("3h ago");
  });
  it("reads days", () => {
    expect(relativeTime(ago(2 * DAY), now)).toBe("2d ago");
  });
  it("reads weeks then months then years", () => {
    expect(relativeTime(ago(14 * DAY), now)).toBe("2w ago");
    expect(relativeTime(ago(60 * DAY), now)).toBe("2mo ago");
    expect(relativeTime(ago(400 * DAY), now)).toBe("1y ago");
  });
  it("returns the raw value for an unparseable timestamp", () => {
    expect(relativeTime("nope", now)).toBe("nope");
  });
});
