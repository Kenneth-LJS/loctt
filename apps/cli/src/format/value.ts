/**
 * Small formatting primitives shared by multiple CLI commands.
 *
 * `formatValue` is the centerpiece — coerces any frontmatter or
 * history-meta value (which can be string | number | bool | array
 * | object | null | undefined) into a human-readable cell.
 *
 * `formatNumber` and `pad` are column-alignment helpers used by
 * the burndown table renderer and a few list-view formats.
 */

/** Round a number to one decimal place for compact column display. */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/** Right-pad a string to `width` columns (single-byte assumption). */
export function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * Renders any frontmatter / history-meta value as a single line
 * string. Used by `formatHistoryEntry` and a few `info`-style
 * commands that need to print arbitrary values inline.
 *
 * `(none)` is the sentinel for null/undefined; objects fall
 * through to `JSON.stringify` which is good enough for log lines.
 */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}
