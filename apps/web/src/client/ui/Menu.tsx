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
          role="menu"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : triggerId}
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
