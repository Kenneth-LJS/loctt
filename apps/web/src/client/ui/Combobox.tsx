import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Checkbox } from "./Checkbox.tsx";
import { cn } from "./cn.ts";
import { Icon } from "./Icon.tsx";

/**
 * The searchable value picker — ONE primitive for "pick one (or many)
 * from a set that can grow large".
 *
 * ## The rule for when to use it (A211)
 *
 * - **Small, fixed sets** — a status/priority/type enum, an operator
 *   list, a three-state sprint state, true/false — stay on the plain
 *   `Select` (or a `Radio` group). Searching six options is noise.
 * - **Sets that can grow with the workspace** — labels, users, projects,
 *   milestones, sprints, custom-enum values — use `Combobox`. Whether the
 *   search box is *shown* is then decided one of two ways:
 *   - `search` supplied → **server-side** (K90): the candidates come from
 *     `onQuery(q)` and the box is always shown, because the list is by
 *     definition too big to fetch whole.
 *   - no `search` → **client-side**: the static `options` are filtered in
 *     memory, and the box appears once the list crosses
 *     `COMBOBOX_SEARCH_THRESHOLD` (twelve — MSL-19's forty-label case is
 *     the motivating one; below twelve the list fits and the box is
 *     noise). `filterable` overrides the threshold either way.
 *
 * ## What it carries over from `OptionPicker`
 *
 * This is OptionPicker's listbox extracted, not a fork of it: the 200ms
 * debounced query with cancellation, the current value kept in the list
 * even when the query did not return it (P3/XS-27 — a selected value is
 * *marked*, never *filtered out*), present-but-disabled options with a
 * reason (archived entities, TSK-10/TSK-33), per-option colour dot /
 * suffix / disambiguating hint (TSK-7), and Escape closing without a
 * write and returning focus to the trigger (TSK-41, P8).
 *
 * ## Keyboard model
 *
 * With a search box, focus lives in the box (`role="combobox"`,
 * `aria-activedescendant`); ArrowDown/Up move the active option, Home/End
 * jump, Enter picks the active one (or calls `onSubmitQuery` when there is
 * nothing to pick — the labels picker's "Enter creates" path), Escape
 * closes. Options are still real `<button role="option">`s, so a user who
 * Tabs into the list gets roving arrow focus over them and Space/Enter
 * activate natively. Without a search box the trigger's ArrowDown opens
 * the list and moves focus to the first option.
 *
 * The trigger is a render prop so the three trigger shapes in the app —
 * the inline meta field, the dashed "+ Label" pill, and the select-like
 * `ComboboxButton` — share one list without a wrapper each.
 */
