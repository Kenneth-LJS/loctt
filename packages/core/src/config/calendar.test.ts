import { describe, expect, it } from "vitest";

import {
  CalendarConfigError,
  parseCalendarConfig,
  serializeCalendarConfig,
} from "./calendar.js";

describe("parseCalendarConfig", () => {
  it("parses a complete config", () => {
    const cfg = parseCalendarConfig(`timezone: America/Los_Angeles
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: New Year's Day
  - date: 2026-12-25
    label: Christmas
`);
    expect(cfg.timezone).toBe("America/Los_Angeles");
    expect(cfg.first_day_of_week).toBe(1);
    expect(cfg.working_days).toEqual([1, 2, 3, 4, 5]);
    expect(cfg.holidays).toEqual([
      { date: "2026-01-01", label: "New Year's Day" },
      { date: "2026-12-25", label: "Christmas" },
    ]);
  });

  it("defaults holidays to [] when absent", () => {
    const cfg = parseCalendarConfig(`timezone: UTC
first_day_of_week: 0
working_days: [1, 2, 3, 4, 5]
`);
    expect(cfg.holidays).toEqual([]);
  });

  it("rejects an unknown timezone", () => {
    const yaml = `timezone: Mars/Olympus_Mons
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays: []
`;
    expect(() => parseCalendarConfig(yaml)).toThrow(CalendarConfigError);
    expect(() => parseCalendarConfig(yaml)).toThrow(/timezone/);
  });

  it("accepts UTC explicitly", () => {
    const cfg = parseCalendarConfig(`timezone: UTC
first_day_of_week: 0
working_days: [1, 2, 3, 4, 5]
holidays: []
`);
    expect(cfg.timezone).toBe("UTC");
  });

  it("rejects a weekday out of 0..6 range", () => {
    const yaml = `timezone: UTC
first_day_of_week: 7
working_days: [1, 2, 3, 4, 5]
holidays: []
`;
    expect(() => parseCalendarConfig(yaml)).toThrow(CalendarConfigError);
    expect(() => parseCalendarConfig(yaml)).toThrow(/first_day_of_week/);
  });

  it("rejects a working_days entry that's not a weekday", () => {
    const yaml = `timezone: UTC
first_day_of_week: 1
working_days: [1, 9]
holidays: []
`;
    expect(() => parseCalendarConfig(yaml)).toThrow(CalendarConfigError);
    expect(() => parseCalendarConfig(yaml)).toThrow(/working_days\[1\]/);
  });

  it("rejects a holiday with a malformed date", () => {
    const yaml = `timezone: UTC
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: "01-01-2026"
    label: New Year
`;
    expect(() => parseCalendarConfig(yaml)).toThrow(CalendarConfigError);
    expect(() => parseCalendarConfig(yaml)).toThrow(/YYYY-MM-DD/);
  });

  it("rejects a holiday with empty label", () => {
    const yaml = `timezone: UTC
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: ""
`;
    expect(() => parseCalendarConfig(yaml)).toThrow("holidays[0].label must be a non-empty string");
  });
});

describe("serializeCalendarConfig", () => {
  it("round-trips through parse", () => {
    const cfg = {
      timezone: "Europe/London",
      first_day_of_week: 1,
      working_days: [1, 2, 3, 4, 5],
      holidays: [{ date: "2026-12-25", label: "Christmas" }],
    };
    const yaml = serializeCalendarConfig(cfg);
    const reparsed = parseCalendarConfig(yaml);
    expect(reparsed).toEqual(cfg);
  });
});
