import { type ButtonHTMLAttributes, forwardRef } from "react";

import { cn } from "./cn.ts";

/**
 * The one button. Resolves the ~25 hand-rolled spellings the
 * consistency review found, bakes in `--accent-contrast` (killing the
 * `text-white` defect §3a), and gives every button the
 * hover/active/focus/disabled states that were missing.
 *
 * Renders a real `<button type="button">` — never an accidental submit;
 * a caller that wants submit passes `type="submit"`. Forwards `ref`
 * (menus/focus management need it).
 *
 * `className` is allowed as a **narrow escape hatch**, merged AFTER the
 * variant classes via `cn` (spec §1.1 open decision #6). The default is
 * to allow it: banning it outright pushes one-off needs (a `w-full` at a
 * single call site, a `mt-2`) back into forking the whole element, which
 * is worse drift than a merged utility. It is documented as "layout/
 * spacing overrides only — do not re-spell colour or state here"; the
 * B4 migration and the CI guardrail (spec §2.5) keep it honest. Prefer
 * `fullWidth`/a new variant over reaching for it.
 *
 * `testId` is a **declared** prop applied to the inner `<button>`, not
 * spread — same reasoning as `MenuItem`: a caller writing `data-testid=`
 * on a component that renders its own element type-checks and then never
 * reaches the DOM. Integration/e2e/vitest all select by it, so this is
 * load-bearing.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  /** Escape hatch: layout/spacing overrides only, merged after variants. */
  readonly className?: string;
  /** `data-testid` on the rendered `<button>` (declared, not spread). */
  readonly testId?: string;
}

/** One height per size — the thing that makes buttons align in a row. */
export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-label gap-1",
  md: "h-8 px-3 text-body gap-1.5",
};

/**
 * The variant → token map. Shared with `IconButton` so a ghost icon
 * button and a ghost text button hover identically. `text-accent-contrast`
 * (never `text-white`) on both filled variants — `--accent-contrast` is
 * white in light and near-black in dark, so it stays legible on the
 * accent/danger fill in both themes (6.29:1 / 6.60:1 on accent, 5.53:1 /
 * 8.56:1 on danger — all AA).
 */
export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-hover",
  secondary:
    "border border-border-default bg-bg-surface text-text-secondary hover:bg-bg-muted hover:text-text-primary active:bg-bg-muted-hover",
  ghost:
    "text-text-secondary hover:bg-bg-muted hover:text-text-primary active:bg-bg-muted-hover",
  danger:
    "bg-danger-fg text-accent-contrast hover:opacity-90 active:opacity-90",
};

/**
 * Base classes for every button-shaped control. `cursor-pointer` is here
 * (K-16): a native `<button>` has no pointer cursor and only a handful of
 * sites set it today; baking it into the base is the component-level fix.
 * `disabled:cursor-not-allowed` still wins for the disabled case. Radius
 * is always `rounded-md` (§2.3, bans bare `rounded`). The global
 * `:focus-visible` ring is relied on — no `focus:` classes here.
 */
export const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      fullWidth = false,
      className,
      testId,
      type,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        // Default to "button" so a button in a <form> never submits by
        // accident; an explicit type from the caller wins.
        type={type ?? "button"}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
        className={cn(
          BUTTON_BASE,
          BUTTON_SIZE[size],
          BUTTON_VARIANT[variant],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