export interface ComboboxOption {
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
export interface ComboboxSearch {
  /** Returns the options matching `q` (already mapped). */
  readonly onQuery: (q: string) => Promise<readonly ComboboxOption[]>;
  readonly placeholder?: string;
}

/**
 * Option count at which a static list grows a client-side search box.
 * MSL-19 names forty labels as the case; twelve is where scanning starts
 * to cost more than typing.
 */
export const COMBOBOX_SEARCH_THRESHOLD = 12;

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

export interface ComboboxTriggerProps {
  readonly ref: RefObject<HTMLButtonElement | null>;
  readonly open: boolean;
  readonly toggle: () => void;
  readonly "aria-haspopup": "listbox";
  readonly "aria-expanded": boolean;
  readonly "aria-controls": string | undefined;
}

export interface ComboboxFooterContext {
  /** The trimmed search text. */
  readonly query: string;
  /** False while a server query is in flight (static mode: always true). */
  readonly loaded: boolean;
  /** The options the list is currently showing. */
  readonly visible: readonly ComboboxOption[];
  readonly close: (returnFocus: boolean) => void;
}

interface ComboboxCommonProps {
  /** The field's name — the listbox's accessible name and the search box's default label. */
  readonly label: string;
  /**
   * The options to show. Static mode: the whole list. Server mode: only
   * what must always be shown (the current value's option), the rest
   * comes from `search.onQuery`.
   */
  readonly options: readonly ComboboxOption[];
  /** K90: server-side search. Omit for the static list. */
  readonly search?: ComboboxSearch | undefined;
  /** Client-side filtering on/off regardless of size. Ignored with `search`. */
  readonly filterable?: boolean | undefined;
  readonly searchLabel?: string | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly searchTestId?: string | undefined;
  readonly listTestId?: string | undefined;
  readonly optionTestId?: ((opt: ComboboxOption) => string) | undefined;
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
  readonly trigger: (props: ComboboxTriggerProps) => ReactNode;
  /** Rendered under the options (the labels picker's create offer). */
  readonly footer?: ((ctx: ComboboxFooterContext) => ReactNode) | undefined;
  /** Enter in the search box with no option to pick. */
  readonly onSubmitQuery?:
    | ((query: string, close: (returnFocus: boolean) => void) => void)
    | undefined;
}

export interface ComboboxSingleProps extends ComboboxCommonProps {
  readonly mode?: "single" | undefined;
  /** The stored key, or undefined when unset. */
  readonly value: string | undefined;
  readonly onSelect: (key: string) => void;
  /** A "clear" row at the top of the list; omit to make the field non-clearable. */
  readonly clear?:
    | { readonly label: string; readonly onClear: () => void; readonly testId?: string | undefined }
    | undefined;
}

export interface ComboboxMultiProps extends ComboboxCommonProps {
  readonly mode: "multi";
  readonly selected: readonly string[];
  readonly onToggle: (key: string, on: boolean) => void;
  /** Close after each pick (the labels picker) instead of staying open to pick more. */
  readonly closeOnSelect?: boolean | undefined;
  /** Drop already-selected options from the list instead of showing them checked. */
  readonly hideSelected?: boolean | undefined;
}

export type ComboboxProps = ComboboxSingleProps | ComboboxMultiProps;

export function Combobox(props: ComboboxProps) {
  const {
    label,
    options,
    search,
    filterable,
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
    footer,
    onSubmitQuery,
  } = props;
  const multi = props.mode === "multi";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Server results for the current (debounced) query, or null while a
  // query is in flight / before the first fetch. Only used in server mode.
  const [results, setResults] = useState<readonly ComboboxOption[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The latest onQuery, read at fetch time — callers pass inline objects,
  // and re-running the debounce on every parent render would refetch.
  const onQueryRef = useRef(search?.onQuery);
  onQueryRef.current = search?.onQuery;
  const listId = useId();

  const serverMode = search !== undefined;
  const showSearch = serverMode || (filterable ?? options.length >= COMBOBOX_SEARCH_THRESHOLD);
  const trimmedQuery = query.trim();

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
        // Capture + stop: the picker's Escape must not also close a
        // dialog it sits inside (the create modal).
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) !== true && triggerRef.current?.contains(t) !== true) {
        close(false);
      }
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
  const visible: readonly ComboboxOption[] = (() => {
    let rows: readonly ComboboxOption[];
    if (serverMode) {
      rows = results ?? [];
    } else {
      rows = showSearch ? filterOptions(options, trimmedQuery) : options;
    }
    if (multi) {
      return props.hideSelected ? rows.filter(o => !isSelected(o.key)) : rows;
    }
    // Single: the current value stays in the list when the query did not
    // return it (or filtered it out), so a selected value — including an
    // archived one, which must stay present-but-disabled — never vanishes
    // and keeps its `aria-selected` marker.
    const current = props.value === undefined ? undefined : options.find(o => o.key === props.value);
    if (current === undefined || rows.some(o => o.key === current.key)) return rows;
    return [current, ...rows];
  })();
  const loaded = !serverMode || results !== null;
  const enabledKeys = visible.filter(o => o.disabled !== true).map(o => o.key);

