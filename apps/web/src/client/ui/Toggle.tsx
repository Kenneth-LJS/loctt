import { forwardRef,type InputHTMLAttributes } from "react";

import { cn } from "./cn.ts";

/**
 * A switch — a real native `<input type="checkbox" role="switch">`
 * painted `appearance-none` as a track + thumb. `role="switch"` keeps
 * the AT announcement A11Y-21 asks for.
 *
 * Intended for *view* toggles (TimelineView dependencies) — NOT form-field
 * booleans (Estimation "Enabled", custom-field booleans stay `Checkbox`).
 * switch-vs-checkbox for those view toggles is a look decision, not a
 * correctness one (spec §1.9 / open decision #1) — this primitive exists
 * so the switch look is available if Ken wants it; the migration (B4)
 * decides which controls adopt it.
 *
 * The thumb is a sibling span translated on `:checked` via `peer-checked`.
 * `data-testid` passes through to the `<input>`.
 */
export interface ToggleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

// A11Y-55: the track is the visible hit target, sized to the 24px
// WCAG 2.5.8 minimum on its short axis (not an invisible overlay —
// the switch itself grows, in line with K31's "grow the visible
// control" pattern from the drag-handle fix). Pixel arbitrary values,
// not the `h-6`/`w-11` scale: this app's root font-size is 87.5% of
// the browser default, so `rem`-based sizes measure short (h-6 came
// out 21px, not 24, the same trap `min-h-[24px]` elsewhere in this
// codebase already routes around).
//
// K135 (B30): a disabled switch drops the accent entirely rather than
// fading it. The old `opacity-50` over `bg-accent` still read as a
// bright "on" in dark mode. Disabled, checked or not, the track takes
// the muted `border-default` token and the thumb `bg-surface`, so the
// state stays legible from the thumb's position while the colour says
// "not available". `disabled:checked:` stacks two pseudo-classes, so
// it outranks `checked:bg-accent` whatever order the utilities emit in.
const TRACK_BASE =
  "peer appearance-none shrink-0 h-[24px] w-[44px] rounded-full border-0 bg-border-strong " +
  "cursor-pointer transition-colors " +
  "checked:bg-accent " +
  "disabled:cursor-not-allowed disabled:bg-border-default disabled:checked:bg-border-default " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]";

const THUMB =
  "pointer-events-none absolute left-[4px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full " +
  "bg-accent-contrast transition-transform peer-checked:translate-x-[20px] " +
  "peer-disabled:bg-bg-surface";

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  function Toggle({ className, ...rest }, ref) {
    return (
      <span className={cn("relative inline-flex items-center", className)}>
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          className={TRACK_BASE}
          {...rest}
        />
        <span aria-hidden="true" className={THUMB} />
      </span>
    );
  },
);
