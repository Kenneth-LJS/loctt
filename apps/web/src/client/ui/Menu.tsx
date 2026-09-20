import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * A minimal popover menu: a trigger button and a floating panel that
 * opens below it. Closes on outside-click, Escape, or selecting an
 * item. Used by the header's user menu in M1.1 and by the filter and
 * bulk dropdowns in later list-view tickets.
 *
 * ## Why the panel is portalled and measured
 *
 * The panel renders into `document.body` via `createPortal` and is
 * positioned with runtime-measured coordinates (`position: fixed`,
 * viewport-relative from `getBoundingClientRect`), not with CSS anchor
 * classes on an inline `absolute` child.
 *
 * A CSS-anchored inline panel had two defects (MENU-PORTAL):
 *   1. It was clipped by any ancestor with `overflow` — the sidebar's
 *      scroll container (`overflow-y-auto`) sliced the saved-filter row
 *      kebab menu, so "Edit…", "Pin to top", "Delete…" were unreadable.
 *   2. A CSS-only anchor cannot flip or clamp to the viewport, so an
 *      `align="end"` panel next to a kebab near the sidebar's right edge
 *      ran off the *left* of the viewport.
 *
 * Measuring after first paint (the same technique the label-overflow
 * popover uses in `list/cells.tsx`) is the only way to know the real
 * panel size and clamp it inside the viewport. The panel is rendered
 * off-screen for one frame so it can be measured without flashing in
 * the wrong place.
 */

export interface MenuProps {
  /** Renders the trigger. `open` lets it reflect pressed state. */
  readonly trigger: (props: {
    open: boolean;
    toggle: () => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    id: string;
  }) => ReactNode;
  readonly children: (props: { close: () => void }) => ReactNode;
  /** Panel alignment relative to the trigger. Defaults to "start". */
  readonly align?: "start" | "end";
  readonly panelClassName?: string;
  readonly "aria-label"?: string;
}

/** Gutter kept between the panel and the viewport edge, in px. */
const VIEWPORT_MARGIN = 8;
/** Gap between the trigger and the panel, in px. */
const TRIGGER_GAP = 4;

