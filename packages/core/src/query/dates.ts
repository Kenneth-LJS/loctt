/**
 * K80 date functions for the query DSL — the shared name set, offset
 * grammar, and the pure date math the evaluator resolves them with.
 *
 * `startOf*` / `endOf*` resolve to a bare `YYYY-MM-DD` calendar date (the
 * same shape as the `today` literal), so they compare against date fields
 * through the evaluator's existing day-granularity `compareDates`. `now()`
 * resolves to a full ISO-8601 timestamp and is only meaningful against the
 * true timestamp fields (`created_at`/`updated_at`/…) — the validator
 * keeps it off calendar-date fields.
 *
 * All math here is **string-based on the `YYYY-MM-DD` components** — no
 * `new Date("YYYY-MM-DD")` round-trips, which would reintroduce the
 * timezone/DST drift the codebase deliberately avoids (see the evaluator's
 * date-boundary tests and `datesInverted`).
 */

/** The seven K80 date functions. `now` is the only instant; the rest are dates. */
export type DateFn =
  | "now"
  | "startOfDay"
  | "startOfWeek"
  | "startOfMonth"
  | "endOfDay"
  | "endOfWeek"
  | "endOfMonth";

/** A parsed, sign-normalised offset argument, e.g. `+1w` → {sign:1,n:1,unit:"w"}. */
export interface DateOffset {
  readonly sign: 1 | -1;
  readonly n: number;
  readonly unit: "d" | "w" | "m";
}

const DATE_FN_NAMES: Record<string, DateFn> = {
  now: "now",
  startofday: "startOfDay",
  startofweek: "startOfWeek",
  startofmonth: "startOfMonth",
  endofday: "endOfDay",
  endofweek: "endOfWeek",
  endofmonth: "endOfMonth",
};

/** The date-boundary functions (everything except `now`). */
const BOUNDARY_FNS = new Set<DateFn>([
  "startOfDay", "startOfWeek", "startOfMonth",
  "endOfDay", "endOfWeek", "endOfMonth",
]);

/** Resolves a word (case-insensitive) to a `DateFn`, or null if it is not one. */
export function dateFnFromWord(word: string): DateFn | null {
  return DATE_FN_NAMES[word.toLowerCase()] ?? null;
}

/** True for the date-boundary functions, which accept an offset; `now` does not. */
export function isBoundaryFn(fn: DateFn): boolean {
  return BOUNDARY_FNS.has(fn);
}

/**
 * The reason a raw offset string is invalid, or null when it is valid.
 * Used by the parser to raise a `ParseError` at the argument's position.
 */
export function offsetError(raw: string): string | null {
  if (!/^[+-]/.test(raw)) {
    return `offset "${raw}" needs a sign: e.g. "+1w" or "-1w"`;
  }
  const unit = raw.slice(-1);
  if (!/[0-9]/.test(raw.slice(1, -1)) || !/^[+-]\d+[a-z]$/.test(raw)) {
    return `invalid offset "${raw}": expected e.g. "+1w", "-3d", "+2m"`;
  }
  if (unit !== "d" && unit !== "w" && unit !== "m") {
    return `unknown offset unit "${unit}": use d (days), w (weeks), or m (months)`;
  }
  return null;
}

/** Parses a validated offset string (call {@link offsetError} first). */
export function parseOffset(raw: string): DateOffset {
  const m = /^([+-])(\d+)([dwm])$/.exec(raw);
  if (m === null) throw new Error(`unreachable: unvalidated offset "${raw}"`);
  return {
    sign: m[1] === "-" ? -1 : 1,
    n: Number(m[2]),
    unit: m[3] as "d" | "w" | "m",
  };
}

/* -------------------------------------------------------------------- *
 * Pure date math on `YYYY-MM-DD` components — no `new Date(string)`.
 * `Date.UTC(y, m, d)` is used only as an integer day counter (its epoch
 * ms ÷ 86.4e6), never parsed from or formatted to a local zone, so DST
 * cannot shift a boundary. Every input and output is a bare calendar
 * date in the workspace's own day-space (the caller's `today`).
 * -------------------------------------------------------------------- */

interface Ymd { y: number; m: number; d: number; }

function parseYmd(date: string): Ymd {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

function formatYmd({ y, m, d }: Ymd): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Day-of-week for a date, 0=Sun..6=Sat, via UTC (no local-zone parse). */
function dayOfWeek({ y, m, d }: Ymd): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Adds `n` days (may be negative) using UTC day arithmetic. */
function addDays(ymd: Ymd, n: number): Ymd {
  const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d) + n * 86_400_000;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Last calendar day of a given year/month (28–31), via day-0-of-next-month. */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Adds `n` months (may be negative), clamping the day to the target
 * month's length (Jan 31 +1m → Feb 28/29). Pure component math.
 */
function addMonths({ y, m, d }: Ymd, n: number): Ymd {
  const zeroBased = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(zeroBased / 12);
  const nm = (zeroBased % 12 + 12) % 12 + 1;
  return { y: ny, m: nm, d: Math.min(d, lastDayOfMonth(ny, nm)) };
}

function applyOffset(ymd: Ymd, offset: DateOffset | undefined): Ymd {
  if (offset === undefined) return ymd;
  const signed = offset.sign * offset.n;
  switch (offset.unit) {
    case "d": return addDays(ymd, signed);
    case "w": return addDays(ymd, signed * 7);
    case "m": return addMonths(ymd, signed);
  }
}

/**
 * Resolves a `startOf*`/`endOf*` function to a bare `YYYY-MM-DD`, from the
 * workspace's `today` and `weekStartsOn` (0=Sun..6=Sat). The offset is
 * applied AFTER the boundary, so `endOfWeek("+1w")` is the end of *next*
 * week. `now` is not handled here — it is a timestamp (see the evaluator).
 */
export function resolveBoundaryDate(
  fn: Exclude<DateFn, "now">,
  today: string,
  weekStartsOn: number,
  offset?: DateOffset,
): string {
  // The offset shifts the *reference day* first, then the boundary is
  // taken — so `endOfWeek("+1w")` is the end of next week and
  // `endOfMonth("+1m")` is the last day of next month (June→July 31),
  // rather than the source boundary nudged by a fixed number of days
  // (which would clamp July to the 30th). This is the only rule that is
  // correct for weeks AND for the variable-length month boundaries.
  const t = applyOffset(parseYmd(today), offset);
  let base: Ymd;
  switch (fn) {
    case "startOfDay":
    case "endOfDay":
      // A calendar day is a single date; start and end coincide.
      base = t;
      break;
    case "startOfWeek": {
      const back = (dayOfWeek(t) - weekStartsOn + 7) % 7;
      base = addDays(t, -back);
      break;
    }
    case "endOfWeek": {
      const back = (dayOfWeek(t) - weekStartsOn + 7) % 7;
      base = addDays(t, 6 - back);
      break;
    }
    case "startOfMonth":
      base = { ...t, d: 1 };
      break;
    case "endOfMonth":
      base = { ...t, d: lastDayOfMonth(t.y, t.m) };
      break;
  }
  return formatYmd(base);
}
