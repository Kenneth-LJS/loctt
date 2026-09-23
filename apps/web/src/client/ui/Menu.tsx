import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "./Icon.tsx";
import { SrOnly } from "./Tooltip.tsx";
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
 *
 * ## Focus restore on close
 *
 * Escape and outside-click return focus to whatever triggered the menu
 * (the known-gaps "`ui/Menu` never restores focus" entry) — otherwise a
 * keyboard user is dumped on `document.body` and has to Tab from the top
 * of the page. Selecting an item does NOT restore focus: `close()`,
 * called by `MenuItem`/consumers on selection, is a plain `setOpen(false)`
 * with no restore. An item's action is often a navigation (a `Link`) or a
 * focus move the item itself owns (opening a dialog); forcing focus back
 * onto a trigger that may no longer even be on screen would fight
 * whatever the selection just did. Escape and outside-click have no such
 * competing claim, so they are the two paths that restore.
 *
 * The trigger is captured via `document.activeElement` at open time, not
 * looked up again at close time, because it can be gone by then — A11Y-15:
 * a row's ⋯ trigger unmounts with its row after a delete. Restoring
 * re-checks `isConnected` and no-ops otherwise, the same guard
 * `useFocusTrap` uses for the identical problem (see its `returnFocusTo`
 * doc). `Menu` does not use `useFocusTrap` itself — a menu panel is not a
 * focus trap (Tab is free to leave it) — so this restore logic is
 * separate, deliberately small, and does not touch the dialog gap
 * (`ViewFormDialog`/`LabelEditDialog` not passing `returnFocusTo`), which
 * is tracked and fixed independently.
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

  // A11Y: focus restore on close (the Menu-specific gap — see
  // docs/dev/known-gaps.md "`ui/Menu` never restores focus on close").
  // Recorded on open, not read lazily on close, because by close time the
  // trigger may have already been replaced by a different element (a
  // toggle button whose label/state changed) or removed outright (A11Y-15:
  // a row's ⋯ trigger unmounts with its row on delete). Capturing the
  // exact node up front and re-checking `isConnected` at restore time is
  // the same pattern `useFocusTrap` uses for the identical problem.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // The trigger is whatever currently owns focus when the panel opens —
    // true whether it was opened by a click or by keyboard activation.
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  const restoreFocus = (): void => {
    const el = triggerRef.current;
    // `isConnected` guards the A11Y-15 case: the trigger's row (and the
    // trigger with it) was removed by the very action the menu just took.
    // Focusing a detached node is a no-op that silently leaves focus on
    // `document.body` — exactly the failure being fixed — so skip it
    // rather than throw or restore to nowhere.
    if (el !== null && el.isConnected) el.focus();
  };

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
      // Outside click: nothing else is claiming focus, so return it to
      // the trigger rather than leaving it on whatever was clicked (or
      // on `body`, if the click landed somewhere inert).
      restoreFocus();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Close only this layer. A menu can be opened from inside a modal
      // (the panel is a sibling of the modal in the body, both listen on
      // document keydown); swallowing the event here stops the same
      // Escape from also closing the modal behind the menu.
      e.stopPropagation();
      setOpen(false);
      restoreFocus();
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
              // The same marker `Dropdown`'s panel carries: portalled, it
              // is not a DOM descendant of whatever opened it, so an
              // owner that uses containment to mean "focus is still
              // mine" (the editors' leave-on-blur) needs this to see a
              // move into its own menu as staying. Missing here, picking
              // Bold from the editor toolbar's folded Text style menu
              // took the description out of edit mode (UI-23d).
              data-portal-panel=""
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