export function Menu({
  trigger,
  children,
  align = "start",
  panelClassName,
  "aria-label": ariaLabel,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      // The panel is portalled to `document.body`, so it is no longer a
      // descendant of `wrapRef`. Outside-click therefore has to treat a
      // click inside *either* the trigger wrapper or the portalled panel
      // as "inside" — otherwise every click on a menu item would close
      // the menu before the item's own handler runs.
      if (wrapRef.current?.contains(target) === true) return;
      if (panelRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Close only this layer. A menu can be opened from inside a modal
      // (the panel is a sibling of the modal in the body, both listen on
      // document keydown); swallowing the event here stops the same
      // Escape from also closing the modal behind the menu.
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Measure and place the panel after it paints. Anchors below the
  // trigger, flips above when there is no room below, honors `align`
  // (start → panel left to trigger left, end → panel right to trigger
  // right), then clamps horizontally so the panel never crosses a
  // viewport edge. The horizontal clamp is what fixes the sidebar
  // kebab: `align="end"` next to a near-right-edge trigger would place
  // the panel off the left of the viewport, and the clamp pulls it
  // back in.
  const place = (): void => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (wrap === undefined || panel === undefined) return;

    let left =
      align === "end" ? wrap.right - panel.width : wrap.left;
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - panel.width;
    // Clamp within [margin, maxLeft]. `Math.min` first, then a
    // `Math.max` floor, so a panel wider than the viewport still starts
    // at the left gutter rather than off-screen.
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft));

    let top = wrap.bottom + TRIGGER_GAP;
    if (top + panel.height > window.innerHeight - VIEWPORT_MARGIN) {
      const above = wrap.top - TRIGGER_GAP - panel.height;
      top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, top);
    }
    setPos({ left, top });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    place();
    // Keep the panel anchored as ancestors scroll or the window
    // resizes. `capture: true` on scroll so a scrolling *ancestor*
    // (which does not bubble its scroll event) is still heard — the
    // sidebar's own scroll container is exactly this case.
    const onReflow = (): void => { place(); };
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
    // `place` closes over `align` and the refs; `open` is the only
    // dependency that should re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A11Y-9/§A2: a `role="menu"` promises roving arrow-key navigation, not
  // just Tab. On open, move focus to the first item; ArrowDown/Up cycle,
  // Home/End jump, and a printable key type-aheads to the next item whose
  // text starts with it. Operates on the menu's *item* roles —
  // `menuitem` and the checkable variants `menuitemcheckbox`/
  // `menuitemradio` — so a multi-select panel (the filter dropdowns,
  // A11Y-10) is arrow-navigable too, not only Tab-reachable. Panels that
  // render no item role at all (free-form content) are still unaffected
  // and keep their own model.
  const menuItems = (): HTMLElement[] =>
    panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled]),[role="menuitemradio"]:not([disabled])',
        ))
      : [];

  useEffect(() => {
    if (!open) return;
    // Defer to after the panel paints its children.
    const id = requestAnimationFrame(() => { menuItems()[0]?.focus(); });
    return () => { cancelAnimationFrame(id); };
  }, [open]);

  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // A searchable panel (the filter dropdowns, A11Y-10) renders a text
    // input above its items. While focus is in that input the arrow keys
    // and every printable key belong to it — typing "d" must filter, not
    // roving-focus an item, and the caret must move on ArrowLeft/Right.
    // So the menu's key model stands down whenever the event originates
    // in an input/textarea/textbox.
    const target = e.target as HTMLElement;
    const inTextEntry =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;
    if (inTextEntry) return;
    const items = menuItems();
    if (items.length === 0) return;
    const current = items.findIndex(el => el === document.activeElement);
    const focusAt = (i: number): void => {
      e.preventDefault();
      const n = items.length;
      items[((i % n) + n) % n]?.focus();
    };
    switch (e.key) {
      case "ArrowDown": focusAt(current + 1); return;
      case "ArrowUp": focusAt(current === -1 ? items.length - 1 : current - 1); return;
      case "Home": focusAt(0); return;
      case "End": focusAt(items.length - 1); return;
      default: break;
    }
    // Type-ahead: a single printable character jumps to the next item
    // whose visible text starts with the typed run.
    if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      const ta = typeahead.current;
      ta.buffer = now - ta.at > 700 ? e.key : ta.buffer + e.key;
      ta.at = now;
      const q = ta.buffer.toLowerCase();
      const start = current + 1;
      const match = items
        .map((el, i) => ({ el, i }))
        .sort((a, b) => ((a.i + items.length - start) % items.length) - ((b.i + items.length - start) % items.length))
        .find(({ el }) => (el.textContent ?? "").trim().toLowerCase().startsWith(q));
      if (match) { e.preventDefault(); match.el.focus(); }
    }
  };

  const close = (): void => setOpen(false);
  const toggle = (): void => setOpen(o => !o);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      {trigger({
        open,
        toggle,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        id: triggerId,
      })}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabel ? undefined : triggerId}
              onKeyDown={onPanelKeyDown}
              className={[
                // `z-[65]` sits above the modal layers (Modal `z-50`,
                // CreateTaskModal `z-[55]`) so a menu opened from inside
                // a dialog shows above it, and under the shortcut-help
                // dialog (`z-[70]`), which hosts no menus.
                "fixed z-[65] min-w-[200px] rounded-lg border border-border-default",
                "bg-bg-surface-raised p-1 shadow-overlay",
                panelClassName ?? "",
              ].join(" ")}
              style={
                // Off-screen for the first paint so it can be measured
                // without flashing in the wrong place; once `place` has
                // run, `pos` holds the real coordinates.
                pos === null
                  ? { left: 0, top: 0, visibility: "hidden" }
                  : { left: pos.left, top: pos.top }
              }
            >
              {children({ close })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** A single clickable row inside a Menu panel. */
export function MenuItem({
  children,
  onSelect,
  className,
  testId,
}: {
  readonly children: ReactNode;
  readonly onSelect?: () => void;
  readonly className?: string;
  /**
   * Optional `data-testid` on the rendered button.
   *
   * Declared rather than spread: a caller writing `data-testid=…`
   * directly type-checks (JSX allows any dashed attribute) and then
   * silently never reaches the DOM, because this component renders its
   * own `<button>` and forwards nothing.
   */
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      className={[
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem]",
        "text-text-secondary hover:bg-bg-muted hover:text-text-primary",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
