import { useEffect, useId, useRef, useState } from "react";

/**
 * One selectable option in a picker.
 *
 * `label` is what the user sees; `key` is what lands on disk. P3 is the
 * whole reason this shape exists: statuses, priorities, types, enum
 * custom-field values, milestones and sprints all store a key or a
 * ULID and all display something the user configured, and none of them
 * may be shown by their stored value.
 *
 * `disabled` is for archived entities. An archived milestone must not
 * be *choosable* (TSK-10, TSK-33) but must still be *displayable* when
 * a task already references one — so the option stays in the list,
 * marked, rather than being filtered out and rendering the current
 * value as blank.
 */
export interface PickerOption {
  readonly key: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Rendered after the label, e.g. "(archived)". */
  readonly suffix?: string;
  /** Distinguishes options whose labels collide (TSK-7). */
  readonly hint?: string;
  readonly color?: string | undefined;
}

/**
 * A listbox that edits one field inline.
 *
 * ## Why not `<select>`
 *
 * Three of the case's requirements are not expressible in a native
 * select: an option that is present but unselectable *and explains
 * why* (archived), a per-option disambiguating hint (TSK-7's two users
 * sharing a display name), and a value that is set but not in the
 * option list at all (TSK-30 / XS-27's stale enum value, which must
 * render flagged rather than blank). A native select silently drops a
 * value it has no `<option>` for, which is the exact failure XS-27
 * names.
 *
 * ## Escape (TSK-41)
 *
 * Escape closes the list, leaves the value alone, sends nothing, and
 * returns focus to the trigger. The last part is not decoration: a
 * keyboard user whose focus is dropped on the body has to tab from the
 * top of the document to get back, which is what P8 means by a
 * frequent path staying keyboard-reachable.
 */
/**
 * K90: opt-in server-side search for a picker whose option list is a
 * config list too large to fetch whole (milestones, sprints, users,
 * projects). When supplied, the dropdown grows a text input and the
 * *candidate* options come from `onQuery(q)` rather than the static
 * `options` prop — so a workspace past the 1000-row fetch window is
 * fully reachable by typing. `options` still carries the CURRENT value's
 * option (and any the caller always wants shown) so a selected value
 * outside the current results stays displayable, per P3/XS-27.
 */
export interface OptionSearch {
  /** Returns the options matching `q` (already mapped to PickerOption). */
  readonly onQuery: (q: string) => Promise<readonly PickerOption[]>;
  readonly placeholder?: string;
}

