import { describe, expect, it } from "vitest";

import {
  CalendarConfigError,
  parseCalendarConfig,
  serializeCalendarConfig,
} from "./calendar.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

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

  it("requires holidays to be present", () => {
    expect(() => parseCalendarConfig(`timezone: UTC
first_day_of_week: 0
working_days: [1, 2, 3, 4, 5]
`)).toThrow(CalendarConfigError);
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

  it("degrades a holiday with a malformed date to a BrokenEntry, keeping the rest", () => {
    // SET-36: one unparseable holiday marks that row and is listed as
    // broken; the other valid holidays are not discarded and the whole
    // calendar does not blank. (Previously this threw CalendarConfigError,
    // blanking every holiday beside the bad one — that test asserted the
    // pre-tolerance bug; see the final message's "green test edited".)
    const cfg = parseCalendarConfig(`timezone: UTC
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: New Year
  - date: "01-01-2026"
    label: Bad Row
  - date: 2026-12-25
    label: Christmas
`);
    // Valid holidays survive, in order, values preserved.
    expect(cfg.holidays).toEqual([
      { date: "2026-01-01", label: "New Year" },
      { date: "2026-12-25", label: "Christmas" },
    ]);
    // The bad row is set aside as a BrokenEntry naming its index, raw text
    // and what was expected — not silently dropped.
    expect(cfg.broken).toHaveLength(1);
    const entry = cfg.broken?.[0];
    expect(entry?.index).toBe(1);
    expect(entry?.rawText).toContain("01-01-2026");
    expect(entry?.error).toMatch(/YYYY-MM-DD/);
  });

  it("degrades a holiday with an empty label to a BrokenEntry", () => {
    const cfg = parseCalendarConfig(`timezone: UTC
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: ""
`);
    expect(cfg.holidays).toEqual([]);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.index).toBe(0);
    expect(cfg.broken?.[0]?.error).toMatch(/label must be a non-empty string/);
  });

  it("omits `broken` when every holiday parses", () => {
    const cfg = parseCalendarConfig(`timezone: UTC
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: New Year
`);
    // Omitted, not [], so "none broken" stays distinct from "not inspected".
    expect(cfg.broken).toBeUndefined();
  });

  it("keeps a wholly non-array holidays value object-fatal", () => {
    // A `holidays` that is not even a list is not a collection to degrade
    // around — it still throws, exactly as before.
    const yaml = `timezone: UTC
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays: not-a-list
`;
    expect(() => parseCalendarConfig(yaml)).toThrow(CalendarConfigError);
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseCalendarConfig("{ timezone: [UTC")).toThrow(YamlSyntaxError);
    expect(() => parseCalendarConfig("{ timezone: [UTC")).toThrow(/calendar\.yaml/);
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
