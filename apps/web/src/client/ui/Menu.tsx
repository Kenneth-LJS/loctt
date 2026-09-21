import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { panelStyle, usePortalPlacement } from "./usePortalPlacement.ts";

/**
 * A minimal popover menu: a trigger button and a floating panel that
 * opens below it. Closes on outside-click, Escape, or selecting an
 * item. Used by the header's user menu in M1.1 and by the filter and
 * bulk dropdowns in later list-view tickets.
 *
 * The panel renders into `document.body` via `createPortal` and is
 * positioned with runtime-measured coordinates — see
 * `usePortalPlacement.ts` for why (MENU-PORTAL). K106 stage 2 moved that
 * machinery into the shared hook so `ui/Dropdown` sits on the same
 * substrate; the behaviour here is unchanged.
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

export function Menu({
  trigger,
  children,
  align = "start",
  panelClassName,
  "aria-label": ariaLabel,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const pos = usePortalPlacement(open, wrapRef, panelRef, align);

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
              style={panelStyle(pos)}
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