  // Keep the active option valid as the list changes: with a search box
  // the first enabled option is active by default so Enter picks it.
  const enabledSignature = enabledKeys.join(" ");
  useEffect(() => {
    if (!open) return;
    setActiveKey(prev => {
      if (prev !== null && enabledKeys.includes(prev)) return prev;
      return showSearch ? (enabledKeys[0] ?? null) : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showSearch, enabledSignature]);

  useEffect(() => {
    if (activeKey === null) return;
    const el = document.getElementById(optionId(listId, activeKey));
    if (el !== null && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeKey, listId]);

  const pick = (key: string): void => {
    if (multi) {
      props.onToggle(key, !isSelected(key));
      if (props.closeOnSelect === true) close(true);
      return;
    }
    props.onSelect(key);
    close(true);
  };

  const optionButtons = (): HTMLElement[] =>
    panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])'))
      : [];

  const step = (from: string | null, delta: number): string | null => {
    if (enabledKeys.length === 0) return null;
    const i = from === null ? -1 : enabledKeys.indexOf(from);
    if (i === -1) return delta > 0 ? (enabledKeys[0] ?? null) : (enabledKeys[enabledKeys.length - 1] ?? null);
    const n = enabledKeys.length;
    return enabledKeys[(((i + delta) % n) + n) % n] ?? null;
  };

  const onWrapperKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
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
      else optionButtons()[0]?.focus();
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
      const buttons = optionButtons();
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

  const emptyText = (): ReactNode =>
    typeof noMatchesText === "function" ? noMatchesText(trimmedQuery) : noMatchesText;

  const clear = multi ? undefined : props.clear;
  const showClear = clear !== undefined && !multi && props.value !== undefined;

  return (
    <div className="relative" onKeyDown={onWrapperKeyDown}>
      {trigger({
        ref: triggerRef,
        open,
        toggle: () => { setOpen(o => !o); },
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        "aria-controls": open ? listId : undefined,
      })}

      {open && (
        <div
          ref={panelRef}
          className={cn(
            "absolute z-20 mt-1 min-w-[200px] rounded-md border border-border-subtle bg-bg-surface py-1 shadow-lg",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
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
                aria-activedescendant={activeKey === null ? undefined : optionId(listId, activeKey)}
                autoComplete="off"
                data-testid={searchTestId}
                value={query}
                onChange={e => { setQuery(e.target.value); }}
                placeholder={searchPlaceholder ?? search?.placeholder ?? "Search…"}
                className="w-full rounded border border-border-subtle bg-bg-canvas px-1.5 py-1 text-label text-text-primary placeholder:text-text-tertiary"
              />
            </div>
          )}

          <div
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multi ? true : undefined}
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
            {!loaded && (
              <p className="px-3 py-1.5 text-label text-text-tertiary">Searching…</p>
            )}
            {loaded && visible.length === 0 && emptyText() !== null && (
              <p className="px-3 py-1.5 text-label text-text-tertiary">{emptyText()}</p>
            )}
            {visible.map(opt => {
              const on = isSelected(opt.key);
              const active = opt.key === activeKey;
              const disabled = opt.disabled === true;
              return (
                <button
                  key={opt.key}
                  id={optionId(listId, opt.key)}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={disabled}
                  data-active={active ? "true" : undefined}
                  data-testid={optionTestId?.(opt)}
                  // The archived option is present and named, so the user
                  // learns the entity exists and is archived rather than
                  // wondering where it went (P7).
                  title={disabled ? disabledReason : undefined}
                  onMouseMove={() => { if (!disabled && !active) setActiveKey(opt.key); }}
                  onClick={() => { if (!disabled) pick(opt.key); }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body",
                    disabled
                      ? "cursor-not-allowed text-text-tertiary opacity-60"
                      : "cursor-pointer text-text-primary hover:bg-bg-muted",
                    active && !disabled && "bg-bg-muted",
                  )}
                >
                  {multi && props.hideSelected !== true && (
                    // A non-interactive visual mirror of `aria-selected`:
                    // the button owns the toggle, the box just shows it.
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
          </div>

          {footer?.({ query: trimmedQuery, loaded, visible, close })}

          {disabledReason !== undefined && visible.some(o => o.disabled === true) && (
            <p className="border-t border-border-subtle px-3 pb-1 pt-1.5 text-meta text-text-tertiary">
              {disabledReason}
            </p>
          )}
        </div>
      )}
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

export type ComboboxButtonSize = "sm" | "md";

const BUTTON_SIZE: Record<ComboboxButtonSize, string> = {
  sm: "h-7 text-label",
  md: "h-8 text-body",
};

/**
 * The select-shaped trigger: same border/radius/height/chevron as
 * `Select`, so a form that mixes a plain `Select` (operator) with a
 * `Combobox` (value) reads as one row of controls.
 */
export function ComboboxButton({
  ref,
  open,
  toggle,
  size = "md",
  placeholder = "—",
  children,
  className,
  testId,
  dataValue,
  "aria-label": ariaLabel,
  "aria-haspopup": haspopup,
  "aria-expanded": expanded,
  "aria-controls": controls,
}: ComboboxTriggerProps & {
  readonly size?: ComboboxButtonSize | undefined;
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
}) {
  const empty = children === undefined || children === null || children === "";
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      data-value={dataValue}
      aria-label={ariaLabel}
      aria-haspopup={haspopup}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={toggle}
      className={cn(
        "relative inline-flex max-w-full items-center rounded-md border border-border-default bg-bg-surface",
        "px-2 pr-7 text-left cursor-pointer transition-colors hover:bg-bg-muted",
        "aria-expanded:border-border-strong",
        BUTTON_SIZE[size],
        empty ? "text-text-tertiary" : "text-text-primary",
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
