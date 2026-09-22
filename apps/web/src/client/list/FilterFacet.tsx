import { Dropdown, type DropdownOption } from "../ui/Dropdown.tsx";
import { Icon } from "../ui/Icon.tsx";

/**
 * A single multi-select filter facet (Project, Status, …) — the pill in
 * the list toolbar and the checkable panel it opens.
 *
 * ## What this is, after K106 stage 2
 *
 * This used to be `list/FilterDropdown`, a *second* dropdown
 * implementation built on `ui/Menu` while every other picker in the app
 * was built on `ui/Combobox`. K106 merged the two into `ui/Dropdown`, so
 * what is left here is the facet's own concerns — the toolbar pill, the
 * active count, the "Remove this filter" row, and the
 * absence-vs-failure empty text — over the shared primitive in
 * `mode="menu"`.
 *
 * `mode="menu"` is not decoration. The panel renders `role="menu"` with
 * `menuitemcheckbox` rows and real roving DOM focus, which is the
 * contract A11Y-10 asserts (first row focused on open, ArrowDown moves
 * it) and which roughly thirty `tests/ui/` assertions read via
 * `getByRole("menuitemcheckbox")`. The listbox modes' focus model —
 * focus parked in the search box with `aria-activedescendant` pointing at
 * the active row — does not satisfy either.
 *
 * The parent owns the selection (it lives in the URL), so this component
 * is controlled and stateless beyond the panel's open/closed.
 */

/** One selectable option in a filter facet. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export function FilterFacet({
  label,
  options,
  selected,
  onChange,
  onRemove,
  matchToggle,
  unavailable = false,
}: {
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
  /**
   * K97: hide this filter from the toolbar (and clear its value). Rendered
   * as a "Remove this filter" row at the foot of the open panel — off the
   * pill itself, which stays a plain open affordance. Absent for facets
   * that are not removable (none today, but the sprint-scope route could
   * withhold the control).
   */
  readonly onRemove?: (() => void) | undefined;
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
  const count = selected.length;
  const selectedSet = new Set(selected);

  return (
    <Dropdown
      mode="menu"
      label={label}
      options={options.map((o): DropdownOption => ({ key: o.value, label: o.label }))}
      selected={selected}
      onToggle={(value, on) => {
        const next = new Set(selectedSet);
        if (on) next.add(value);
        else next.delete(value);
        onChange([...next]);
      }}
      // MSL-19: forty labels in an unfiltered dropdown is a scroll hunt.
      // Left to the shared threshold, so a facet and a picker over the
      // same list become searchable at the same size (A211) — passing
      // `searchable` here would be exactly the drift the merge removes.
      searchLabel={`Search ${label}`}
      searchPlaceholder={`Search ${label.toLowerCase()}…`}
      noMatchesText={
        unavailable
          ? `${label} options could not be loaded — see the sidebar for why.`
          : "No options"
      }
      panelClassName="max-w-[320px]"
      {...(matchToggle === undefined ? {} : { header: matchToggle })}
      {...(onRemove === undefined
        ? {}
        : {
            footer: () => (
              <div className="border-t border-border-subtle p-1">
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`filter-remove-${label}`}
                  onClick={() => { onRemove(); }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-[0.8571rem] text-text-tertiary hover:bg-bg-muted hover:text-text-primary"
                >
                  <Icon name="close" size={12} />
                  Remove this filter
                </button>
              </div>
            ),
          })}
      trigger={({ ref, toggle, ...aria }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
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
    />
  );
}
