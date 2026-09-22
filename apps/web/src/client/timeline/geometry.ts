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

/**
 * Widen a range so the chart fills at least `minWidth` pixels.
 *
 * "Zoom = column width" means a short dated span draws a narrow chart —
 * at month zoom (4px/day) a three-week span is ~100px, which floated in
 * an empty panel and, at a phone width, effectively vanished (the review
 * blocker). This extends the range's *end* by whole days until the drawn
 * width reaches `minWidth`, so the grid, header and shading fill the
 * viewport rather than clamping to the data span. Extending the end (the
 * future) rather than the start keeps the initial today-centred scroll
 * (TML-16) landing in the same place. A `minWidth` of 0 (unmeasured) is a
 * no-op, so nothing changes until the container has been measured.
 */
export function fillRange(range: DateRange, zoom: TimelineZoom, minWidth: number): DateRange {
  if (minWidth <= 0) return range;
  const px = DAY_WIDTH[zoom];
  const have = rangeWidth(range, zoom);
  if (have >= minWidth) return range;
  const missingDays = Math.ceil((minWidth - have) / px);
  return { start: range.start, end: addDays(range.end, missingDays) };
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
 * The days of `range` whose columns intersect a pixel window (TML-21).
 *
 * The weekend/holiday shading is one absolutely-positioned node per
 * non-working day; at a 129-year day-zoom span that is tens of
 * thousands of nodes. This yields only the days inside the window
 * (plus overscan the caller bakes into `window`), so the shading is
 * windowed the same way the header and grid lines are. Each day's
 * `YYYY-MM-DD` is derived from its own index, so the far end of the
 * range shades the correct calendar days with no accumulated drift.
 */
export function eachDayInWindow(range: DateRange, zoom: TimelineZoom, window: PixelWindow): readonly string[] {
  const w = dayWindow(range, zoom, window);
  if (w === undefined) return [];
  const base = parseDay(range.start);
  if (base === undefined) return [];
  const out: string[] = [];
  for (let i = w.first; i <= w.last; i += 1) out.push(formatDay(base + i * DAY_MS));
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

/**
 * A pixel window `[left, right)` into the chart body, e.g. the visible
 * horizontal viewport padded by overscan. Used to window the header and
 * grid so a 129-year day-zoom span (~47,000 columns) never materializes
 * all its cells at once (TML-21).
 */
export interface PixelWindow {
  readonly left: number;
  readonly right: number;
}

/**
 * The inclusive day-index range `[first, last]` of the columns that a
 * pixel window covers, clamped to the range's own bounds.
 *
 * This is the whole of TML-21's cheap side: converting a scroll window
 * to a handful of day indices is O(1) arithmetic, so the header/grid
 * builders below can start at `first` and stop at `last` instead of
 * walking every day from 1970 to 2099. Returns `undefined` when the
 * window falls entirely outside the range (nothing to draw).
 */
export function dayWindow(
  range: DateRange,
  zoom: TimelineZoom,
  window: PixelWindow,
): { readonly first: number; readonly last: number } | undefined {
  const start = parseDay(range.start);
  const end = parseDay(range.end);
  if (start === undefined || end === undefined || end < start) return undefined;
  const total = Math.round((end - start) / DAY_MS); // last valid index
  const px = DAY_WIDTH[zoom];
  // floor the left edge into its column, ceil the right so a partly
  // visible trailing column is still drawn.
  const first = Math.max(0, Math.floor(window.left / px));
  const last = Math.min(total, Math.ceil(window.right / px) - 1);
  if (last < first) return undefined;
  return { first, last };
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
 *
 * This is the full-range builder — every cell for the whole range. It
 * is what the unit tests assert against and is correct for ordinary
 * spans, but at a 129-year day-zoom span it emits ~47,000 cells, which
 * is TML-21's problem. `headerCellsInWindow` is the windowed form the
 * chart renders with; this one is retained because it is the reference
 * both the tests and the windowed builder are checked against.
 */
export function headerCells(
  range: DateRange,
  zoom: TimelineZoom,
  calendar: CalendarConfig | undefined,
): readonly HeaderCell[] {
  const last = daysBetween(range.start, range.end);
  if (last < 0) return [];
  return headerCellsForIndices(range, zoom, calendar, 0, last);
}

/**
 * Header cells intersecting a pixel window (TML-21).
 *
 * Same output shape and same `left`/`width` values as `headerCells`
 * would give for the cells it emits — a windowed cell is byte-identical
 * to its full-range twin, so a caller cannot tell whether it is
 * windowing except by counting nodes. The window is converted to day
 * indices once (`dayWindow`, O(1)) and only the cells overlapping those
 * indices are built. For week/month zoom the emitted cells are widened
 * to their true calendar boundaries so a partially-visible week or
 * month still carries its correct label and span.
 */
export function headerCellsInWindow(
  range: DateRange,
  zoom: TimelineZoom,
  calendar: CalendarConfig | undefined,
  window: PixelWindow,
): readonly HeaderCell[] {
  const w = dayWindow(range, zoom, window);
  if (w === undefined) return [];
  return headerCellsForIndices(range, zoom, calendar, w.first, w.last);
}

/**
 * The shared body of both header builders: emit the cells covering the
 * inclusive day-index range `[firstIdx, lastIdx]`.
 *
 * Every cell's `left`/`width` is derived purely from its day index and
 * the zoom's column width, never from an accumulated offset, so a
 * windowed cell at index 40,000 lands at exactly `40000 * px` with no
 * drift from floating-point stepping (TML-21's fourth bullet). For
 * week/month the boundary that owns `firstIdx` may begin before the
 * window; the cell is still emitted from its own start so its label and
 * span are correct, and the walk stops as soon as a cell starts past
 * `lastIdx`.
 */
function headerCellsForIndices(
  range: DateRange,
  zoom: TimelineZoom,
  calendar: CalendarConfig | undefined,
  firstIdx: number,
  lastIdx: number,
): readonly HeaderCell[] {
  const base = parseDay(range.start);
  if (base === undefined || lastIdx < firstIdx) return [];
  const px = DAY_WIDTH[zoom];
  const dayAt = (i: number): string => formatDay(base + i * DAY_MS);
  // The last day index in the whole range — cells never extend past it,
  // even when a week/month straddles the range's trailing edge.
  const rangeLast = daysBetween(range.start, range.end);

  if (zoom === "day") {
    const cells: HeaderCell[] = [];
    for (let i = firstIdx; i <= lastIdx; i += 1) {
      const d = dayAt(i);
      cells.push({
        key: d,
        // Day-of-month alone: at 36px a full date does not fit, and the
        // month is already legible from the row above it in practice.
        label: String(Number(d.slice(8, 10))),
        left: i * px,
        width: px,
      });
    }
    return cells;
  }

  if (zoom === "week") {
    const firstDow = calendar?.first_day_of_week ?? 0;
    const cells: HeaderCell[] = [];
    // Back up to the start of the week that owns firstIdx (clamped to 0
    // so a partial leading week still begins at the chart's own start).
    const firstDay = dayAt(firstIdx);
    const firstMs = parseDay(firstDay);
    const firstOffset = firstMs === undefined ? 0 : (new Date(firstMs).getUTCDay() - firstDow + 7) % 7;
    let i = Math.max(0, firstIdx - firstOffset);
    while (i <= lastIdx) {
      const day = dayAt(i);
      const ms = parseDay(day);
      const dow = ms === undefined ? 0 : new Date(ms).getUTCDay();
      const offset = (dow - firstDow + 7) % 7;
      // The very first cell of the whole range may be a partial week
      // (`offset` days into a week) — clamp it rather than drawing a
      // cell that begins before 0. The trailing cell is clamped to the
      // range's own last day so a week straddling the end does not draw
      // past it. `i` was backed up to a week boundary above, so for
      // every cell but a mid-week range start `offset` is 0.
      const span = Math.min(7 - offset, rangeLast - i + 1);
      cells.push({ key: day, label: day.slice(5), left: i * px, width: span * px });
      i += span;
    }
    return cells;
  }

  // Month: one cell per calendar month. Back up to the first of the
  // month that owns firstIdx so a partially-visible month carries its
  // real label and width.
  const cells: HeaderCell[] = [];
  const firstMonthDay = Number(dayAt(firstIdx).slice(8, 10));
  let i = firstIdx - (firstMonthDay - 1);
  if (i < 0) i = 0;
  while (i <= lastIdx) {
    const day = dayAt(i);
    const month = day.slice(0, 7);
    let span = 0;
    // Stop at the month boundary or the range's last day, whichever
    // comes first, so the trailing month is not drawn past the range.
    while (i + span <= rangeLast && dayAt(i + span).slice(0, 7) === month) span += 1;
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
