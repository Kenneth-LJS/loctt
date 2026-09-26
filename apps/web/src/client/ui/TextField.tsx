import { forwardRef,type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * One text-input shape. Standardises the ~9 spellings and promotes the
 * good search-input focus treatment into the default so all inputs focus
 * alike (via the global `:focus-visible` ring).
 *
 * `invalid` wires `aria-invalid` and a danger border together, so a
 * caller cannot set one without the other. `leadingIcon` is the search-
 * box glyph slot (Sidebar/Header/FilterFacet search boxes); when set,
 * the input is wrapped `relative` and padded left for the icon.
 *
 * The placeholder uses `text-text-tertiary`, which now clears AA after
 * the §2.4 token fix — no per-field change needed.
 *
 * `data-testid` and `ref` pass through to the `<input>`.
 */
export type TextFieldSize = "sm" | "md";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> {
  readonly invalid?: boolean;
  readonly leadingIcon?: ReactNode;
  readonly size?: TextFieldSize;
  /**
   * Whether the field fills its container. Defaults to `true` (the
   * historical behaviour — every existing call site expects `w-full`).
   * Set `false` for a fixed-width input (query-builder value inputs, the
   * `w-32` estimate field): `w-full` is dropped so the caller's own width
   * class in `className` (or the input's intrinsic `size`) applies. This
   * is needed because `cn` is a plain join, not `tailwind-merge`, so a
   * `className="w-32"` cannot otherwise override the baked-in `w-full`.
   */
  readonly fullWidth?: boolean;
  /** Escape hatch on the wrapper (with leadingIcon) or the input: layout only. */
  readonly className?: string;
}

const FIELD_SIZE: Record<TextFieldSize, string> = {
  sm: "h-7 py-1 text-label",
  md: "py-1.5 text-body",
};

const FIELD_BASE =
  "rounded-md border border-border-default bg-bg-surface " +
  "px-2.5 text-text-primary placeholder:text-text-tertiary transition-colors " +
  "disabled:bg-bg-muted disabled:text-text-disabled " +
  "aria-invalid:border-danger-fg";

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { invalid = false, leadingIcon, size = "md", fullWidth = true, className, ...rest },
    ref,
  ) {
    const hasIcon = leadingIcon !== undefined && leadingIcon !== null;
    const input = (
      <input
        ref={ref}
        {...(invalid ? { "aria-invalid": true } : {})}
        className={cn(
          FIELD_BASE,
          FIELD_SIZE[size],
          // When wrapped for an icon, the wrapper owns the width; the
          // input always fills the wrapper. Standalone, the input carries
          // w-full itself (unless the caller opted out).
          (hasIcon || fullWidth) && "w-full",
          hasIcon && "pl-7",
          hasIcon ? undefined : className,
        )}
        {...rest}
      />
    );

    if (!hasIcon) return input;

    return (
      <span
        className={cn(
          "relative inline-flex items-center",
          fullWidth && "w-full",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-meta text-text-tertiary"
        >
          {leadingIcon}
        </span>
        {input}
      </span>
    );
  },
);
