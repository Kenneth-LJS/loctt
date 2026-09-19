import { useState } from "react";

import { Checkbox } from "../ui/Checkbox.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu } from "../ui/Menu.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * Option count at which the dropdown grows a search box.
 *
 * MSL-19 names forty labels as the case; twelve is where scanning
 * starts to cost more than typing.
 */
const TYPEAHEAD_THRESHOLD = 12;

/** One selectable option in a filter dropdown. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/**
 * A single multi-select filter dropdown (Project, Status, …). Shows
 * its label plus an active-count suffix, and a checkable list. Toggling
 * an option calls `onChange` with the next selected set; the parent
 * owns state (it lives in the URL), so this component is controlled and
 * stateless beyond the menu's open/closed.
 */
export function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  matchToggle,
  unavailable = false,
}: {
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
  /**
   * Optional control rendered at the top of the open panel — used by the
   * labels facet for its All/Any match toggle (LST-40/MSL-7). Shown only
   * when the caller supplies it (e.g. when 2+ values are selected).
   */
  readonly matchToggle?: React.ReactNode;
  /**
   * The options could not be loaded, as opposed to there being none.
   *
   * The M1 gate found (F4) that a `labels.yaml` broken by hand left
   * this reading "No options" — presenting a broken config as an empty
   * one, which is the same conflation ERR-1 forbids of the list. An
   * absence and a failure must not look alike here either.
   */
  readonly unavailable?: boolean;
}) {
  const selectedSet = new Set(selected);
  const count = selected.length;
  /**
   * Typeahead, once the list is long enough to need it (MSL-19).
   *
   * Forty labels in an unfiltered dropdown is a scroll hunt. Below the
   * threshold the box is noise — the whole list already fits — so it
   * appears only where it earns its place.
   */
  const [filter, setFilter] = useState("");
  const searchable = options.length >= TYPEAHEAD_THRESHOLD;
  const shown = searchable && filter.trim() !== ""
    ? options.filter(o => o.label.toLowerCase().includes(filter.trim().toLowerCase()))
    : options;

  const toggle = (value: string): void => {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  };

  return (
    <Menu
      aria-label={`Filter by ${label}`}
      trigger={({ toggle: toggleMenu, ...aria }) => (
        <button
          type="button"
          onClick={toggleMenu}
          aria-label={`Filter ${label}`}
          className={[
            "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[0.9286rem]",
            count > 0
              ? "border-accent bg-accent-muted text-accent"
              : "border-border-default bg-bg-surface text-text-secondary hover:bg-bg-muted",
          ].join(" ")}
          {...aria}
        >
          {label}
          {count > 0 ? <span className="tabular-nums">· {count}</span> : null}
          <Icon name="chevronDown" size={12} className="text-text-tertiary" />
        </button>
      )}
    >
      {() => (
        <>
        {searchable && (
          <div className="border-b border-border-subtle p-1.5">
            {/* B1 migration: the hand-rolled search input becomes the
                shared TextField (sm) so it focuses like every other input
                (the global :focus-visible ring) and its placeholder clears
                AA via the §2.4 token fix. */}
            <TextField
              type="search"
              size="sm"
              aria-label={`Search ${label}`}
              placeholder={`Search ${label.toLowerCase()}…`}
              value={filter}
              onChange={e => { setFilter(e.target.value); }}
            />
          </div>
        )}
        {matchToggle !== undefined && (
          <div className="border-b border-border-subtle p-1.5">
            {matchToggle}
          </div>
        )}
        <div className="max-h-[320px] min-w-[200px] overflow-y-auto">
          {shown.length === 0 ? (
            <div className="px-3 py-2 text-[0.8571rem] italic text-text-tertiary">
              {unavailable
                ? `${label} options could not be loaded — see the sidebar for why.`
                : "No options"}
            </div>
          ) : (
            shown.map(opt => {
              const isSelected = selectedSet.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isSelected}
                  onClick={() => toggle(opt.value)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.9286rem] text-text-secondary hover:bg-bg-muted hover:text-text-primary"
                >
                  {/* LST-56 (UX-4): the multi-select affordance is a real
                      B1 Checkbox, shown *unchecked* before the first
                      click — an empty box reads as clickable, where the
                      old empty `<span>` was simply blank and gave no cue
                      the list was multi-select. The `<button>` owns the
                      toggle and the `aria-checked` state, so the checkbox
                      is a non-interactive visual mirror: `tabIndex={-1}`
                      and `aria-hidden` keep it out of the tab order and
                      off the a11y tree (the menuitemcheckbox already
                      announces checked-ness), and `pointer-events-none`
                      lets the click fall through to the button. */}
                  <Checkbox
                    checked={isSelected}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                    className="pointer-events-none"
                  />
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })
          )}
        </div>
        </>
      )}
    </Menu>
  );
}
