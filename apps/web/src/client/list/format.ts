/**
 * Date formatting helpers for list cells. Kept pure and
 * caller-supplies-`now` so they're trivially testable and don't read
 * the clock mid-render.
 */

/** "Jan 15" style short date from a YYYY-MM-DD or ISO string. */
export function shortDate(value: string, today?: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  // The year is dropped only for the current one. "Dec 31" for a date
  // in 2099 is not a real date (LST-22) — it reads as this year, which
  // is the opposite of what the value says. Comparing against the
  // workspace's date rather than the browser's keeps the boundary
  // where the rest of the app puts it.
  const thisYear = (today ?? new Date().toISOString()).slice(0, 4);
  const sameYear = d.toISOString().slice(0, 4) === thisYear;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** True when a due date (YYYY-MM-DD) is strictly before `today`. */
export function isOverdue(dueDate: string, today: string): boolean {
  // Both are date-only; lexical compare on YYYY-MM-DD is chronological.
  const due = dueDate.length >= 10 ? dueDate.slice(0, 10) : dueDate;
  return due < today;
}

/**
 * Compact relative time ("just now", "5m ago", "3h ago", "2d ago",
 * "3w ago", "5mo ago", "2y ago") from an ISO timestamp. Falls back to
 * a short date past a year so the column stays scannable.
 */
export function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  // Floor the coarse buckets so "45 days" reads "1mo", not "2mo" —
  // conservative rounding reads more naturally at month/year scale.
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}
