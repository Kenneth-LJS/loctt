import { forwardRef,type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * One text-input shape. Standardises the ~9 spellings and promotes the
 * good search-input focus treatment into the default so all inputs focus
 * alike (via the global `:focus-visible` ring).
 *
 * `invalid` wires `aria-invalid` and a danger border together, so a
 * caller cannot set one without the other. `leadingIcon` is the search-
 * box glyph slot (Sidebar/Header/FilterDropdown search boxes); when set,
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
  /** Escape hatch on the wrapper (with leadingIcon) or the input: layout only. */
  readonly className?: string;
}

const FIELD_SIZE: Record<TextFieldSize, string> = {
  sm: "h-7 py-1 text-label",
  md: "py-1.5 text-body",
};

const FIELD_BASE =
  "w-full rounded-md border border-border-default bg-bg-surface " +
  "px-2.5 text-text-primary placeholder:text-text-tertiary transition-colors " +
  "disabled:bg-bg-muted disabled:text-text-disabled " +
  "aria-invalid:border-danger-fg";

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { invalid = false, leadingIcon, size = "md", className, ...rest },
    ref,
  ) {
    const input = (
      <input
        ref={ref}
        {...(invalid ? { "aria-invalid": true } : {})}
        className={cn(
          FIELD_BASE,
          FIELD_SIZE[size],
          leadingIcon !== undefined && leadingIcon !== null && "pl-7",
          leadingIcon === undefined || leadingIcon === null ? className : undefined,
        )}
        {...rest}
      />
    );

    if (leadingIcon === undefined || leadingIcon === null) return input;

    return (
      <span className={cn("relative inline-flex w-full items-center", className)}>
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
