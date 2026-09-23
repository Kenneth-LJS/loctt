import { cn } from "../cn.ts";
import { LOGO_L, LOGO_O } from "./LogoMark.tsx";

/**
 * The animated counterpart to `LogoMark`: the same "L"/"o" mark, spinning
 * and pulsing apart on load, used wherever the app previously showed bare
 * "Loading…" text.
 *
 * Source: Ken supplied two SVGs (`loctt-animated-64-*-color.svg`, one per
 * theme) that are byte-identical except for two `fill`s — `data-part="l"`
 * (`#39A88F` dark / `#0F766E` light) and `data-part="o"` (`#F4F4F3` dark /
 * `#0F172A` light). Those are exactly `--accent` and `--text-primary`
 * (`tokens.css`), the same tokens `LogoMark` already uses. So this is
 * *one* inlined SVG themed with `var(--accent)` / `var(--text-primary)`,
 * not two files switched by `prefers-color-scheme` — asked for explicitly
 * ("dont copy 2 svgs, copy one and use css styling for it").
 *
 * **Keyframes are global, on purpose, matching the one other animation
 * in this codebase** (`hash-target-flash` in `styles/index.css`): Vite
 * has no CSS Modules set up anywhere in this app, and adding that
 * tooling for one component is more surface than the problem calls for.
 * `@keyframes` cannot be scoped with a plain `<style>` in the SVG itself
 * without either (a) defining them fresh on every mounted instance
 * (harmless for behaviour, since identical `@keyframes` rules just
 * overwrite each other, but wasteful with ~19 `LoadingState` consumers
 * potentially on screen) or (b) template-scoping the names per instance
 * (needless complexity for three rules that never change). Defining
 * `loctt-rot` / `loctt-l` / `loctt-o` once, globally, in `index.css` is
 * the existing pattern and the simplest correct one — the names are
 * already distinctive (`loctt-*`) so they cannot collide with anything
 * else in the stylesheet.
 *
 * The reduced-motion block from the source SVG is preserved as
 * `.loctt-spin` also is (`prefers-reduced-motion: reduce`), even though
 * `index.css` already has a global reduced-motion rule that zeroes every
 * animation's duration app-wide. Belt-and-suspenders: `!important` on a
 * duration is what that global rule uses, and it is a *duration* cut, not
 * `animation: none` — this component's local rule is authoritative for
 * disabling the geometry entirely if the global rule is ever narrowed to
 * exclude decorative loops, which is exactly the kind of drift this rule
 * exists to make explicit rather than rely on the global one implicitly.
 */
export function LogoSpinner({
  size = 24,
  className,
  label,
}: {
  /**
   * Pixel size, or any valid SVG `width`/`height` string (e.g. a `rem`
   * value, for a caller — like `Button`'s `loading` state — that scales
   * with the root font size rather than a fixed pixel grid). The source
   * viewBox is padded (see below) so callers can treat this like any
   * other icon prop — no clipping to account for.
   */
  readonly size?: number | string;
  /** Escape hatch on the svg: layout/spacing only. */
  readonly className?: string;
  /**
   * Accessible name. Optional because most call sites already have a
   * `role="status"` ancestor (`LoadingState`) carrying an sr-only message
   * — a name here would be redundant with that live region's text and
   * some screen readers announce both. Pass it only when the spinner
   * stands with no such ancestor.
   */
  readonly label?: string;
}) {
  const a11y =
    label === undefined
      ? ({ "aria-hidden": true } as const)
      : ({ role: "img", "aria-label": label } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      // Padded 12.5% on every side vs. LogoMark's plain `0 0 64 64`: the
      // "L" rotates about the mark's center and swings past its own
      // bounding box mid-cycle. Without this margin the spin clips.
      viewBox="-19.255 -19.255 102.510 102.510"
      width={size}
      height={size}
      className={cn("loctt-spin shrink-0", className)}
      data-testid="logo-spinner"
      {...a11y}
    >
      <path
        data-part="l"
        className="loctt-spin-l"
        fill="var(--accent)"
        d={LOGO_L}
      />
      <path
        data-part="o"
        className="loctt-spin-o"
        fill="var(--text-primary)"
        d={LOGO_O}
      />
    </svg>
  );
}
