import type { CalendarConfig } from "@loctt/contracts";

/**
 * The one place that decides whether a date is a working day, and why.
 *
 * Two surfaces ask this question with the same rules but want the answer
 * in different shapes:
 *  - the timeline shades non-working columns and titles a holiday one
 *    with its bare label (`nonWorkingReason` in `timeline/geometry.ts`,
 *    TML-13);
 *  - the date editor writes an English sentence under the field
 *    ("Saturday is not a working day", `nonWorkingNote` in
 *    `DateField.tsx`, TSK-8), reused by the create modal (NEW-8).
 *
 * They used to carry a byte-for-byte copy of the predicate each, with a
 * comment on the timeline side naming the duplication and saying "if a
 * third caller appears, extract then". The create modal was that third
 * caller (via `nonWorkingNote`), so the predicate is extracted here and
 * both callers format its result. Keeping the *classification* in one
 * place is what stops the two from drifting; the *wording* stays with
 * each caller because only they know what shape their surface needs.
 */

/**
 * How a date relates to the workspace working-week, calendar-driven.
 *
 *  - `undefined` — a working day (or no calendar loaded, or an
 *    unparseable date): callers draw/say nothing.
 *  - `{ holiday }` — a configured holiday; its label is the more useful
 *    answer and wins over the weekday even when the date is also a
 *    weekend.
 *  - `{ weekday }` — a non-working weekday with no holiday; the number is
 *    the UTC day-of-week (0=Sunday…6=Saturday) so a caller can name it.
 *
 * The weekday is derived by parsing `YYYY-MM-DD` as UTC midnight — the
 * only reading that gives the same answer in every browser timezone,
 * which both TSK-8 and TML-13 require. The parse is strict: a shape that
 * is not `YYYY-MM-DD`, or a value some engines roll forward
 * (`2026-02-31`), is treated as "no date" rather than a spurious weekday.
 */
export function classifyNonWorkingDay(
  date: string,
  calendar: CalendarConfig | undefined,
): { holiday: string } | { weekday: number } | undefined {
  if (calendar === undefined) return undefined;
  const day = date.slice(0, 10);
  // A holiday wins over the weekday: on a date that is both, the label is
  // the more useful of the two answers.
  const holiday = calendar.holidays.find(h => h.date === day);
  if (holiday !== undefined) return { holiday: holiday.label };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return undefined;
  // Round-trip guard: `Date.parse` accepts "2026-02-31" in some engines
  // and rolls it forward, which would otherwise yield a real-looking but
  // wrong weekday.
  if (new Date(ms).toISOString().slice(0, 10) !== day) return undefined;
  // UTC day-of-week, so the weekend is the same one in every browser
  // timezone. `getDay()` here would shift it for users east or west of
  // the server.
  const weekday = new Date(ms).getUTCDay();
  return calendar.working_days.includes(weekday) ? undefined : { weekday };
}
