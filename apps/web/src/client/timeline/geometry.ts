import type { CalendarConfig, TimelineZoom } from "@loctt/contracts";

import { classifyNonWorkingDay } from "../dates/workingDays.ts";

/**
 * Timeline date/pixel arithmetic (M3.3a).
 *
 * Pure functions, no React, no DOM — every one of these is unit-tested
 * directly because a UI test asserting "a bar is visible" passes
 * whether or not the geometry is right. TML-3 and TML-4 are entirely
 * about *where the edges land*, which is arithmetic.
 *
 * ## The one rule that makes the rest work
 *
 * Every date is handled as a `YYYY-MM-DD` civil date parsed at **UTC
 * midnight**, never in local time. `new Date("2026-03-02")` is already
 * UTC, but `new Date(2026, 2, 2)` is local — and in a UTC-negative zone
 * those are different days. Mixing the two is how a bar lands one
 * column left of its gridline for half the world's users.
 *
 * A consequence worth stating because it is a *feature*, not an
 * oversight: day arithmetic here is exact multiplication by 86_400_000
 * with no DST correction. The timeline's columns are civil days
 * ("2026-03-02"), not 24-hour spans of instants, so a spring-forward
 * day is still exactly one column wide. Doing this in local time would
 * make one column of the year 23 hours and produce a fractional
 * offset for every bar after it.
 *
 * ## Inclusivity
 *
 * TML-4: bars run `start_date` → `due_date` **inclusive**. A task
 * whose start and due are the same day is one column wide, not zero.
 * Internally this is expressed by drawing to the *end* of the due
 * day — `dayIndex(due) + 1` — which is also why the right edge sits at
 * the end of 2026-03-06 rather than at its start.
 */

/** Milliseconds in one civil day. */
const DAY_MS = 86_400_000;

/** Pixel width of a single day column, per zoom (TML-3). */
export const DAY_WIDTH: Readonly<Record<TimelineZoom, number>> = {
  day: 36,
  week: 12,
  month: 4,
};

/**
 * Parses a `YYYY-MM-DD` (or ISO datetime) to UTC-midnight epoch ms.
 * Returns `undefined` for anything unparseable, so callers can treat a
 * malformed date as "no date" rather than propagating `NaN` into a
 * pixel offset and rendering a bar at `left: NaNpx`.
 */
export function parseDay(date: string | undefined): number | undefined {
  if (date === undefined) return undefined;
  const day = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return undefined;
  // Date.parse accepts "2026-02-31" in some engines and rolls it
  // forward. Round-tripping catches that: a date that does not
  // serialize back to itself was never a real calendar day.
  if (new Date(ms).toISOString().slice(0, 10) !== day) return undefined;
  return ms;
}

/** Formats UTC-midnight epoch ms back to `YYYY-MM-DD`. */
export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Adds `n` whole days to a `YYYY-MM-DD`, returning `YYYY-MM-DD`. */
export function addDays(date: string, n: number): string {
  const base = parseDay(date);
  if (base === undefined) return date;
  return formatDay(base + n * DAY_MS);
}

/**
 * Whole days from `from` to `to`, signed. Same day → 0.
 *
 * Exact division: both operands are UTC midnights, so the difference
 * is always a whole multiple of DAY_MS and there is nothing to round.
 */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a === undefined || b === undefined) return 0;
  return Math.round((b - a) / DAY_MS);
}

/** The window of days the chart draws, inclusive of both ends. */
export interface DateRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Column index of `date` within `range`, where the range's first day
 * is 0. Negative before the range, which is legitimate — the caller
 * clips, rather than this silently clamping a bar into view and
 * showing it at the wrong date.
 */
export function dayIndex(range: DateRange, date: string): number {
  return daysBetween(range.start, date);
}

/** Pixel x of the *start* of `date`'s column. */
export function dateToX(range: DateRange, date: string, zoom: TimelineZoom): number {
  return dayIndex(range, date) * DAY_WIDTH[zoom];
}

/**
 * The date whose column contains pixel `x`, snapped to a whole day
 * (TML-12: "the resulting dates are whole days; no time component and
 * no half-day landing").
 *
 * `Math.floor` rather than round: the snap target is the day *under*
 * the cursor, which is the day whose column the pixel falls inside.
 * Rounding would jump to the next day as soon as the cursor passed a
 * column's midpoint, so the date under the pointer and the date the
 * drag commits would disagree — the aiming problem TML-12's second
 * bullet is about at month zoom, where a day is 4px wide.
 *
 * Left here rather than in M3.3b's drag layer because it is the exact
 * inverse of `dateToX` and the two are only trustworthy when tested
 * as a pair.
 */
export function xToDate(range: DateRange, x: number, zoom: TimelineZoom): string {
  const base = parseDay(range.start);
  if (base === undefined) return range.start;
  return formatDay(base + Math.floor(x / DAY_WIDTH[zoom]) * DAY_MS);
}

/** A bar's horizontal placement, in pixels. */
export interface BarGeometry {
  readonly left: number;
  readonly width: number;
}

