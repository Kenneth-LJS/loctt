import { forwardRef, type InputHTMLAttributes, useEffect, useRef } from "react";

import { cn } from "./cn.ts";
import { Icon } from "./Icon.tsx";

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
 * rolling that ref. `data-indeterminate` is also set so both the input's
 * own fill and the mark overlay can react to it (CSS cannot select
 * `:indeterminate` reliably across the appearance-none repaint, so both
 * key off the checked prop + this data attr instead).
 *
 * The tick/dash is a `<span>` overlaid on the input, coloured with
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
 * The clickable target and the visible box are **the same element,
 * the same size** — there is no invisible hit area extending past what
 * is drawn. An earlier version of this component tried the opposite: a
 * 16px painted box with a transparent 24px `<input>` overlaid on top of
 * it, so the outer ~4px ring was clickable but unpainted. Ken's call
 * (2026-09-23) on seeing that shape: "sounds like a bad hack. make the
 * checkbox bigger instead?!?!" — and he is right. A hit area that
 * exceeds what the user can see means a click 3-4px outside the visible
 * box still toggles it, which reads as a ghost-click bug, not an
 * accessibility fix. So the fix here is the plain one: the box itself
 * is now drawn bigger.
 *
 * The wrapper and the input are both `h-7 w-7` (see the rem-to-px note
 * below for why `h-7`, not `h-6`, is required). The previously-separate
 * 16px "painted box" sibling is gone; the native `<input>` is painted
 * directly with `appearance-none` at the full size, and the tick/dash
 * overlay centres on it the same way. The wrapper stays a `<span>`, not
 * a `<label>`: callers already wrap `<Checkbox>` in their own text
 * `<label>` (working-day toggles, row selection), and a label here
 * would nest `<label>` elements — invalid HTML that breaks the outer
 * label's text→input association.
 *
 * ## The rem trap (why `h-7`, not `h-6`, and why the docstring used to
 * be wrong)
 *
 * `styles/index.css:142` sets `html { font-size: 87.5% }` against a
 * 16px browser default, so `1rem` here resolves to **14px**, not 16px.
 * Tailwind's `h-6`/`w-6` is `1.5rem`: at this root size that is
 * **21px**, not the 24px this docstring asserted for a long time (three
 * separate spots, corrected here). `h-7`/`w-7` is `1.75rem`, which
 * resolves to **24.5px** — the smallest standard Tailwind step that
 * clears 24px at this root size. There is no exact-24px Tailwind
 * utility here (that would be `1.7143rem`), so 24.5px is the size,
 * not 24px on the nose. This same 0.875× miscount has now bitten this
 * codebase three times (`design-system.md`'s `IconButton` claim, a
 * dialog focus-ring size, and this) — treat any size assertion derived
 * from a Tailwind class name rather than a measurement as suspect.
 */
export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> {
  readonly indeterminate?: boolean;
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

// The input IS the visible box now — one element, painted directly, filling
// its wrapper (`h-full w-full`). No transparent overlay, no separate
// painted sibling: the clickable area and the drawn box are identical.
const INPUT_BASE =
  "relative m-0 h-full w-full appearance-none rounded-sm cursor-pointer " +
  "border border-border-control bg-bg-surface transition-colors " +
  // Hover is split by state. A bare `hover:bg-bg-muted-hover` beside
  // `checked:bg-accent` is two same-specificity utilities, and the one
  // Tailwind emits later wins — it was hover, so a CHECKED box went grey
  // under the pointer while its tick stayed accent-contrast: a washed-out
  // ghost tick (Ken: "the checkbox on hover looks terrible"). Unchecked
  // boxes take the grey wash; filled ones darken like a primary button.
  "enabled:[&:not(:checked):not([data-indeterminate])]:hover:bg-bg-muted-hover " +
  "checked:bg-accent checked:border-accent " +
  "enabled:checked:hover:bg-accent-hover enabled:checked:hover:border-accent-hover " +
  "data-[indeterminate]:bg-accent data-[indeterminate]:border-accent " +
  "enabled:data-[indeterminate]:hover:bg-accent-hover enabled:data-[indeterminate]:hover:border-accent-hover " +
  "disabled:cursor-not-allowed disabled:border-border-default disabled:bg-bg-muted " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]";

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
      // #15: the visible box IS the 24.5px target — see the docstring for
      // why 24.5px, not 24px, and why this replaced the transparent-
      // overlay approach. The wrapper is a `<span>` (NOT a `<label>` —
      // callers often wrap this in their own text `<label>`, and nesting
      // labels is invalid).
      <span
        className={cn(
          "relative inline-block h-7 w-7 shrink-0 align-middle",
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
          // `:indeterminate` cannot be targeted reliably across the
          // appearance-none repaint, so that state's fill keys off the
          // `data-indeterminate` attribute (in INPUT_BASE) instead.
          className={INPUT_BASE}
          {...rest}
        />
        {showMark ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 grid place-items-center",
              "text-accent-contrast",
              disabled === true && "opacity-60",
            )}
          >
            {/* Drawn, not typed (A208): the old `"✓"`/`"–"` literals
                slipped past the glyph lint rule, which bans `✓` only as
                bare JSX text. */}
            <Icon name={indeterminate ? "minus" : "check"} size={14} />
          </span>
        ) : null}
      </span>
    );
  },
);
