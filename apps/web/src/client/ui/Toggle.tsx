import { forwardRef,type InputHTMLAttributes } from "react";

import { cn } from "./cn.ts";

/**
 * A switch — a real native `<input type="checkbox" role="switch">`
 * painted `appearance-none` as a track + thumb. `role="switch"` keeps
 * the AT announcement A11Y-21 asks for.
 *
 * Intended for the ~3 *view* toggles (FilterBar "Show archived",
 * MilestonesView archived, TimelineView dependencies) — NOT form-field
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

const TRACK_BASE =
  "peer appearance-none shrink-0 h-4 w-7 rounded-full border-0 bg-border-strong " +
  "cursor-pointer transition-colors " +
  "checked:bg-accent " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]";

const THUMB =
  "pointer-events-none absolute left-0.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full " +
  "bg-accent-contrast transition-transform peer-checked:translate-x-3";

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
