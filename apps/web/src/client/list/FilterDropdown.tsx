import { Menu } from "../ui/Menu.tsx";

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
}: {
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const count = selected.length;

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
        <div className="max-h-[320px] min-w-[200px] overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-[12px] italic text-text-tertiary">No options</div>
          ) : (
            options.map(opt => {
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
      )}
    </Menu>
  );
}
