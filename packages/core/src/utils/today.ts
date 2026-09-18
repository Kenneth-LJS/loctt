/**
 * Workspace-timezone "today".
 *
 * Task dates (`due_date`, `start_date`, `completed_date`) are plain
 * `YYYY-MM-DD` calendar dates, not instants. Resolving "today" with
 * `new Date().toISOString().slice(0, 10)` answers in UTC, so in a
 * workspace configured `Asia/Singapore` (UTC+8) every query for the
 * eight hours after local midnight used yesterday's boundary and
 * silently dropped tasks due today.
 *
 * The zone comes from `calendar.yaml`, which is workspace-shared and
 * committed — not the machine's local zone. Two people on the same
 * tracker in different places must get the same answer from the same
 * saved view; resolving against whichever machine ran the query would
 * make results vary by who asked.
 */

/**
 * Returns the current calendar date in `tz` as `YYYY-MM-DD`.
 *
 * `en-CA` is the locale trick: its short date format is already
 * ISO-ordered (`2026-08-14`), so no reassembly from parts is needed.
 *
 * Falls back to UTC when the runtime rejects the zone. Config load
 * validates against `Intl.supportedValuesOf` (see `IanaTimezone` in
 * contracts), so a bad zone shouldn't reach here through
 * `loadCalendarConfig` — this guards the paths that don't go through
 * it, and keeps a formatter failure from taking down a query.
 *
 * @param tz IANA timezone, e.g. `Asia/Singapore`. Defaults to UTC.
 * @param now Instant to resolve. Defaults to the current time;
 *   injectable so tests don't depend on the wall clock.
 */
export function todayInZone(tz = "UTC", now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
