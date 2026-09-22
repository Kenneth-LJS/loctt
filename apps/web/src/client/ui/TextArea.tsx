import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "./cn.ts";

/**
 * One multi-line text-input shape — the `<textarea>` twin of
 * {@link TextField}. Standardises the hand-rolled textareas (sprint goal
 * in two places, and any other) onto the same border/focus/invalid tokens
 * so a multi-line field focuses (the global `:focus-visible` ring) and
 * flags invalid (`aria-invalid` + danger border) exactly like every input,
 * rather than each site re-spelling `rounded border-border-subtle` with no
 * focus ring (the native-component audit's textarea drift).
 *
 * `invalid` wires `aria-invalid` and the danger border together so a caller
 * cannot set one without the other. `data-testid` and `ref` pass through to
 * the `<textarea>`. Deliberately NOT built over TextField: a textarea is a
 * different element with its own rows/resize behaviour; it shares the token
 * strings, not the component.
 */
export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  readonly invalid?: boolean;
  /** Whether the field fills its container. Defaults to `true`. */
  readonly fullWidth?: boolean;
  /** Escape hatch: layout only (e.g. `min-h`, `resize-none`). */
  readonly className?: string;
}

// Mirrors TextField's FIELD_BASE (md size), with the vertical padding a
// multi-line field wants. Kept in sync with TextField by copying its token
// string deliberately — the two primitives share the look, not the code.
const TEXTAREA_BASE =
  "rounded-md border border-border-default bg-bg-surface " +
  "px-2.5 py-1.5 text-body text-text-primary placeholder:text-text-tertiary transition-colors " +
  "disabled:bg-bg-muted disabled:text-text-disabled " +
  "aria-invalid:border-danger-fg";

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ invalid = false, fullWidth = true, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        {...(invalid ? { "aria-invalid": true } : {})}
        className={cn(TEXTAREA_BASE, fullWidth && "w-full", className)}
        {...rest}
      />
    );
  },
);
