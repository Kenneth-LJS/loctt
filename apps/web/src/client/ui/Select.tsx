import { forwardRef,type SelectHTMLAttributes } from "react";

import { cn } from "./cn.ts";
import { ICON } from "./icons.ts";

/**
 * A themed native `<select>`. Standardises the two drifting variants onto
 * one border token (`border-default`) and one radius (`rounded-md`), and
 * replaces the native OS arrow (which does not pick up dark mode) with a
 * themed chevron.
 *
 * The chevron is an overlaid `aria-hidden` `<span>` in `text-text-tertiary`
 * rather than a background-image data-URI: a baked SVG cannot follow the
 * theme token, and `appearance-none` hides the native arrow, so the
 * overlaid glyph is the theme-aware way to draw it. `pr-7` leaves room
 * for it.
 *
 * Skip `task/editors/OptionPicker.tsx` in migration — it is deliberately
 * a custom listbox, not a `<select>`.
 *
 * `data-testid` passes through to the `<select>`.
 */
export type SelectSize = "sm" | "md";

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "size"> {
  readonly size?: SelectSize;
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

const SELECT_SIZE: Record<SelectSize, string> = {
  sm: "h-7 text-label",
  md: "h-8 text-body",
};

const SELECT_BASE =
  "appearance-none w-full rounded-md border border-border-default bg-bg-surface " +
  "px-2 pr-7 text-text-primary cursor-pointer transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)] " +
  "disabled:cursor-not-allowed disabled:bg-bg-muted disabled:text-text-disabled";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ size = "md", className, children, ...rest }, ref) {
    return (
      <span className={cn("relative inline-flex items-center", className)}>
        <select
          ref={ref}
          className={cn(SELECT_BASE, SELECT_SIZE[size])}
          {...rest}
        >
          {children}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-meta text-text-tertiary"
        >
          {ICON.caretDown}
        </span>
      </span>
    );
  },
);
