import { useState } from "react";

import { Menu } from "../ui/Menu.tsx";

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
  unavailable = false,
}: {
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
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
            "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[13px]",
            count > 0
              ? "border-accent bg-accent-muted text-accent"
              : "border-border-default bg-bg-surface text-text-secondary hover:bg-bg-muted",
          ].join(" ")}
          {...aria}
        >
          {label}
          {count > 0 ? <span className="tabular-nums">· {count}</span> : null}
          <span className="text-[10px] text-text-tertiary">▾</span>
        </button>
      )}
    >
      {() => (
        <>
        {searchable && (
          <div className="border-b border-border-subtle p-1.5">
            <input
              type="search"
              aria-label={`Search ${label}`}
              placeholder={`Search ${label.toLowerCase()}…`}
              value={filter}
              onChange={e => { setFilter(e.target.value); }}
              className="h-7 w-full rounded border border-border-subtle bg-bg-canvas px-2 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
            />
          </div>
        )}
        <div className="max-h-[320px] min-w-[200px] overflow-y-auto">
          {shown.length === 0 ? (
            <div className="px-3 py-2 text-[12px] italic text-text-tertiary">
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
                  className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-bg-muted hover:text-text-primary"
                >
                  <span className="grid h-4 w-4 place-items-center text-accent">
                    {isSelected ? "✓" : ""}
                  </span>
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
