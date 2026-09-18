import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import {
  CalendarConfigError,
  loadCalendarConfig,
  parseCalendarConfig,
  saveCalendarConfig,
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

  // SET-24: a stored timezone that no longer resolves is TOLERATED on
  // read (the calendar loads with the value preserved so the panel can
  // show and flag it, and date rendering falls back to UTC). This test
  // previously asserted the opposite (object-fatal throw); that was the
  // bug SET-24 fixes — the whole consumer side (workspaceDate's UTC
  // fallback, CalendarPanel's `timezoneResolves` marking) was built for a
  // degraded value it never received. The WRITE path stays strict — see
  // "saveCalendarConfig rejects …" below.
  it("tolerates an unresolvable stored timezone on read (SET-24), preserving the value", () => {
    const yaml = `timezone: Mars/Olympus_Mons
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays: []
`;
    const cfg = parseCalendarConfig(yaml);
    expect(cfg.timezone).toBe("Mars/Olympus_Mons");
  });

  it("still rejects an empty timezone (a value the app cannot degrade around)", () => {
    const yaml = `timezone: ""
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays: []
`;
    expect(() => parseCalendarConfig(yaml)).toThrow(CalendarConfigError);
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

  // K28: a corrupt-but-degraded HOLIDAY another process left must survive a
  // serialize that only touched the valid holidays. Dropping the
  // `brokenEntriesToPlain(config.broken)` append reddens this — the broken
  // holiday vanishes from the re-parsed .broken. (The timezone /
  // working-days object-fatal fields are unaffected and still round-trip.)
  it("preserves a broken holiday through serialize + reparse (K28)", () => {
    const cfg = parseCalendarConfig(`timezone: Europe/London
first_day_of_week: 1
working_days: [1, 2, 3, 4, 5]
holidays:
  - date: 2026-01-01
    label: New Year
  - date: "01-01-2026"
    label: Bad Row
`);
    expect(cfg.holidays).toEqual([{ date: "2026-01-01", label: "New Year" }]);
    expect(cfg.broken).toHaveLength(1);

    const reparsed = parseCalendarConfig(serializeCalendarConfig(cfg));
    expect(reparsed.timezone).toBe("Europe/London");
    expect(reparsed.working_days).toEqual([1, 2, 3, 4, 5]);
    expect(reparsed.holidays).toEqual(cfg.holidays);
    expect(reparsed.broken).toHaveLength(1);
    expect(reparsed.broken?.[0]?.rawText).toContain("01-01-2026");
  });
});

describe("saveCalendarConfig timezone guard (SET-24)", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-cal-"));
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses to save an unresolvable timezone, even though read tolerates one", async () => {
    const cfg = await loadCalendarConfig(locttDir);
    await expect(
      saveCalendarConfig(locttDir, { ...cfg, timezone: "Mars/Olympus_Mons" }),
    ).rejects.toThrow(/timezone/i);
  });

  it("saves a valid timezone", async () => {
    const cfg = await loadCalendarConfig(locttDir);
    await saveCalendarConfig(locttDir, { ...cfg, timezone: "America/New_York" });
    const after = await loadCalendarConfig(locttDir);
    expect(after.timezone).toBe("America/New_York");
  });
});