export function OptionPicker({
  label,
  value,
  options,
  onSelect,
  onClear,
  clearLabel,
  emptyText = "—",
  disabledReason,
  errorId,
  search,
}: {
  /** The field's own label, for the trigger's accessible name. */
  readonly label: string;
  /** The stored key, or undefined when unset. */
  readonly value: string | undefined;
  /**
   * The options to show. In static mode this is the whole list. In
   * search mode (see `search`) it need only carry the current value's
   * option so it stays displayable; the candidate list comes from the
   * query.
   */
  readonly options: readonly PickerOption[];
  readonly onSelect: (key: string) => void;
  /** Omit to make the field non-clearable. */
  readonly onClear?: (() => void) | undefined;
  readonly clearLabel?: string;
  readonly emptyText?: string;
  /**
   * Why a given option cannot be picked, rendered once under the list.
   * Archived entities are the only current use.
   */
  readonly disabledReason?: string;
  /** K90: opt-in server-side search. Omit for the static list behavior. */
  readonly search?: OptionSearch | undefined;
  /**
   * A11Y-23: the id of the error text for this field, when the form
   * has rejected it.
   *
   * The picker's trigger is a `button`, not an `input`, so nothing
   * associates it with an error message by default. Setting
   * `aria-invalid` and `aria-describedby` here is what makes a screen
   * reader read the rule when focus lands on the trigger — the case's
   * first two bullets — rather than only at the moment the red text
   * appeared.
   */
  readonly errorId?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // K90: server results for the current (debounced) query, or null while
  // a query is in flight / before the first fetch. Only used in search
  // mode.
  const [results, setResults] = useState<readonly PickerOption[] | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // K90: debounce the query and fetch candidates when in search mode and
  // open. A blank query fetches the first page (the browse view).
  const trimmedQuery = query.trim();
  useEffect(() => {
    if (search === undefined || !open) return undefined;
    let cancelled = false;
    setResults(null);
    const t = setTimeout(() => {
      void search.onQuery(trimmedQuery)
        .then(rows => { if (!cancelled) setResults(rows); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, open, trimmedQuery]);

  // Focus the search box when the list opens in search mode.
  useEffect(() => {
    if (open && search !== undefined) searchInputRef.current?.focus();
  }, [open, search]);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    setQuery("");
    // TSK-41's third bullet. Only on a deliberate close — on an
    // outside click the user has already moved focus somewhere they
    // chose, and yanking it back would be worse than leaving it.
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (
        listRef.current?.contains(t) !== true &&
        triggerRef.current?.contains(t) !== true
      ) {
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

  const current = options.find(o => o.key === value);
  // Set, but the config no longer declares it. TSK-30, XS-27, and the
  // status/priority equivalents all land here. Rendering the raw key
  // would violate P3; rendering nothing would lose the fact that the
  // file holds a value.
  const unrecognized = value !== undefined && current === undefined;

  // The candidate list the dropdown renders. Static mode: the `options`
  // prop. Search mode: the server `results` (null until the first fetch
  // returns), with the current value's option merged in when the query
  // did not return it — so a selected value (including an archived one,
  // which must stay present-but-disabled: TSK-10/TSK-33) never vanishes
  // from the list, and it keeps its `aria-selected` marker.
  const listOptions: readonly PickerOption[] = (() => {
    if (search === undefined) return options;
    const rows = results ?? [];
    if (current === undefined || rows.some(o => o.key === current.key)) return rows;
    return [current, ...rows];
  })();
  const searchLoading = search !== undefined && results === null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid={`meta-edit-${fieldSlug(label)}`}
        aria-label={`${label}: ${current?.label ?? (unrecognized ? value : "not set")}. Change`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={errorId !== undefined}
        aria-describedby={errorId}
        onClick={() => { setOpen(o => !o); }}
        // Affordance: these meta fields are editable dropdowns, but with
        // only a hover-bg they read as static text at rest (Ken's report —
        // "fields that are meant to be dropdowns don't look like dropdowns").
        // `group` + cursor-pointer + a hover border/bg + an always-present
        // chevron (aria-hidden; `aria-haspopup` already carries the
        // semantics for AT) make it legible as a control without turning it
        // into a heavy form <select>. The chevron sits at low opacity at
        // rest and strengthens on hover/open.
        className="group -mx-1 flex w-full items-center gap-1 rounded border border-transparent px-1 py-0.5 text-left text-[0.9286rem] text-text-primary hover:cursor-pointer hover:border-border-subtle hover:bg-bg-muted aria-expanded:border-border-subtle aria-expanded:bg-bg-muted"
      >
        <span className="min-w-0 flex-1">
        {current !== undefined ? (
          <span className="inline-flex items-center gap-1.5">
            {current.color !== undefined && (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: current.color }}
              />
            )}
            <span className="break-words">{current.label}</span>
            {current.suffix !== undefined && (
              <span className="text-text-tertiary">{current.suffix}</span>
            )}
          </span>
        ) : unrecognized ? (
          // Flagged, and the stored value shown, because the user has
          // to know *which* value to fix. "Unrecognized" alone would
          // send them to the file to find out what it says.
          <span data-testid={`meta-unrecognized-${fieldSlug(label)}`} className="text-warn-fg">
            {value} — not in the current config
          </span>
        ) : (
          <span className="text-text-tertiary">{emptyText}</span>
        )}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="h-3 w-3 shrink-0 text-text-tertiary opacity-50 transition-[transform,opacity] group-hover:opacity-100 group-aria-expanded:rotate-180 group-aria-expanded:opacity-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          data-testid={`meta-options-${fieldSlug(label)}`}
          className="absolute right-0 z-20 mt-1 max-h-64 min-w-[200px] overflow-auto rounded-md border border-border-subtle bg-bg-surface py-1 shadow-lg"
        >
          {search !== undefined && (
            <input
              ref={searchInputRef}
              type="text"
              aria-label={`Search ${label.toLowerCase()}`}
              data-testid={`meta-search-${fieldSlug(label)}`}
              value={query}
              onChange={e => { setQuery(e.target.value); }}
              placeholder={search.placeholder ?? "Search…"}
              className="mb-1 w-[calc(100%-0.5rem)] mx-1 rounded border border-border-subtle bg-bg-canvas px-1.5 py-1 text-[0.8571rem] text-text-primary"
            />
          )}
          {onClear !== undefined && value !== undefined && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { onClear(); close(true); }}
              className="block w-full px-3 py-1.5 text-left text-[0.9286rem] text-text-tertiary hover:bg-bg-muted"
            >
              {clearLabel ?? `Clear ${label.toLowerCase()}`}
            </button>
          )}
          {searchLoading && (
            <p className="px-3 py-1.5 text-[0.8571rem] text-text-tertiary">Searching…</p>
          )}
          {search !== undefined && !searchLoading && listOptions.length === 0 && (
            <p className="px-3 py-1.5 text-[0.8571rem] text-text-tertiary">No matches.</p>
          )}
          {listOptions.map(opt => (
            <button
              key={opt.key}
              type="button"
              role="option"
              aria-selected={opt.key === value}
              disabled={opt.disabled === true}
              // The archived option is present and named, so the user
              // learns the entity exists and is archived rather than
              // wondering where it went (P7).
              title={opt.disabled === true ? disabledReason : undefined}
              onClick={() => {
                if (opt.disabled === true) return;
                onSelect(opt.key);
                close(true);
              }}
              className={
                "block w-full px-3 py-1.5 text-left text-[0.9286rem] " +
                (opt.disabled === true
                  ? "cursor-not-allowed text-text-tertiary opacity-60"
                  : "text-text-primary hover:bg-bg-muted")
              }
            >
              <span className="inline-flex items-center gap-1.5">
                {opt.color !== undefined && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                {opt.label}
                {opt.suffix !== undefined && (
                  <span className="text-text-tertiary">{opt.suffix}</span>
                )}
                {opt.hint !== undefined && (
                  <span className="text-[0.7857rem] text-text-tertiary">
                    {opt.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
          {disabledReason !== undefined && listOptions.some(o => o.disabled === true) && (
            <p className="border-t border-border-subtle px-3 pb-1 pt-1.5 text-[0.7857rem] text-text-tertiary">
              {disabledReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Stable test/DOM id from a field label ("Start date" → "start-date"). */
export function fieldSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
