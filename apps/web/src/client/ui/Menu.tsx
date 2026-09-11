import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/**
 * A minimal popover menu: a trigger button and a floating panel that
 * opens below it. Closes on outside-click, Escape, or selecting an
 * item. Used by the header's user menu in M1.1 and by the filter and
 * bulk dropdowns in later list-view tickets.
 *
 * The panel is positioned with CSS (absolute, anchored to the
 * trigger's wrapper) rather than measured-at-runtime like the mockup's
 * vanilla JS — React owns layout here, and an anchored panel avoids
 * the scroll/resize recomputation the mockup needed.
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

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
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
  // text starts with it. Operates on `[role="menuitem"]` in the panel, so
  // panels that render non-menuitem content (a filter checkbox list) are
  // unaffected and keep their own model.
  const menuItems = (): HTMLElement[] =>
    panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
      : [];

  useEffect(() => {
    if (!open) return;
    // Defer to after the panel paints its children.
    const id = requestAnimationFrame(() => { menuItems()[0]?.focus(); });
    return () => { cancelAnimationFrame(id); };
  }, [open]);

  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
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
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : triggerId}
          onKeyDown={onPanelKeyDown}
          className={[
            "absolute top-full z-20 mt-1 min-w-[200px] rounded-lg border border-border-default",
            "bg-bg-surface-raised p-1 shadow-overlay",
            align === "end" ? "right-0" : "left-0",
            panelClassName ?? "",
          ].join(" ")}
        >
          {children({ close })}
        </div>
      ) : null}
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
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px]",
        "text-text-secondary hover:bg-bg-muted hover:text-text-primary",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
