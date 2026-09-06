import { forwardRef, type InputHTMLAttributes, useEffect, useRef } from "react";

import { cn } from "./cn.ts";

/**
 * A themed checkbox that keeps the **real native `<input type="checkbox">`**
 * and paints it with `appearance-none`. This is deliberate (Ken flagged
 * "native checkboxes look bad", but a `<div role="checkbox">` would drop
 * Space-to-toggle, `indeterminate`, `name` grouping and form semantics):
 * the input stays native, only its look changes, so every behaviour case
 * (BLK-1..4, A11Y-21, LST-10) is preserved for free.
 *
 * `indeterminate` is a first-class prop — the ListView "select all"
 * header needs it (BLK-3) and it is a DOM *property*, not an attribute,
 * so it is applied to the node via a ref effect. Callers stop hand-
 * rolling that ref. `data-indeterminate` is also set so the visual mark
 * can react to it (CSS cannot select `:indeterminate` and paint a
 * sibling reliably across the appearance-none repaint, so the mark keys
 * off the checked prop + this data attr).
 *
 * The tick/dash is a sibling `<span>` overlaid on the box, coloured with
 * `text-accent-contrast` so it reads on the accent fill in both themes,
 * shown only when checked or indeterminate. Using a real element rather
 * than a background-image data-URI keeps the mark theme-aware (a baked
 * SVG stroke colour could not follow `--accent-contrast`).
 *
 * This is the ONE control that re-declares a focus ring: `appearance-none`
 * removes the UA outline the global `:focus-visible` rule relied on, so
 * it reattaches `focus-visible:outline-*` in `--text-primary`.
 *
 * `data-testid` passes through to the `<input>` (mandatory — the form
 * suite selects the inputs by testid).
 */
export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  readonly indeterminate?: boolean;
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

const BOX_BASE =
  "peer appearance-none shrink-0 h-4 w-4 rounded-sm border border-border-strong " +
  "bg-bg-surface cursor-pointer transition-colors " +
  "hover:bg-bg-muted-hover " +
  "checked:bg-accent checked:border-accent checked:hover:bg-accent " +
  "disabled:cursor-not-allowed disabled:border-border-default disabled:bg-bg-muted disabled:hover:bg-bg-muted " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]";

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ indeterminate = false, checked, disabled, className, ...rest }, ref) {
    const innerRef = useRef<HTMLInputElement | null>(null);

    // `indeterminate` is a property, not an attribute — set it on the DOM
    // node. Re-run when either flips so a header that goes partial→all
    // updates its look.
    useEffect(() => {
      const node = innerRef.current;
      if (node !== null) node.indeterminate = indeterminate;
    }, [indeterminate, checked]);

    const setRefs = (node: HTMLInputElement | null): void => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref !== null) ref.current = node;
    };

    // The mark shows for checked OR indeterminate; indeterminate wins the
    // glyph (a dash, not a tick).
    const showMark = indeterminate || checked === true;

    return (
      <span className={cn("relative inline-flex", className)}>
        <input
          ref={setRefs}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          {...(indeterminate ? { "data-indeterminate": "true" } : {})}
          className={BOX_BASE}
          {...rest}
        />
        {showMark ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 grid place-items-center",
              "text-meta font-bold leading-none text-accent-contrast",
              disabled === true && "opacity-60",
            )}
          >
            {indeterminate ? "–" : "✓"}
          </span>
        ) : null}
      </span>
    );
  },
);
