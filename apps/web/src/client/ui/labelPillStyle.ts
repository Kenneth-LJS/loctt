/**
 * The label pill's visual rule, in one place, so the real pill and its
 * preview cannot drift apart.
 *
 * ## Why this is its own module
 *
 * A pill is not painted *with* the label colour — it is painted with
 * three values DERIVED from it: a `${color}22` (13% alpha) background
 * wash, a `${color}66` (40%) border, and a text colour chosen by luma.
 * That is the whole reason a two-mode preview earns its place here: a
 * palette swatch tells you "blue", it does not tell you that at 13%
 * alpha over a dark surface that blue becomes a barely-there smudge.
 *
 * Which means a preview that *approximates* the pill is worse than no
 * preview — it would report a legibility that the real list does not
 * have. So the preview does not approximate it: it calls this, and so
 * does `list/cells.tsx`. One function, two call sites, no replica.
 *
 * This module takes a RESOLVED hex (`string | undefined`), never an
 * `EntityColor`, and reads no theme — the caller has already picked the
 * mode. That is what lets the preview render a light-mode pill and a
 * dark-mode pill on the same page (see `ui/ThemePreview.tsx`).
 */

/**
 * A text colour that stays legible on a 13%-alpha wash of `hex`.
 *
 * The wash sits over the surface, so the effective background is close
 * to the surface itself — which means the *theme* decides readability
 * far more than the label colour does. Returning a token rather than a
 * computed value lets both themes stay legible without the pill
 * knowing which one is active (MSL-23).
 *
 * The label's own colour is kept where it reads on that wash;
 * otherwise the pill hands back to the surface's own text colour,
 * which is legible by construction.
 */
export function readableOn(hex: string): string {
  const n = hex.length === 4
    ? hex.slice(1).split("").map(c => parseInt(c + c, 16))
    : [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r = 0, g = 0, b = 0] = n;
  // Rec. 601 luma, which is what browsers' own contrast heuristics use.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // Too pale to read on a light background, too dark on a dark one:
  // hand back to the theme rather than guessing.
  return luma > 0.75 || luma < 0.25 ? "var(--text-primary)" : hex;
}

/** The pill's class list — identical for the real pill and the preview. */
export const LABEL_PILL_CLASS =
  "inline-flex items-center rounded border border-border-subtle px-1.5 py-0.5 text-[0.7857rem]";

/**
 * The pill's inline style for one already-resolved colour.
 *
 * `undefined` (no colour, or a palette reference that did not resolve)
 * yields the neutral token fallback — the MSL-22 behaviour, so a broken
 * reference degrades to a visible neutral pill rather than an unstyled
 * one or a made-up hex.
 */
export function labelPillStyle(color: string | undefined): React.CSSProperties {
  if (color === undefined) {
    return { background: "var(--bg-muted)", color: "var(--text-secondary)" };
  }
  // MSL-23: text contrast is computed against the pill's *own*
  // background. Using the label colour for both meant a very pale
  // yellow rendered pale-on-pale and a very dark navy dark-on-dark —
  // legible in the middle of the range, invisible at the ends.
  return {
    background: `${color}22`,
    color: readableOn(color),
    borderColor: `${color}66`,
  };
}
