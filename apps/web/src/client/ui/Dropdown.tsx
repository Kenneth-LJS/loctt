import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Checkbox } from "./Checkbox.tsx";
import { cn } from "./cn.ts";
import { Icon } from "./Icon.tsx";
import { panelStyle, usePortalPlacement } from "./usePortalPlacement.ts";

/**
 * THE dropdown primitive (K106) — one component behind every "pick one
 * (or many) from a set" control in the app: the plain select-shaped
 * field, the searchable value picker, and the filter-bar facet.
 *
 * It replaces `ui/Combobox` (the inline searchable listbox) and
 * `list/FilterFacet` (the `Menu`-based multi-select facet), which were
 * two components solving the same problem with different substrates.
 *
 * ## Why one primitive needs THREE semantic modes
 *
 * A dropdown's ARIA role set is not a styling choice — it is a contract
 * with assistive technology, and the e2e suite pins both of the ones this
 * app shipped. They could not be flattened into one:
 *
 * | `mode`   | container        | rows                 | focus model |
 * |----------|------------------|----------------------|-------------|
 * | `single` | `listbox`        | `option`             | `aria-activedescendant` from the search box; roving DOM focus once you Tab into the rows |
 * | `multi`  | `listbox` + `aria-multiselectable` | `option` + `aria-selected` | same as `single` |
 * | `menu`   | `menu`           | `menuitemcheckbox` + `aria-checked` | real roving DOM focus over the rows (A11Y-10) |
 *
 * `single`/`multi` are the former `Combobox`: the labels picker, the
 * query-builder value list and the task-meta pickers are all asserted in
 * `tests/ui/` via `getByRole("option")` + `aria-selected`.
 *
 * `menu` is the former `FilterFacet`-as-`Menu`: roughly thirty e2e assertions
 * use `getByRole("menuitemcheckbox")`, and A11Y-10 asserts specifically
 * that the FIRST row holds real DOM focus on open and ArrowDown moves it
 * — a promise `role="menu"` makes and `aria-activedescendant` does not.
 * Folding the facet onto the listbox model would have broken both.
 *
 * So the merge is of the *machinery* — one panel, one portal, one
 * placement, one search/filter rule, one option shape — with the role set
 * and focus model as a declared axis rather than a fork of the component.
 *
 * ## Why the panel is portalled (MENU-PORTAL)
 *
 * All three modes render the panel into `document.body` with measured,
 * viewport-clamped `position: fixed` coordinates (`usePortalPlacement`).
 * `Combobox`'s old inline `absolute` panel had the ancestor-`overflow`
 * clipping defect latent: any caller inside a scroll container would have
 * had its list sliced, exactly as the sidebar kebab was. Ken's 2026-09-21
 * ruling is that the portal is the more robust substrate — inline has a
 * known, already-encountered failure mode and portalled has none — so the
 * whole family moves onto it.
 *
 * ## Search box rule (A211)
 *
 * - **Small, fixed sets** — a status/priority/type enum, an operator
 *   list, true/false — pass `searchable={false}`. Searching six options
 *   is noise.
 * - **Sets that grow with the workspace** — labels, users, projects,
 *   milestones, custom-enum values — let the rule decide:
 *   - `search` supplied → **server-side** (K90): candidates come from
 *     `onQuery(q)` and the box is always shown, because the list is by
 *     definition too big to fetch whole.
 *   - no `search` → **client-side**: `options` are filtered in memory and
 *     the box appears once the list crosses `DROPDOWN_SEARCH_THRESHOLD`
 *     (twelve — MSL-19's forty-label case is the motivating one).
 *     `searchable` overrides the threshold either way.
 *
 * ## What it carries over from `OptionPicker`
 *
 * The 200ms debounced query with cancellation, the current value kept in
 * the list even when the query did not return it (P3/XS-27 — a selected
 * value is *marked*, never *filtered out*), present-but-disabled options
 * with a reason (archived entities, TSK-10/TSK-33), per-option colour dot
 * / suffix / disambiguating hint (TSK-7), and Escape closing without a
 * write and returning focus to the trigger (TSK-41, P8).
 */

