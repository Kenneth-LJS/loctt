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
 * ## Hit area (WCAG 2.5.8 AA — #15)
 *
 * The *visual* box stays 16px, but the clickable target is **24px**. The
 * enlargement is done by making the real `<input>` itself the 24px target
 * (`absolute inset-0`, transparent) inside a 24px `<span>` wrapper, with a
 * separate 16px painted box drawn as a sibling that mirrors the input's
 * state via `peer-*`. The wrapper is a `<span>`, **not** a `<label>`:
 * many callers already wrap `<Checkbox>` in their own text `<label>`
 * ("Show archived", working-day toggles), and a label here would nest
 * `<label>` elements — invalid HTML that breaks the outer label's
 * text→input association. Keeping the input native preserves Space-to-
 * toggle, `indeterminate`, `name` grouping and form semantics; every call
 * site inherits the 24px target with no change.
 */
export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  readonly indeterminate?: boolean;
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

// The real input is the 24px hit target: absolutely-positioned, filling
// the 24px wrapper, and transparent (`appearance-none opacity-0`). It is a
// `peer` so the painted 16px box (a sibling) can mirror its state.
const INPUT_BASE =
  "peer absolute inset-0 h-full w-full m-0 appearance-none opacity-0 cursor-pointer " +
  "disabled:cursor-not-allowed";

// The visible 16px box, painted from the peer input's state. It carries no
// pointer events (the input above it takes every click across the 24px).
const BOX_BASE =
  "pointer-events-none absolute inset-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 rounded-sm " +
  "border border-border-control bg-bg-surface transition-colors " +
  "peer-hover:bg-bg-muted-hover " +
  "peer-checked:bg-accent peer-checked:border-accent " +
  "peer-disabled:border-border-default peer-disabled:bg-bg-muted " +
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--text-primary)]";

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ indeterminate = false, checked, disabled, className, onClick, ...rest }, ref) {
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
      // #15: a 24px hit target with a 16px painted box. The wrapper is a
      // `<span>` (NOT a `<label>` — callers often wrap this in their own
      // text `<label>`, and nesting labels is invalid). The real input
      // fills the 24px square transparently and takes every click; the
      // visible box and mark are peer-driven siblings centred inside it.
      <span
        data-indeterminate={indeterminate ? "true" : undefined}
        className={cn(
          "group relative inline-block h-6 w-6 shrink-0 align-middle",
          className,
        )}
      >
        <input
          ref={setRefs}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          {...(indeterminate ? { "data-indeterminate": "true" } : {})}
          {...(onClick !== undefined ? { onClick } : {})}
          className={INPUT_BASE}
          {...rest}
        />
        {/* The 16px painted box, mirrored from the peer input. An
            indeterminate input can't be selected via `peer-*`, so the
            accent fill for that state is applied from the wrapper's
            data attr via `group-data-*`. */}
        <span
          aria-hidden="true"
          className={cn(
            BOX_BASE,
            indeterminate && "bg-accent border-accent",
          )}
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
