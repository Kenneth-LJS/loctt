import { join } from "node:path";

import type { CalendarConfig, HolidayDef } from "@loctt/contracts";
import { HolidayDefSchema, IanaTimezone } from "@loctt/contracts";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { LocttError } from "../errors.js";
import { getConfigDir } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { readFileState, UnreadableFileError } from "../utils/read-state.js";
import { brokenEntriesToPlain, collectValidEntries } from "./health.js";
import { coerceYaml, safeParseYaml } from "./yaml-coerce.js";
import { formatZodIssues } from "./zod-error.js";

export class CalendarConfigError extends LocttError {
  constructor(message: string) {
    // `config_invalid`, not the `unknown` an un-attributed Error
    // falls back to. The message already names the file, the field
    // path and what was expected (ERR-10); what was missing was a
    // code, so every surface reported a schema problem as an
    // unexplained server failure. V1: core states its own cause.
    super("config_invalid", message, {
      dataState: "not_saved",
      recovery: { kind: "command" },
    });
    this.name = "CalendarConfigError";
  }
}

const CALENDAR_FILE = "calendar.yaml";

export function getCalendarConfigPath(locttDir: string): string {
  return join(getConfigDir(locttDir), CALENDAR_FILE);
}

/** Weekday index, 0..6 with 0 = Sunday — mirrors the contract's `Weekday`. */
const Weekday = z.number().int().min(0).max(6);

/**
 * The object-fatal outer shape. The scalar fields validate strictly here —
 * an unresolvable `timezone` (SET-24), a weekday out of range, or an empty
 * / duplicate working week are all single values the whole calendar hangs
 * on, so they still throw and blank nothing that could be salvaged. Only
 * `holidays` is left as `z.array(z.unknown())`: a single wrong-typed
 * holiday must not fail the whole `.parse()` and blank the surface, so the
 * per-ENTRY validation happens afterwards through `collectValidEntries`.
 *
 * A file that is not even a list of holidays — `holidays` missing or not an
 * array — is object-fatal and still throws, because there is no coherent
 * collection to degrade around.
 */
const RawCalendarConfigSchema = z.object({
  // SET-24: a stored `timezone` that no longer resolves (renamed like
  // `America/Godthab`, or an outright bad string) must NOT blank the whole
  // calendar surface on read. It is a single scalar the app can degrade
  // around — every consumer already tolerates an unresolvable zone
  // (`workspaceDate` falls back to UTC, the panel shows it marked via
  // `timezoneResolves` and keeps it out of the picker) — so the READ path
  // accepts any non-empty string and hands the stored value through for
  // the surfaces to flag. The WRITE path stays strict: `saveCalendarConfig`
  // re-validates the timezone as IANA below, and `PUT /api/calendar`
  // validates against the strict `CalendarConfigSchema`, so a bad zone can
  // be tolerated when hand-edited onto disk but never saved through LocTT.
  timezone: z.string().min(1, "timezone must not be empty"),
  first_day_of_week: Weekday,
  working_days: z.array(Weekday),
  holidays: z.array(z.unknown()),
}).strict().superRefine((cfg, ctx) => {
  // An empty working week is not a configuration, it is a tracker where no
  // date calculation can land anywhere. Object-fatal, exactly as before.
  if (cfg.working_days.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "working_days must name at least one day",
      path: ["working_days"],
    });
  }
  const seen = new Set<number>();
  for (const [i, d] of cfg.working_days.entries()) {
    if (seen.has(d)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate working day ${d}`,
        path: ["working_days", i],
      });
    }
    seen.add(d);
  }
});

export function parseCalendarConfig(yamlContent: string): CalendarConfig {
  const raw = coerceYaml(safeParseYaml(yamlContent, "calendar.yaml"));

  // Object-fatal: the scalar fields and the outer `{ …, holidays: [...] }`
  // shape must be valid. A bad timezone, a bad weekday, an empty/duplicate
  // working week, a missing or non-array `holidays` — none is a collection
  // we can degrade around, so each still throws, exactly as before.
  let outer: z.infer<typeof RawCalendarConfigSchema>;
  try {
    outer = RawCalendarConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CalendarConfigError(`calendar.yaml is not valid: ${formatZodIssues("calendar config", err)}`);
    }
    throw err;
  }

  // Per north-star principle 5: one holiday whose fields no longer validate
  // (a hand-edited date in the wrong format, a missing label) must not blank
  // the whole calendar. Good holidays load; a bad one becomes a `BrokenEntry`
  // carrying its index, raw text and the validator's message, so a surface
  // can list it as broken beside the healthy ones (VUE-22, SET-36). Holidays
  // carry no `id`, so the default `idOf` yields none — a broken entry is
  // named by its index and raw text.
  const { valid, broken } = collectValidEntries<HolidayDef>(
    outer.holidays,
    HolidayDefSchema,
    "holiday",
  );

  return {
    timezone: outer.timezone,
    first_day_of_week: outer.first_day_of_week,
    working_days: outer.working_days,
    holidays: valid,
    // Omitted, not `[]`, when everything parsed — a consumer reading only
    // `holidays` is unaffected and "none broken" stays distinct from "not
    // inspected". Never serialized back to disk.
    ...(broken.length > 0 ? { broken } : {}),
  };
}

/**
 * The written shape. The timezone / working-days scalars are object-fatal
 * and pass through unchanged. Only `holidays` is a per-entry list: valid
 * holidays AND any preserved broken ones (K28) go into the single
 * `holidays` array, so a `broken` holiday another process left survives an
 * unrelated write (re-emitting only the valid holidays would silently drop
 * it — P1 data loss). A broken holiday re-loads back into `broken`.
 */
function buildCalendarPlainObject(config: CalendarConfig): Record<string, unknown> {
  return {
    timezone: config.timezone,
    first_day_of_week: config.first_day_of_week,
    working_days: [...config.working_days],
    holidays: [
      ...config.holidays.map(h => ({ date: h.date, label: h.label })),
      ...brokenEntriesToPlain(config.broken),
    ],
  };
}

export function serializeCalendarConfig(config: CalendarConfig): string {
  return stringifyYaml(buildCalendarPlainObject(config));
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
  // SET-24: the READ path (parseCalendarConfig) now tolerates an
  // unresolvable timezone so a hand-edited bad zone degrades rather than
  // blanking the panel — but a WRITE must not persist one. Re-validate the
  // timezone strictly here (the read round-trip below no longer does), so
  // `loctt` and the API refuse to save an invalid zone even though they
  // will display one already on disk.
  const tz = IanaTimezone.safeParse(config.timezone);
  if (!tz.success) {
    throw new CalendarConfigError(
      `Cannot save calendar.yaml. "${config.timezone}" is not a valid IANA timezone.`,
    );
  }
  const validated = parseCalendarConfig(serializeCalendarConfig(config));
  // Write valid + preserved broken holidays (K28) so a corrupt sibling
  // survives. Working-days object-fatal behavior is unchanged — those
  // still validate through the round-trip above.
  await writeYamlAtomically(getCalendarConfigPath(locttDir), buildCalendarPlainObject(validated));
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
