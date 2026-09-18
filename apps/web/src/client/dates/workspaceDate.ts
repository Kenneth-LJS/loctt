import type { CalendarConfig } from "@loctt/contracts";

/**
 * Workspace-calendar date formatting.
 *
 * MSL-1 asks for `target_date` "formatted per the workspace
 * locale/calendar". `GET /api/calendar` already carries the workspace
 * `timezone`, but no ticket built a formatter bound to it — M4.2 built
 * the Calendar settings *panel*, not this. It lives here as a shared
 * utility rather than a local helper inside the Milestones view
 * because the timeline and the task detail need the same thing, and
 * three private copies is how two surfaces end up rendering one date
 * two ways.
 *
 * ## Why the timezone is load-bearing
 *
 * `target_date` is a date-only `YYYY-MM-DD`. Parsed as a bare
 * `new Date("2025-01-01")` it is midnight **UTC**, which in any
 * timezone west of Greenwich renders as the previous day — a
 * milestone due Jan 1 displayed as Dec 31. So the string is pinned to
 * UTC noon and formatted with the workspace's `timeZone`, which makes
 * the rendered day equal the stored day for every zone.
 *
 * The workspace's calendar rather than the browser's, for the same
 * reason `useInfo().today` is used over `Date.now()` elsewhere: two
 * users in different zones must not see different dates for the same
 * milestone, and the CLI has no browser to ask.
 */

/**
 * The absent-date text. Exported so the view and its spec name the
 * same string.
 *
 * MSL-16 forbids a blank, a bare dash, and today's date in this slot —
 * each of those reads as a date the milestone does not have.
 */
export const NO_TARGET_DATE = "No target date";

/**
 * Formats a `YYYY-MM-DD` for display in the workspace's calendar.
 *
 * Returns {@link NO_TARGET_DATE} for `undefined`, so a caller cannot
 * accidentally render an empty slot. An unparseable value is returned
 * verbatim rather than swallowed: config drift should be visible (P7),
 * and a silent "No target date" would hide a value that is really on
 * disk.
 */
export function formatWorkspaceDate(
  value: string | undefined,
  calendar: CalendarConfig | undefined,
): string {
  if (value === undefined || value === "") return NO_TARGET_DATE;

  // Noon UTC, not midnight: midnight lands on the previous calendar
  // day once shifted into a western zone, which would render a
  // milestone due Jan 1 as Dec 31.
  const iso = value.length === 10 ? `${value}T12:00:00Z` : value;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;

  try {
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      // The workspace zone. Falling back to UTC rather than the
      // browser's keeps the answer the same everywhere when the
      // calendar query has not answered yet, so the value does not
      // shift by a day once it does.
      timeZone: calendar?.timezone ?? "UTC",
    });
  } catch {
    // An IANA zone the runtime does not know throws a RangeError.
    // A wrong-zone date beats a crashed row.
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
}

/**
 * True when `date` is strictly before the workspace's `today`.
 *
 * Both are date-only `YYYY-MM-DD`, so a lexical compare is
 * chronological — no parsing, and therefore no timezone to get wrong.
 */
export function isPast(date: string, today: string): boolean {
  return date.slice(0, 10) < today.slice(0, 10);
}