/**
 * A single clickable row inside a Menu panel.
 *
 * ## `disabled` is a real `disabled`, not a dimmed no-op (A11Y-31)
 *
 * An unavailable action used to be expressed by dropping `onSelect` and
 * adding `opacity-50`. That is the exact failure A11Y-31's third bullet
 * names: the control is inert but *announces as actionable* — no
 * `disabled` property, no `aria-disabled`, still focusable, so a screen
 * reader user activates it and nothing happens.
 *
 * So it carries the native attribute, which gives all three properties
 * at once: the `disabled` IDL property, the implicit `aria-disabled`,
 * and removal from the tab/focus order. The roving-focus query in `Menu`
 * above already excludes `:not([disabled])`, so a disabled item also
 * drops out of arrow-key travel without any further wiring.
 *
 * ## The reason is an explicit description, not a `title` (UI-23e)
 *
 * The `title` prop still names the reason, but it is now wired as
 * `aria-describedby` pointing at a sibling `sr-only` node rather than a
 * `title` attribute on the button.
 *
 * It used to rely on the browser fallback: `title` on a button is
 * exposed as the accessible *description* "when no other description
 * source exists". That fallback is real but it is a fallback — it is
 * also a ~1s pointer tooltip, it is not keyboard-reachable, and it
 * evaporates the moment any other description source appears. Naming
 * the description outright supersedes it cleanly and keeps A11Y-31's
 * second bullet satisfied by construction instead of by browser
 * goodwill.
 *
 * What did NOT change, and must not: this is a *description*, not the
 * name. Moving the reason to `aria-label` would make a disabled Delete
 * announce "A tracker must have at least one project" INSTEAD of
 * "Delete", losing the name. Nor is this a `Tooltip`: a description has
 * to reach a screen reader with no pointer anywhere near the control.
 *
 * `Dropdown`'s disabled option carries the same migration.
 */
export function MenuItem({
  children,
  onSelect,
  className,
  testId,
  disabled = false,
  danger = false,
  title,
  checked,
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
  /** Inert and announced as such. See the note above. */
  readonly disabled?: boolean | undefined;
  /**
   * Marks a destructive action (delete, archive) so it does not read as
   * a peer of Edit or Rename.
   *
   * A REAL PROP, not a `className` a caller appends. `className` is
   * concatenated after the base classes, and `cn()`/string-join does
   * NOT resolve Tailwind conflicts — so a caller passing
   * `text-danger-fg` lost to the hardcoded `text-text-secondary` below
   * and rendered plain grey. Measured 2026-09-22: every "Delete" row in
   * the settings panels carried `text-danger-fg` (twice, even) and
   * computed to `rgb(168,168,174)` — the exact grey of "Edit" beside
   * it. Six destructive actions looked benign for as long as that
   * pattern stood.
   */
  readonly danger?: boolean | undefined;
  /**
   * Why the item is unavailable, on the button so it is the accessible
   * description and not merely a hover tooltip on a child span.
   */
  readonly title?: string | undefined;
  /**
   * Makes the row a toggle: `menuitemcheckbox` with `aria-checked`, and a
   * drawn check when on. Omitted, the row is a plain `menuitem` — an
   * action has no on/off state to announce. The editor toolbar's
   * collapsed groups (UI-23d) use it so Bold-in-a-menu still says
   * whether the selection is bold, as the flat button's `aria-pressed`
   * does.
   */
  readonly checked?: boolean | undefined;
}) {
  const reasonId = useId();
  // The reason is a description, so it is announced only when there IS
  // one. An `aria-describedby` pointing at an element that does not
  // exist is not harmless: it is a dangling reference.
  const described = title !== undefined && title !== "";
  return (
    <>
      <button
        type="button"
        role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
        {...(checked !== undefined ? { "aria-checked": checked } : {})}
        disabled={disabled}
        {...(described ? { "aria-describedby": reasonId } : {})}
        onClick={onSelect}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
        className={[
          "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem]",
          disabled
            ? "cursor-not-allowed text-text-disabled opacity-50"
            : danger
              ? "text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
              : "text-text-secondary hover:bg-bg-muted hover:text-text-primary",
          className ?? "",
        ].join(" ")}
      >
        {children}
        {checked === true && (
          <span className="ml-auto flex shrink-0 text-accent">
            <Icon name="check" size={14} />
          </span>
        )}
      </button>
      {/* OUTSIDE the button on purpose: text inside would join the
          button's accessible NAME ("Delete A tracker must have at least
          one project."), which is the very conflation this migration
          exists to prevent. As a sibling it is description only. */}
      {described && <SrOnly id={reasonId}>{title}</SrOnly>}
    </>
  );
}