export interface DropdownOption {
  readonly key: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Rendered after the label, e.g. "(archived)". */
  readonly suffix?: string;
  /** Distinguishes options whose labels collide (TSK-7). */
  readonly hint?: string;
  readonly color?: string | undefined;
}

/** K90: opt-in server-side search. */
export interface DropdownSearch {
  /** Returns the options matching `q` (already mapped). */
  readonly onQuery: (q: string) => Promise<readonly DropdownOption[]>;
  readonly placeholder?: string;
}

/**
 * Option count at which a static list grows a client-side search box.
 * MSL-19 names forty labels as the case; twelve is where scanning starts
 * to cost more than typing.
 */
export const DROPDOWN_SEARCH_THRESHOLD = 12;

/** Debounce before a server query is sent. */
const QUERY_DEBOUNCE_MS = 200;

/**
 * Client-side match: case-insensitive substring over the label, and the
 * hint/suffix when present (so "(archived)" or a disambiguating id is
 * typeable too). An empty query matches everything.
 */
export function filterOptions<
  T extends { readonly label: string; readonly hint?: string; readonly suffix?: string },
>(options: readonly T[], query: string): readonly T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return options;
  return options.filter(o =>
    o.label.toLowerCase().includes(q) ||
    (o.hint?.toLowerCase().includes(q) ?? false) ||
    (o.suffix?.toLowerCase().includes(q) ?? false));
}

export interface DropdownTriggerProps {
  readonly ref: RefObject<HTMLButtonElement | null>;
  readonly open: boolean;
  readonly toggle: () => void;
  /**
   * `listbox` for the single/multi modes, `menu` for the facet mode —
   * the trigger must announce the kind of popup it actually opens.
   */
  readonly "aria-haspopup": "listbox" | "menu";
  readonly "aria-expanded": boolean;
  readonly "aria-controls": string | undefined;
}

export interface DropdownFooterContext {
  /** The trimmed search text. */
  readonly query: string;
  /** False while a server query is in flight (static mode: always true). */
  readonly loaded: boolean;
  /** The options the list is currently showing. */
  readonly visible: readonly DropdownOption[];
  readonly close: (returnFocus: boolean) => void;
}

interface DropdownCommonProps {
  /** The field's name — the list's accessible name and the search box's default label. */
  readonly label: string;
  /**
   * The options to show. Static mode: the whole list. Server mode: only
   * what must always be shown (the current value's option), the rest
   * comes from `search.onQuery`.
   */
  readonly options: readonly DropdownOption[];
  /** K90: server-side search. Omit for the static list. */
  readonly search?: DropdownSearch | undefined;
  /** Client-side filtering on/off regardless of size. Ignored with `search`. */
  readonly searchable?: boolean | undefined;
  readonly searchLabel?: string | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly searchTestId?: string | undefined;
  readonly listTestId?: string | undefined;
  readonly optionTestId?: ((opt: DropdownOption) => string) | undefined;
  /** Why a disabled option cannot be picked, rendered once under the list. */
  readonly disabledReason?: string | undefined;
  /**
   * Text when the list is empty after loading. A function may return
   * `null` to render nothing (the caller's footer says it instead).
   */
  readonly noMatchesText?: string | ((query: string) => ReactNode) | undefined;
  /** Which edge of the trigger the panel aligns to. Defaults to "start". */
  readonly align?: "start" | "end" | undefined;
  readonly panelClassName?: string | undefined;
  readonly trigger: (props: DropdownTriggerProps) => ReactNode;
  /** Rendered above the options (the labels facet's All/Any match toggle). */
  readonly header?: ReactNode | undefined;
  /** Rendered under the options (the labels picker's create offer). */
  readonly footer?: ((ctx: DropdownFooterContext) => ReactNode) | undefined;
  /** Enter in the search box with no option to pick. */
  readonly onSubmitQuery?:
    | ((query: string, close: (returnFocus: boolean) => void) => void)
    | undefined;
}

export interface DropdownSingleProps extends DropdownCommonProps {
  readonly mode?: "single" | undefined;
  /** The stored key, or undefined when unset. */
  readonly value: string | undefined;
  readonly onSelect: (key: string) => void;
  /** A "clear" row at the top of the list; omit to make the field non-clearable. */
  readonly clear?:
    | { readonly label: string; readonly onClear: () => void; readonly testId?: string | undefined }
    | undefined;
}

