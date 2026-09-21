import type { ArchivedScope } from "@loctt/contracts";

import { cn } from "./cn.ts";
import { Select, type SelectSize } from "./Select.tsx";

/**
 * The one tri-state "archived scope" control (K107). Every archivable
 * list — the task list's FilterBar and the Sprints/Users/Milestones/
 * Labels/Projects/Saved-views panels — reveals archived entities through
 * this one control instead of the two hand-rolled boolean "Show archived"
 * checkboxes that drifted before (SprintsPanel/UsersPanel had one;
 * Milestones/Labels/Projects/Views had none — K107 adds it everywhere).
 *
 * `active` (the default everywhere) hides archived; `archived` shows only
 * archived; `all` shows both — the same three values core's
 * `applyArchivedScope` / the task list's `archivedScope` understand, so the
 * control's value flows straight to the server's `?archived=` param.
 *
 * It is a labelled native `<select>` rather than a segmented radiogroup:
 * the set is a fixed three, a `<select>` is natively accessible (a real
 * `name`/label association, keyboard-operable) and reuses the themed
 * `Select` primitive, so it inherits the app's border/radius/focus tokens
 * with no raw hex. The visible label is associated by `htmlFor`, so the
 * count-carrying variant ("Archived (3)") stays readable to a screen
 * reader.
 */

/** The label rendered for each scope in the dropdown. */
const SCOPE_LABEL: Record<ArchivedScope, string> = {
  active: "Active",
  archived: "Archived",
  all: "All",
};

/** The three scopes in the order they appear in the dropdown. */
const SCOPE_ORDER: readonly ArchivedScope[] = ["active", "archived", "all"];

export interface ArchivedScopeControlProps {
  readonly value: ArchivedScope;
  readonly onChange: (scope: ArchivedScope) => void;
  /**
   * Optional per-scope count suffixes, e.g. `{ archived: 3 }` renders the
   * option as "Archived (3)". Only shown for scopes present in the map.
   */
  readonly counts?: Partial<Record<ArchivedScope, number>>;
  /** Visible label to the left of the control. Defaults to "Show". */
  readonly label?: string;
  readonly size?: SelectSize;
  /** The select's `data-testid`; defaults to `archived-scope`. */
  readonly testId?: string;
  /**
   * A stable id for the `<select>` so the visible label's `htmlFor` can
   * point at it. Defaults to a value derived from `testId`, which is
   * unique per surface (each surface passes its own testId).
   */
  readonly id?: string;
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

export function ArchivedScopeControl({
  value,
  onChange,
  counts,
  label = "Show",
  size = "sm",
  testId = "archived-scope",
  id,
  className,
}: ArchivedScopeControlProps) {
  const selectId = id ?? `${testId}-select`;
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <label htmlFor={selectId} className="text-label text-text-secondary">
        {label}
      </label>
      <Select
        id={selectId}
        size={size}
        value={value}
        data-testid={testId}
        aria-label="Archived scope"
        onChange={e => { onChange(e.target.value as ArchivedScope); }}
      >
        {SCOPE_ORDER.map(scope => {
          const count = counts?.[scope];
          return (
            <option key={scope} value={scope}>
              {count !== undefined ? `${SCOPE_LABEL[scope]} (${String(count)})` : SCOPE_LABEL[scope]}
            </option>
          );
        })}
      </Select>
    </div>
  );
}
