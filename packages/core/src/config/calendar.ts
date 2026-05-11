import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CalendarConfig } from "@loctt/contracts";
import { CalendarConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { coerceYaml, safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class CalendarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarConfigError";
  }
}

const CALENDAR_FILE = "calendar.yaml";

export function getCalendarConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), CALENDAR_FILE);
}

export function parseCalendarConfig(yamlContent: string): CalendarConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "calendar.yaml"));
  // `holidays` was historically optional in the file but required
  // in the type. Default to [] before the schema parses.
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (r["holidays"] === undefined) r["holidays"] = [];
  }
  try {
    return CalendarConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CalendarConfigError(formatZodIssues("calendar config", err));
    }
    throw err;
  }
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
