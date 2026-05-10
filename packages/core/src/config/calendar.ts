import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CalendarConfig } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getConfigDir } from "../paths/index.js";
import {
  assertArray as _assertArray,
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class CalendarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarConfigError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, CalendarConfigError);
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  _assertArray(value, path, CalendarConfigError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, CalendarConfigError);
}

const CALENDAR_FILE = "calendar.yaml";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getCalendarConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), CALENDAR_FILE);
}

function assertWeekday(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) {
    throw new CalendarConfigError(`${path} must be an integer 0..6`);
  }
  return value;
}

function assertDateString(value: unknown, path: string): string {
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString().slice(0, 10);
  } else if (typeof value === "string") {
    s = value;
  } else {
    throw new CalendarConfigError(`${path} must be a YYYY-MM-DD string`);
  }
  if (!DATE_PATTERN.test(s)) {
    throw new CalendarConfigError(`${path} must be YYYY-MM-DD, got: ${s}`);
  }
  return s;
}

export function parseCalendarConfig(yamlContent: string): CalendarConfig {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "calendar config");

  assertString(raw["timezone"], "timezone");
  const firstDayOfWeek = assertWeekday(raw["first_day_of_week"], "first_day_of_week");

  assertArray(raw["working_days"], "working_days");
  const workingDays = raw["working_days"].map((d, i) => assertWeekday(d, `working_days[${i}]`));

  let holidays: { date: string; label: string }[] = [];
  if (raw["holidays"] !== undefined) {
    assertArray(raw["holidays"], "holidays");
    holidays = raw["holidays"].map((h, i) => {
      assertObject(h, `holidays[${i}]`);
      const date = assertDateString(h["date"], `holidays[${i}].date`);
      assertString(h["label"], `holidays[${i}].label`);
      return { date, label: h["label"] };
    });
  }

  return {
    timezone: raw["timezone"],
    first_day_of_week: firstDayOfWeek,
    working_days: workingDays,
    holidays,
  };
}

export function serializeCalendarConfig(config: CalendarConfig): string {
  return stringifyYaml({
    timezone: config.timezone,
    first_day_of_week: config.first_day_of_week,
    working_days: [...config.working_days],
    holidays: config.holidays.map(h => ({ date: h.date, label: h.label })),
  });
}

/**
 * Loads calendar.yaml. Returns a sensible default (system timezone
 * detected at parse, Mon-Fri working week, no holidays) when the
 * file is absent. Calendar is purely cosmetic for the timeline view
 * so a missing file shouldn't block anything.
 */
export async function loadCalendarConfig(locttDir: string): Promise<CalendarConfig> {
  const path = getCalendarConfigPath(locttDir);
  if (!(await fileExists(path))) {
    return {
      timezone: defaultTimezone(),
      first_day_of_week: 1,
      working_days: [1, 2, 3, 4, 5],
      holidays: [],
    };
  }
  const raw = await readFile(path, "utf-8");
  return parseCalendarConfig(raw);
}

export async function saveCalendarConfig(
  locttDir: string,
  config: CalendarConfig,
): Promise<void> {
  const validated = parseCalendarConfig(serializeCalendarConfig(config));
  await writeYamlAtomically(getCalendarConfigPath(locttDir), {
    timezone: validated.timezone,
    first_day_of_week: validated.first_day_of_week,
    working_days: [...validated.working_days],
    holidays: validated.holidays.map(h => ({ date: h.date, label: h.label })),
  });
}

export async function calendarConfigExists(locttDir: string): Promise<boolean> {
  return fileExists(getCalendarConfigPath(locttDir));
}

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
