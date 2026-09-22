import { cn } from "../cn.ts";

/**
 * The LocTT brand mark: an "L" with an abstract rounded-square "o" sitting
 * in its notch. The source is `loctt-mark.svg` (one evenodd path with two
 * subpaths); it is realised here as two `<path>`s so each part takes its
 * own fill.
 *
 * Colours are tokens, so the mark follows the theme without a prop:
 *
 * - **"L" → `--accent`.** The big shape carries the brand colour; it is
 *   the same indigo the primary action and selected states use, so the
 *   mark and the UI read as one system in both themes.
 * - **"o" → `--text-primary`.** Ink, not a second indigo. `--accent` and
 *   `--accent-hover` sit one step apart in both palettes (#4F46E5 vs
 *   #4338CA light, #818CF8 vs #A5B4FC dark) — too close for a 6px shape
 *   to read as a *separate* part at header size. Ink is unambiguous on
 *   either surface (near-black on the light canvas, near-white on the
 *   dark one) and makes the "o" read as a deliberate full stop next to
 *   the "L", which is the point of the mark.
 *
 * Decorative by default: beside the "LocTT" wordmark the text carries the
 * name, so the SVG is `aria-hidden`. Pass `label` when the mark stands
 * alone (no wordmark) and it becomes `role="img"` with that name.
 */
export function LogoMark({
  size = 22,
  className,
  label,
}: {
  readonly size?: number;
  /** Escape hatch on the svg: layout/spacing only. */
  readonly className?: string;
  /** Accessible name when the mark is *not* next to the wordmark. */
  readonly label?: string;
}) {
  const a11y =
    label === undefined
      ? ({ "aria-hidden": true } as const)
      : ({ role: "img", "aria-label": label } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      data-testid="logo-mark"
      {...a11y}
    >
      <path
        data-part="l"
        fill="var(--accent)"
        d={LOGO_L}
      />
      <path
        data-part="o"
        fill="var(--text-primary)"
        d={LOGO_O}
      />
    </svg>
  );
}

/** The "L" — first subpath of `loctt-mark.svg`. */
export const LOGO_L =
  "M0 5.568A5.568 5.568 0 0 1 5.568 0L13.056 0A6.592 6.592 0 0 1 17.728 1.92L22.4 6.592" +
  "A6.592 6.592 0 0 1 24.32 11.264L24.32 27.712A11.968 11.968 0 0 0 36.288 39.68L52.736 39.68" +
  "A6.592 6.592 0 0 1 57.408 41.6L62.08 46.272A6.592 6.592 0 0 1 64 50.944L64 58.432" +
  "A5.568 5.568 0 0 1 58.432 64L5.568 64A5.568 5.568 0 0 1 0 58.432Z";

/** The "o" — second subpath of `loctt-mark.svg` (top-right rounded square). */
export const LOGO_O =
  "M30.72 10.048A5.568 5.568 0 0 1 36.288 4.48L53.952 4.48A5.568 5.568 0 0 1 59.52 10.048" +
  "L59.52 27.712A5.568 5.568 0 0 1 53.952 33.28L36.288 33.28A5.568 5.568 0 0 1 30.72 27.712Z";
