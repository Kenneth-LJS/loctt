import { join } from "node:path";

import type { CalendarConfig } from "@loctt/contracts";
import { CalendarConfigSchema } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
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
 * Loads calendar.yaml. Returns defaults (UTC, Mon-Fri working week,
 * no holidays) when the file is absent; a missing file shouldn't
 * block anything.
 *
 * The absent-file timezone is **UTC, not the machine's zone**. This
 * config is workspace-shared and committed, so resolving it from
 * whichever machine happened to read it would make query results
 * ("due before today") vary by who ran them. `loctt init` writes the
 * initializing machine's zone into the file, which makes it an
 * explicit recorded value rather than an ambient one — so this
 * fallback only applies to trackers created before that, or with the
 * file deleted.
 */
export async function loadCalendarConfig(locttDir: string): Promise<CalendarConfig> {
  const path = getCalendarConfigPath(locttDir);
  // Absent is a supported state; unreadable is not. V9: a config value
  // is a definition other data references, not a record of an event, so
  // LocTT refuses rather than building on one it could not read. The
  // file is never written over, which is what P-11 protects.
  const file = await readFileState(path);
  if (file.state === "unreadable") throw new UnreadableFileError(file);
  if (file.state === "absent") {
    return {
      timezone: "UTC",
      first_day_of_week: 1,
      working_days: [1, 2, 3, 4, 5],
      holidays: [],
    };
  }
  return parseCalendarConfig(file.content);
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

/**
 * The machine's IANA timezone, or `"UTC"` when the runtime can't
 * report one.
 *
 * Only for `loctt init`, which writes the result into calendar.yaml
 * as an explicit, committed value. Do **not** call this to resolve
 * "today" at read time: this config is workspace-shared, so deriving
 * it per-machine would make the same saved view return different
 * results for different people.
 */
export function detectMachineTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
