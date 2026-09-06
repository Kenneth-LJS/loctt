import { type ButtonHTMLAttributes, forwardRef } from "react";

import { BUTTON_VARIANT } from "./Button.tsx";
import { cn } from "./cn.ts";

/**
 * A square, icon-only button. A sibling of `Button`, not a prop on it,
 * because it is square, centres a single glyph, and **requires** an
 * `aria-label` (the icon has no text). Making the label a required prop
 * is the fix for silent unlabelled icon buttons.
 *
 * Kills the `h-8 w-8 rounded-md` vs `h-7 w-7 rounded` split (§1c). Reuses
 * `Button`'s VARIANT token map so hover/active match text buttons.
 * `cursor-pointer` in the base (K-16). Relies on the global focus ring.
 *
 * `className` escape hatch and `testId` behave exactly as in `Button`.
 */
export type IconButtonVariant = "ghost" | "secondary" | "danger";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** REQUIRED — the icon carries no accessible name on its own. */
  readonly "aria-label": string;
  readonly variant?: IconButtonVariant;
  readonly size?: IconButtonSize;
  /** Escape hatch: layout/spacing overrides only, merged after variants. */
  readonly className?: string;
  /** `data-testid` on the rendered `<button>` (declared, not spread). */
  readonly testId?: string;
}

const ICON_BUTTON_SIZE: Record<IconButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
};

const ICON_BUTTON_BASE =
  "grid place-items-center rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = "ghost", size = "md", className, testId, type, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
        className={cn(
          ICON_BUTTON_BASE,
          ICON_BUTTON_SIZE[size],
          BUTTON_VARIANT[variant],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