interface DropdownToggleProps extends DropdownCommonProps {
  readonly selected: readonly string[];
  readonly onToggle: (key: string, on: boolean) => void;
  /** Close after each pick (the labels picker) instead of staying open to pick more. */
  readonly closeOnSelect?: boolean | undefined;
  /** Drop already-selected options from the list instead of showing them checked. */
  readonly hideSelected?: boolean | undefined;
}

/** Multi-select with LISTBOX semantics: `option` + `aria-selected`. */
export interface DropdownMultiProps extends DropdownToggleProps {
  readonly mode: "multi";
}

/**
 * Multi-select with MENU semantics: `menuitemcheckbox` + `aria-checked`,
 * and real roving DOM focus (A11Y-10). The filter-bar facets.
 */
export interface DropdownMenuProps extends DropdownToggleProps {
  readonly mode: "menu";
}

export type DropdownProps =
  | DropdownSingleProps
  | DropdownMultiProps
  | DropdownMenuProps;

export function Dropdown(props: DropdownProps) {
  const {
    label,
    options,
    search,
    searchable,
    searchLabel,
    searchPlaceholder,
    searchTestId,
    listTestId,
    optionTestId,
    disabledReason,
    noMatchesText = "No matches.",
    align = "start",
    panelClassName,
    trigger,
    header,
    footer,
    onSubmitQuery,
  } = props;
  /** Menu semantics: `role="menu"` with `menuitemcheckbox` rows. */
  const menuMode = props.mode === "menu";
  /** Either of the two multi-select modes. */
  const multi = menuMode || props.mode === "multi";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Server results for the current (debounced) query, or null while a
  // query is in flight / before the first fetch. Only used in server mode.
  const [results, setResults] = useState<readonly DropdownOption[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The latest onQuery, read at fetch time — callers pass inline objects,
  // and re-running the debounce on every parent render would refetch.
  const onQueryRef = useRef(search?.onQuery);
  onQueryRef.current = search?.onQuery;
  const listId = useId();

  const pos = usePortalPlacement(open, wrapRef, panelRef, align);

  const serverMode = search !== undefined;
  const showSearch = serverMode || (searchable ?? options.length >= DROPDOWN_SEARCH_THRESHOLD);
  const trimmedQuery = query.trim();

  /** The role each row carries — the whole semantic axis, in one place. */
  const rowRole = menuMode ? "menuitemcheckbox" : "option";

  useEffect(() => {
    if (!serverMode || !open) return undefined;
    let cancelled = false;
    setResults(null);
    const t = setTimeout(() => {
      const run = onQueryRef.current;
      if (run === undefined) return;
      void run(trimmedQuery)
        .then(rows => { if (!cancelled) setResults(rows); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, QUERY_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [serverMode, open, trimmedQuery]);

  useEffect(() => {
    if (open && showSearch) inputRef.current?.focus();
  }, [open, showSearch]);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    setQuery("");
    setActiveKey(null);
    // TSK-41's third bullet. Only on a deliberate close — on an outside
    // click the user has already moved focus somewhere they chose.
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        // The picker's Escape must not ALSO reach a dialog it sits
        // inside (the create modal's discard prompt).
        //
        // `stopPropagation` is not enough. Both this and the modal
        // register a CAPTURE listener on `document`, and capture
        // listeners on the SAME node fire in registration order — the
        // modal mounts first, so it runs first and
        // `stopPropagation` (which only stops the walk to the NEXT
        // node) comes too late to matter. One Escape closed the panel
        // and opened "Discard this task?", which then covered the
        // modal's Submit button — the button a user, or a spec, clicks
        // next.
        //
        // `stopImmediatePropagation` is the one that stops the other
        // listener on this same node.
        e.stopImmediatePropagation();
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      // The panel is portalled to `document.body`, so it is no longer a
      // descendant of the wrapper. Outside-click therefore has to treat a
      // click inside *either* the trigger wrapper or the portalled panel
      // as "inside" — otherwise every click on a row would close the
      // panel before the row's own handler runs.
      if (panelRef.current?.contains(t) === true) return;
      if (wrapRef.current?.contains(t) === true) return;
      close(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const selectedKeys: readonly string[] = multi
    ? props.selected
    : props.value === undefined ? [] : [props.value];
  const isSelected = (key: string): boolean => selectedKeys.includes(key);

  // The list the panel renders.
  const visible: readonly DropdownOption[] = (() => {
    let rows: readonly DropdownOption[];
    if (serverMode) {
      rows = results ?? [];
    } else {
      rows = showSearch ? filterOptions(options, trimmedQuery) : options;
    }
    if (multi) {
      const p = props as DropdownToggleProps;
      return p.hideSelected === true ? rows.filter(o => !isSelected(o.key)) : rows;
    }
    // Single: the current value stays in the list when the query did not
    // return it (or filtered it out), so a selected value — including an
    // archived one, which must stay present-but-disabled — never vanishes
    // and keeps its `aria-selected` marker.
    const value = props.value;
    const current = value === undefined ? undefined : options.find(o => o.key === value);
    if (current === undefined || rows.some(o => o.key === current.key)) return rows;
    return [current, ...rows];
  })();
  const loaded = !serverMode || results !== null;
  const enabledKeys = visible.filter(o => o.disabled !== true).map(o => o.key);

  // Keep the active option valid as the list changes: with a search box
  // the first enabled option is active by default so Enter picks it.
  //
  // Menu mode has no `aria-activedescendant` pointer — real DOM focus is
  // the cursor there — so it stays out of this entirely.
  const enabledSignature = enabledKeys.join("\0");
  useEffect(() => {
    if (!open || menuMode) return;
    setActiveKey(prev => {
      if (prev !== null && enabledKeys.includes(prev)) return prev;
      return showSearch ? (enabledKeys[0] ?? null) : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showSearch, menuMode, enabledSignature]);

  useEffect(() => {
    if (activeKey === null) return;
    const el = document.getElementById(optionId(listId, activeKey));
    if (el !== null && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeKey, listId]);

  const pick = (key: string): void => {
    if (multi) {
      const p = props as DropdownToggleProps;
      p.onToggle(key, !isSelected(key));
      if (p.closeOnSelect === true) close(true);
      return;
    }
    props.onSelect(key);
    close(true);
  };

  const rows = (): HTMLElement[] =>
    panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(
          `[role="${rowRole}"]:not([disabled])`,
        ))
      : [];

  /**
   * Menu mode's roving-focus rows: the checkable options AND the trailing
   * `menuitem` rows (the "Remove this filter" control), so arrow travel
   * reaches the whole panel exactly as `ui/Menu` does.
   */
  const menuRows = (): HTMLElement[] =>
    panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled]),[role="menuitemradio"]:not([disabled])',
        ))
      : [];

  // A11Y-10: `role="menu"` promises roving arrow-key movement with REAL
  // focus, and the e2e suite asserts the first row is focused on open.
  // Deferred to after the panel paints its children.
  useEffect(() => {
    if (!open || !menuMode) return undefined;
    const id = requestAnimationFrame(() => { menuRows()[0]?.focus(); });
    return () => { cancelAnimationFrame(id); };
  }, [open, menuMode]);

  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const step = (from: string | null, delta: number): string | null => {
    if (enabledKeys.length === 0) return null;
    const i = from === null ? -1 : enabledKeys.indexOf(from);
    if (i === -1) return delta > 0 ? (enabledKeys[0] ?? null) : (enabledKeys[enabledKeys.length - 1] ?? null);
    const n = enabledKeys.length;
    return enabledKeys[(((i + delta) % n) + n) % n] ?? null;
  };

  /**
   * Menu mode's key model, lifted from `ui/Menu`: roving DOM focus over
   * the rows, Home/End, and printable-character type-ahead. Stands down
   * whenever the event originates in the search box — typing "d" there
   * must filter, not rove, and the caret must move on ArrowLeft/Right.
   */
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) return;
    const items = menuRows();
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
    // Type-ahead: a single printable character jumps to the next row
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

  /**
   * Listbox mode's key model: focus lives in the search box and
   * `aria-activedescendant` points at the active option; a user who Tabs
   * into the rows instead gets roving focus over the real buttons.
   */
  const onListboxKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    const target = e.target as HTMLElement;
    const onTrigger = triggerRef.current !== null && triggerRef.current.contains(target);
    const onInput = target === inputRef.current;

    if (!open) {
      if (onTrigger && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (onTrigger && e.key === "ArrowDown") {
      e.preventDefault();
      if (showSearch) inputRef.current?.focus();
      else rows()[0]?.focus();
      return;
    }

    if (onInput) {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); setActiveKey(k => step(k, 1)); return;
        case "ArrowUp": e.preventDefault(); setActiveKey(k => step(k, -1)); return;
        case "Home": e.preventDefault(); setActiveKey(enabledKeys[0] ?? null); return;
        case "End": e.preventDefault(); setActiveKey(enabledKeys[enabledKeys.length - 1] ?? null); return;
        case "Enter": {
          e.preventDefault();
          if (activeKey !== null && enabledKeys.includes(activeKey)) pick(activeKey);
          else onSubmitQuery?.(trimmedQuery, close);
          return;
        }
        default: return;
      }
    }

    // Focus is on an option button: roving focus over the buttons.
    if (target.getAttribute("role") === "option") {
      const buttons = rows();
      const i = buttons.indexOf(target);
      const focusAt = (j: number): void => {
        e.preventDefault();
        const n = buttons.length;
        if (n === 0) return;
        const el = buttons[((j % n) + n) % n];
        el?.focus();
        const id = el?.id;
        if (id !== undefined) setActiveKey(keyFromOptionId(listId, id));
      };
      switch (e.key) {
        case "ArrowDown": focusAt(i + 1); return;
        case "ArrowUp": {
          // Up from the first option goes back to the search box.
          if (i === 0 && showSearch) { e.preventDefault(); inputRef.current?.focus(); return; }
          focusAt(i - 1);
          return;
        }
        case "Home": focusAt(0); return;
        case "End": focusAt(buttons.length - 1); return;
        default: return;
      }
    }
  };

  /**
   * The trigger's own keys. In menu mode the panel handles its own
   * roving, but ArrowDown/Up on a CLOSED trigger must still open it —
   * that is the listbox path's job and it is semantic-neutral.
   */
  const onWrapperKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (menuMode) {
      if (!open) {
        const target = e.target as HTMLElement;
        const onTrigger = triggerRef.current !== null && triggerRef.current.contains(target);
        if (onTrigger && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          setOpen(true);
        }
      }
      return;
    }
    onListboxKeyDown(e);
  };

  const emptyText = (): ReactNode =>
    typeof noMatchesText === "function" ? noMatchesText(trimmedQuery) : noMatchesText;

  const single = props.mode === "single" || props.mode === undefined ? props : undefined;
  const clear = single?.clear;
  const showClear = clear !== undefined && single !== undefined && single.value !== undefined;
  const hideSelected = multi && (props as DropdownToggleProps).hideSelected === true;

  const panel = (
    <div
      ref={panelRef}
      // MENU-PORTAL fallout: the panel is portalled to `document.body`,
      // so a component that opens a Dropdown can no longer recognise
      // "focus moved into my own dropdown" with
      // `wrapper.contains(relatedTarget)` — the panel is not a
      // descendant. `BodyEditor` relied on exactly that and tore its
      // editor down when the block-type dropdown opened (TSK-59). This
      // marker lets any such owner ask "is this node inside SOME
      // portalled panel?" without reaching into our refs. `Menu` carries
      // the same one (UI-23d), so the question has one spelling.
      data-portal-panel=""
      onKeyDown={menuMode ? onMenuKeyDown : undefined}
      {...(menuMode
        ? { role: "menu" as const, "aria-label": `Filter by ${label}` }
        : {})}
      className={cn(
        // `z-[65]` sits above the modal layers (Modal `z-50`,
        // CreateTaskModal `z-[55]`) so a dropdown opened from inside a
        // dialog shows above it, and under the shortcut-help dialog
        // (`z-[70]`), which hosts none.
        "fixed z-[65] min-w-[200px] rounded-md border border-border-subtle bg-bg-surface py-1 shadow-overlay",
        panelClassName,
      )}
      style={panelStyle(pos)}
    >
      {showSearch && (
        <div className="px-1 pb-1">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={searchLabel ?? `Search ${label.toLowerCase()}`}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              menuMode || activeKey === null ? undefined : optionId(listId, activeKey)
            }
            autoComplete="off"
            data-testid={searchTestId}
            value={query}
            onChange={e => { setQuery(e.target.value); }}
            placeholder={searchPlaceholder ?? search?.placeholder ?? "Search…"}
            className="w-full rounded border border-border-subtle bg-bg-canvas px-1.5 py-1 text-label text-text-primary placeholder:text-text-tertiary"
          />
        </div>
      )}

      {header !== undefined && (
        <div className="border-b border-border-subtle p-1.5">{header}</div>
      )}

      <div
        id={listId}
        // Menu mode's rows are `menuitemcheckbox`, which must be owned by
        // the `role="menu"` panel — an intervening `role="listbox"` would
        // orphan them. So the wrapper is a plain scroll container there.
        {...(menuMode
          ? {}
          : {
              role: "listbox" as const,
              "aria-label": label,
              "aria-multiselectable": multi ? true : undefined,
            })}
        data-testid={listTestId}
        className="max-h-64 overflow-auto"
      >
        {showClear && (
          <button
            type="button"
            role="option"
            aria-selected={false}
            data-testid={clear.testId}
            onClick={() => { clear.onClear(); close(true); }}
            className="block w-full px-3 py-1.5 text-left text-body text-text-tertiary hover:bg-bg-muted"
          >
            {clear.label}
          </button>
        )}
        {loaded && visible.length === 0 && emptyText() !== null && (
          <p className="px-3 py-1.5 text-label text-text-tertiary">{emptyText()}</p>
        )}
        {visible.map(opt => {
          const on = isSelected(opt.key);
          const active = !menuMode && opt.key === activeKey;
          const disabled = opt.disabled === true;
          return (
            <button
              key={opt.key}
              id={optionId(listId, opt.key)}
              type="button"
              role={rowRole}
              // The two role sets spell selectedness differently, and
              // each is what its own e2e assertions read.
              {...(menuMode ? { "aria-checked": on } : { "aria-selected": on })}
              disabled={disabled}
              data-active={active ? "true" : undefined}
              data-testid={optionTestId?.(opt)}
              // The archived option is present and named, so the user
              // learns the entity exists and is archived rather than
              // wondering where it went (P7).
              //
              // UI-23e: the reason is wired as an explicit accessible
              // DESCRIPTION rather than left to the browser's
              // `title`-as-description fallback. It points at the same
              // visible note already rendered at the foot of the list,
              // so the reason is stated once and both sighted and
              // screen-reader users get it from one node. It stays a
              // description, never the name — see `Menu.tsx`'s
              // `MenuItem` note for why `aria-label` would be wrong.
              {...(disabled && disabledReason !== undefined
                ? { "aria-describedby": `${listId}-disabled-reason` }
                : {})}
              onMouseMove={() => {
                if (!menuMode && !disabled && !active) setActiveKey(opt.key);
              }}
              onClick={() => { if (!disabled) pick(opt.key); }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-body",
                disabled
                  ? "cursor-not-allowed text-text-tertiary opacity-60"
                  : "cursor-pointer text-text-primary hover:bg-bg-muted",
                active && !disabled && "bg-bg-muted",
              )}
            >
              {multi && !hideSelected && (
                // A non-interactive visual mirror of the row's checked
                // state: the button owns the toggle, the box just shows
                // it. LST-56 (UX-4): shown *unchecked* before the first
                // click, because an empty box reads as clickable where a
                // blank gap gave no cue the list was multi-select.
                <Checkbox
                  checked={on}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="pointer-events-none"
                />
              )}
              {opt.color !== undefined && (
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {opt.label}
                {opt.suffix !== undefined && (
                  <span className="ml-1.5 text-text-tertiary">{opt.suffix}</span>
                )}
                {opt.hint !== undefined && (
                  <span className="ml-1.5 text-meta text-text-tertiary">{opt.hint}</span>
                )}
              </span>
              {!multi && on && (
                <Icon name="check" size={14} className="shrink-0 text-accent" />
              )}
            </button>
          );
        })}
        {/* Rendered AFTER the rows, not before: `visible` already puts the
            current single-select value first (see above) while a server
            query is in flight, so the pending row belongs below it —
            otherwise the selected option reads as buried under a
            "Loading…" line it has nothing to do with. Never a `button`/
            `role="option"` — it must not be reachable by roving focus or
            become `activeKey`. */}
        {!loaded && (
          <p className="px-3 py-1.5 text-label text-text-tertiary">Loading…</p>
        )}
      </div>

      {footer?.({ query: trimmedQuery, loaded, visible, close })}

      {/* The id is what each disabled row's `aria-describedby` points at
          (UI-23e). The render condition is exactly "a disabled row is
          visible", which is exactly when a row references it — so the
          reference never dangles. */}
      {disabledReason !== undefined && visible.some(o => o.disabled === true) && (
        <p
          id={`${listId}-disabled-reason`}
          className="border-t border-border-subtle px-3 pb-1 pt-1.5 text-meta text-text-tertiary"
        >
          {disabledReason}
        </p>
      )}
    </div>
  );

  return (
    <div ref={wrapRef} className="relative inline-flex" onKeyDown={onWrapperKeyDown}>
      {trigger({
        ref: triggerRef,
        open,
        toggle: () => { setOpen(o => !o); },
        "aria-haspopup": menuMode ? "menu" : "listbox",
        "aria-expanded": open,
        "aria-controls": open ? listId : undefined,
      })}
      {open ? createPortal(panel, document.body) : null}
    </div>
  );
}

function optionId(listId: string, key: string): string {
  return `${listId}-opt-${encodeURIComponent(key)}`;
}

function keyFromOptionId(listId: string, id: string): string | null {
  const prefix = `${listId}-opt-`;
  return id.startsWith(prefix) ? decodeURIComponent(id.slice(prefix.length)) : null;
}

// ── Default trigger ──────────────────────────────────────────────────

export type DropdownButtonSize = "sm" | "md";

const BUTTON_SIZE: Record<DropdownButtonSize, string> = {
  sm: "h-7 text-label",
  md: "h-8 text-body",
};

/**
 * The select-shaped trigger: same border/radius/height/chevron as
 * `Select`, so a form that mixes a plain `Select` (operator) with a
 * `Dropdown` (value) reads as one row of controls.
 */
export function DropdownButton({
  ref,
  open,
  toggle,
  size = "md",
  placeholder = "—",
  children,
  className,
  testId,
  dataValue,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-haspopup": haspopup,
  "aria-expanded": expanded,
  "aria-controls": controls,
}: DropdownTriggerProps & {
  readonly size?: DropdownButtonSize | undefined;
  /**
   * Matches `<select disabled>`: the trigger stays focusable-by-nothing
   * and cannot open the list (SET-16 locks the custom-field type on edit).
   */
  readonly disabled?: boolean | undefined;
  readonly "aria-describedby"?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly children?: ReactNode;
  /** Layout only. */
  readonly className?: string | undefined;
  readonly testId?: string | undefined;
  /**
   * The currently-selected value, exposed as `data-value` so a test can
   * assert the selection without opening the list (the parity with a
   * native `<select>`'s `value`).
   */
  readonly dataValue?: string | undefined;
  readonly "aria-label"?: string | undefined;
  /**
   * A211/A242: the id of an element that names this control, for callers
   * whose label is a separate heading rather than a string (ReconcilePanel's
   * field-name `<div>`, wired via `useId()`). When supplied it takes
   * precedence over `aria-label`, so the trigger announces the field it
   * belongs to without duplicating the name — the same association a
   * native `<select aria-labelledby>` carried before the swap.
   */
  readonly "aria-labelledby"?: string | undefined;
}) {
  const empty = children === undefined || children === null || children === "";
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      data-value={dataValue}
      disabled={disabled}
      aria-label={ariaLabelledBy !== undefined ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-haspopup={haspopup}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={toggle}
      className={cn(
        "relative inline-flex max-w-full items-center rounded-md border border-border-default",
        "px-2 pr-7 text-left transition-colors",
        "aria-expanded:border-border-strong",
        BUTTON_SIZE[size],
        // Mirrors Select's disabled treatment. Background, colour and
        // cursor are all chosen inside ONE branch — `cn()` concatenates and
        // does not resolve Tailwind conflicts, so emitting `bg-bg-surface`
        // in the base and `bg-bg-muted` here would leave both in the class
        // list with CSS order deciding which wins.
        disabled
          ? "cursor-not-allowed bg-bg-muted text-text-disabled"
          : cn(
              "cursor-pointer bg-bg-surface hover:bg-bg-muted",
              empty ? "text-text-tertiary" : "text-text-primary",
            ),
        className,
      )}
    >
      <span className="min-w-0 truncate">{empty ? placeholder : children}</span>
      <Icon
        name="chevronDown"
        size={14}
        className={cn(
          "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary transition-transform",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

// ── The select-shaped convenience wrapper (K106) ─────────────────────

/**
 * A `Dropdown` in the shape the old native `<select>` had: a value, a flat
 * option list, and an `onChange` that reports the picked key.
 *
 * K106 folds the plain single-select onto the one dropdown primitive. The
 * ~18 former `Select` sites are small fixed sets, so they pass
 * `searchable={false}`: the threshold would not fire for most of them
 * anyway, but saying it outright keeps a list that later grows past twelve
 * from silently sprouting a search box the site did not ask for.
 *
 * ## What a native `<select>` gave for free, and what replaces it
 *
 * - **Accessible name.** A `<select>` nested inside a `<label>` is named
 *   implicitly; a `<button>` is not. Every caller must therefore pass
 *   `aria-label`, or `aria-labelledby` pointing at its visible label.
 *   `label` (the listbox's own name) falls back to `aria-label` so the
 *   two cannot drift apart.
 * - **`value` in the DOM.** Assert on `data-value` instead — the trigger
 *   carries the selected key, which is the parity `DropdownButton`'s
 *   `dataValue` was added for.
 * - **The mobile native picker and type-ahead** are genuinely lost; this
 *   is the listbox's own keyboard model instead (arrows/Home/End/Enter,
 *   Escape to close).
 */
export interface SelectDropdownOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

export interface SelectDropdownProps {
  readonly value: string;
  readonly options: readonly SelectDropdownOption[];
  readonly onChange: (value: string) => void;
  readonly size?: DropdownButtonSize | undefined;
  readonly disabled?: boolean | undefined;
  readonly testId?: string | undefined;
  /** Names both the trigger and the listbox. Omit only with `aria-labelledby`. */
  readonly "aria-label"?: string | undefined;
  readonly "aria-labelledby"?: string | undefined;
  /**
   * The listbox's own name when the trigger is named by `aria-labelledby`
   * (whose referenced element the listbox cannot borrow). Defaults to
   * `aria-label`.
   */
  readonly listLabel?: string | undefined;
  readonly "aria-describedby"?: string | undefined;
  /** Shown when `value` matches no option. */
  readonly placeholder?: string | undefined;
  /** Layout only — see the `cn()` note: this appends, it does not resolve conflicts. */
  readonly className?: string | undefined;
  /** Forces the search box on/off; defaults to off for these fixed sets. */
  readonly searchable?: boolean | undefined;
}

export function SelectDropdown({
  value,
  options,
  onChange,
  size = "md",
  disabled = false,
  testId,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  listLabel,
  placeholder = "—",
  className,
  searchable = false,
}: SelectDropdownProps) {
  const current = options.find(o => o.value === value);
  return (
    <Dropdown
      label={listLabel ?? ariaLabel ?? ""}
      options={options.map(o => ({
        key: o.value,
        label: o.label,
        // Omitted rather than passed as `undefined`: the repo runs with
        // `exactOptionalPropertyTypes`.
        ...(o.disabled === undefined ? {} : { disabled: o.disabled }),
      }))}
      value={current === undefined ? undefined : value}
      onSelect={onChange}
      searchable={searchable}
      trigger={p => (
        <DropdownButton
          {...p}
          testId={testId}
          dataValue={value}
          size={size}
          placeholder={placeholder}
          className={className}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
        >
          {current?.label}
        </DropdownButton>
      )}
    />
  );
}
