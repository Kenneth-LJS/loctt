import { type ReactNode, useEffect, useRef } from "react";

import { Icon } from "./Icon.tsx";
import { useInertBackground } from "./Modal.tsx";
import { useFocusTrap } from "./useFocusTrap.ts";

/**
 * A mobile drawer/sheet — the one overlay primitive the responsive plan
 * (GROUP B) sanctions beyond the existing Modal. Two variants:
 *
 *  - `bottom` (default): a bottom sheet for a cluster of controls edited
 *    occasionally on a phone — the list filter facets. Full width, pinned
 *    to the bottom, rounded top, capped at ~85vh, with an optional sticky
 *    footer (Clear all / Done).
 *  - `full`: a full-screen editor sheet for a single complex surface on a
 *    phone — the Advanced query editor. inset-0 with its own header.
 *
 * Reuses Modal's a11y machinery exactly: `useFocusTrap` (trap + return
 * focus, A11Y-14/15) and `useInertBackground` (background inert to AT).
 * Closes on Escape or a backdrop click, `role="dialog" aria-modal`.
 *
 * This is a presentation shell only — it forks no state. Callers put the
 * SAME controls inside it that they render inline at desktop width, so a
 * filter changed in the sheet writes the same URL search params.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  variant = "bottom",
  testId,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Sticky footer (e.g. Clear all / Done). Omitted → no footer bar. */
  readonly footer?: ReactNode;
  readonly variant?: "bottom" | "full";
  readonly testId?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useInertBackground(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isFull = variant === "full";

  return (
    <div
      className={[
        "fixed inset-0 z-50 bg-black/30",
        isFull ? "" : "flex flex-col justify-end",
      ].join(" ")}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
        className={[
          "flex flex-col bg-bg-surface-raised shadow-overlay",
          isFull
            ? "absolute inset-0"
            : "max-h-[85vh] rounded-t-2xl border-t border-border-default",
        ].join(" ")}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-[1.0714rem] font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            data-testid={testId !== undefined ? `${testId}-close` : undefined}
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-bg-muted"
          >
            <Icon name="close" />
          </button>
        </div>

        {/*
          `p-4` is load-bearing on all FOUR sides, not just inset styling.

          `overflow-y-auto` clips on every edge (it clips horizontally too,
          which is why `Modal` carries the `-mx-4 px-4` pair), and the
          global focus ring — `outline: 2px` at `outline-offset: 2px`,
          styles/index.css — needs 4px outside a control's border box. A
          focusable control at any edge of this body would have its ring
          sliced flat without clearance here. That is UI-11, which `Modal`
          shipped on its vertical axis.

          This padding sits INSIDE the scroller, which is what makes it
          survive scrolling: `scrollHeight` includes both paddings, so the
          clearance is still present when the body is scrolled to either
          end. Measured in-browser on the list-filter sheet — with the body
          overflowing and scrolled fully to the bottom, the last control
          kept 14.1px.

          So: do not narrow this to `px-4`, and do not move it to the
          panel outside the scroller. Either change re-opens UI-11 here.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {children}
        </div>

        {footer !== undefined && (
          <div className="shrink-0 border-t border-border-subtle p-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