/**
 * Pixel geometry for a bar spanning `start`..`due` **inclusive**
 * (TML-4).
 *
 * The width is `(days + 1)` columns, which is the whole of TML-4's
 * first two bullets: a same-day task is one column (not zero), and a
 * 2026-03-02 → 2026-03-06 task is five, with its right edge at the
 * *end* of the 6th.
 *
 * A reversed pair (`due` before `start`) yields a zero width rather
 * than a negative one. Negative-width bars are TML-18's subject and
 * belong to M3.3b; returning 0 here means the renderer cannot draw a
 * backwards bar by accident while that case is still unbuilt.
 */
export function barGeometry(
  range: DateRange,
  start: string,
  due: string,
  zoom: TimelineZoom,
): BarGeometry {
  const px = DAY_WIDTH[zoom];
  const left = dayIndex(range, start) * px;
  const spanDays = daysBetween(start, due) + 1;
  return { left, width: Math.max(0, spanDays) * px };
}

/**
 * The range the chart covers: every dated task, padded, and always
 * including `today` so the today-marker and the initial scroll
 * (TML-16) have somewhere to land.
 *
 * Padding is in whole weeks so the week-zoom header does not begin
 * mid-week.
 */
export function computeRange(
  dates: readonly string[],
  today: string,
  padDays = 7,
): DateRange {
  const valid = dates.filter(d => parseDay(d) !== undefined);
  const all = [...valid, today].filter(d => parseDay(d) !== undefined);
  if (all.length === 0) return { start: today, end: today };
  let min = all[0] as string;
  let max = all[0] as string;
  for (const d of all) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { start: addDays(min, -padDays), end: addDays(max, padDays) };
}

/** Total pixel width of the chart body at a given zoom. */
export function rangeWidth(range: DateRange, zoom: TimelineZoom): number {
  return (daysBetween(range.start, range.end) + 1) * DAY_WIDTH[zoom];
}

/** Every day in `range`, inclusive, as `YYYY-MM-DD`. */
export function eachDay(range: DateRange): readonly string[] {
  const start = parseDay(range.start);
  const end = parseDay(range.end);
  if (start === undefined || end === undefined || end < start) return [];
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) out.push(formatDay(ms));
  return out;
}

/**
 * Why `date` is not a working day, formatted for a shaded timeline
 * column's tooltip. The classification lives in
 * `dates/workingDays.classifyNonWorkingDay` — the one predicate both
 * this and `DateField.nonWorkingNote` share (TML-13 and TSK-8), so the
 * two can no longer drift. This formats the shared result the way the
 * timeline wants it.
 *
 * Returns:
 *  - `undefined` — a working day, draw nothing.
 *  - a holiday's `label` — shade it and title it (TML-13 bullet 2).
 *  - `""` — a non-working weekday with no holiday; shade it, no title.
 */
export function nonWorkingReason(
  date: string,
  calendar: CalendarConfig | undefined,
): string | undefined {
  const kind = classifyNonWorkingDay(date, calendar);
  if (kind === undefined) return undefined;
  return "holiday" in kind ? kind.holiday : "";
}

/** A labelled header cell spanning one or more day columns. */
export interface HeaderCell {
  /** Stable React key. */
  readonly key: string;
  readonly label: string;
  readonly left: number;
  readonly width: number;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Header cells for a zoom level (TML-3: "individual dates at day;
 * week-starting dates at week; month names at month").
 *
 * Week cells begin on the calendar's `first_day_of_week`, so a
 * workspace that starts its week on Monday does not get a header
 * offset by one from its own configuration.
 */
export function headerCells(
  range: DateRange,
  zoom: TimelineZoom,
  calendar: CalendarConfig | undefined,
): readonly HeaderCell[] {
  const days = eachDay(range);
  if (days.length === 0) return [];
  const px = DAY_WIDTH[zoom];

  if (zoom === "day") {
    return days.map((d, i) => ({
      key: d,
      // Day-of-month alone: at 36px a full date does not fit, and the
      // month is already legible from the row above it in practice.
      label: String(Number(d.slice(8, 10))),
      left: i * px,
      width: px,
    }));
  }

  if (zoom === "week") {
    const firstDow = calendar?.first_day_of_week ?? 0;
    const cells: HeaderCell[] = [];
    let i = 0;
    while (i < days.length) {
      const day = days[i] as string;
      const ms = parseDay(day);
      const dow = ms === undefined ? 0 : new Date(ms).getUTCDay();
      // The first cell may be a partial week — the range's start is
      // rarely a week boundary. Clamp it rather than drawing a cell
      // that begins before the chart does.
      const offset = (dow - firstDow + 7) % 7;
      const span = Math.min(7 - offset, days.length - i);
      cells.push({ key: day, label: day.slice(5), left: i * px, width: span * px });
      i += span;
    }
    return cells;
  }

  // Month: one cell per calendar month, spanning only the days
  // actually inside the range.
  const cells: HeaderCell[] = [];
  let i = 0;
  while (i < days.length) {
    const day = days[i] as string;
    const month = day.slice(0, 7);
    let span = 0;
    while (i + span < days.length && (days[i + span] as string).slice(0, 7) === month) span += 1;
    const monthIdx = Number(month.slice(5, 7)) - 1;
    cells.push({
      key: month,
      label: `${MONTH_NAMES[monthIdx] ?? month} ${month.slice(0, 4)}`,
      left: i * px,
      width: span * px,
    });
    i += span;
  }
  return cells;
}
