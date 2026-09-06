import { forwardRef,type InputHTMLAttributes } from "react";

import { cn } from "./cn.ts";

/**
 * A themed radio — same approach as `Checkbox`: a real native
 * `<input type="radio">` painted with `appearance-none`, so keyboard
 * arrow-group navigation, `name` grouping (all 7 radios rely on it), and
 * form semantics are preserved. `name` stays a real forwarded attribute.
 *
 * The inner dot is drawn with a thick accent border when checked
 * (`checked:border-[5px] checked:border-accent`) on the round box —
 * no sibling element needed. Re-declares the focus ring for the same
 * `appearance-none` reason as Checkbox.
 *
 * `data-testid` passes through to the `<input>`.
 */
export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

const RADIO_BASE =
  "appearance-none shrink-0 h-4 w-4 rounded-full border border-border-strong " +
  "bg-bg-surface cursor-pointer transition-colors " +
  "hover:bg-bg-muted-hover " +
  "checked:border-[5px] checked:border-accent checked:bg-bg-surface checked:hover:bg-bg-surface " +
  "disabled:cursor-not-allowed disabled:border-border-default disabled:bg-bg-muted disabled:hover:bg-bg-muted " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]";

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  function Radio({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="radio"
        className={cn(RADIO_BASE, className)}
        {...rest}
      />
    );
  },
);
