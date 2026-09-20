import {
  Combobox,
  type ComboboxOption,
  type ComboboxSearch,
} from "../../ui/Combobox.tsx";

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
export type PickerOption = ComboboxOption;

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
export type OptionSearch = ComboboxSearch;

/**
 * The inline meta-field editor: a trigger that reads as the field's
 * value at rest, opening the shared searchable listbox (`ui/Combobox`).
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
 * ## What lives here vs. in Combobox
 *
 * Only the trigger — the value-as-text rendering, the "not in the
 * current config" flag, the `meta-edit-*` testid and the A11Y-23 error
 * wiring. The list, the search (server-side via `search`, client-side
 * once a static list passes the threshold — so a 30-value custom enum is
 * typeable without the caller doing anything), the keyboard model and
 * Escape-returns-focus (TSK-41) are the primitive's (A211).
 */
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
  const slug = fieldSlug(label);
  const current = options.find(o => o.key === value);
  // Set, but the config no longer declares it. TSK-30, XS-27, and the
  // status/priority equivalents all land here. Rendering the raw key
  // would violate P3; rendering nothing would lose the fact that the
  // file holds a value.
  const unrecognized = value !== undefined && current === undefined;

  return (
    <Combobox
      label={label}
      options={options}
      value={value}
      onSelect={onSelect}
      clear={onClear === undefined
        ? undefined
        : { label: clearLabel ?? `Clear ${label.toLowerCase()}`, onClear }}
      search={search}
      disabledReason={disabledReason}
      listTestId={`meta-options-${slug}`}
      searchTestId={`meta-search-${slug}`}
      align="end"
      trigger={({ ref, open, toggle, ...aria }) => (
        <button
          ref={ref}
          type="button"
          data-testid={`meta-edit-${slug}`}
          aria-label={`${label}: ${current?.label ?? (unrecognized ? value : "not set")}. Change`}
          {...aria}
          aria-invalid={errorId !== undefined}
          aria-describedby={errorId}
          onClick={toggle}
          // Affordance: these meta fields are editable dropdowns, but with
          // only a hover-bg they read as static text at rest (Ken's report —
          // "fields that are meant to be dropdowns don't look like dropdowns").
          // `group` + cursor-pointer + a hover border/bg + an always-present
          // chevron (aria-hidden; `aria-haspopup` already carries the
          // semantics for AT) make it legible as a control without turning it
          // into a heavy form <select>. The chevron sits at low opacity at
          // rest and strengthens on hover/open.
          className="group -mx-1 flex min-h-7 w-full items-center gap-1 rounded border border-transparent px-1 py-0.5 text-left text-[0.9286rem] text-text-primary hover:cursor-pointer hover:border-border-subtle hover:bg-bg-muted aria-expanded:border-border-subtle aria-expanded:bg-bg-muted"
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
              <span data-testid={`meta-unrecognized-${slug}`} className="text-warn-fg">
                {value} — not in the current config
              </span>
            ) : (
              <span className="text-text-tertiary">{emptyText}</span>
            )}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={
              "h-3 w-3 shrink-0 text-text-tertiary opacity-50 transition-[transform,opacity] group-hover:opacity-100 " +
              (open ? "rotate-180 opacity-100" : "")
            }
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </button>
      )}
    />
  );
}

/** Stable test/DOM id from a field label ("Start date" → "start-date"). */
export function fieldSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
