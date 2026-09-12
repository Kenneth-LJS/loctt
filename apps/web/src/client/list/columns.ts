import type { UserSettings } from "@loctt/contracts";

/**
 * The list table's column model. `id` doubles as the sort field key
 * sent to `/api/tasks?sort=…` (so a header is sortable iff the server
 * can sort by that field). `label` is the header text; `sortable`
 * gates the click-to-sort affordance (labels and the multi-valued
 * columns aren't meaningfully single-sortable).
 */
export interface ColumnDef {
  readonly id: string;
  readonly label: string;
  readonly sortable: boolean;
}

/**
 * The catalog of every column a user *can* show. Order here is the
 * canonical left-to-right order used to place any column the user adds.
 *
 * `reporter` lives in the catalog (so the settings editor offers it and
 * PRU-25's degraded-reporter cell has somewhere to render) but is NOT
 * in the default set below — K24: reporter is opt-in, not a default
 * column. LST-2 enumerates the default list as exactly ten columns
 * without reporter, and an eleventh column pushed the table into
 * horizontal overflow (LST-20). A user adds reporter via `list_columns`.
 */
export const ALL_COLUMNS: readonly ColumnDef[] = [
  { id: "key", label: "Key", sortable: true },
  { id: "project", label: "Project", sortable: true },
  { id: "title", label: "Title", sortable: true },
  { id: "status", label: "Status", sortable: true },
  { id: "priority", label: "Priority", sortable: true },
  { id: "task_type", label: "Type", sortable: true },
  { id: "assignee", label: "Assignee", sortable: true },
  { id: "reporter", label: "Reporter", sortable: true },
  { id: "labels", label: "Labels", sortable: false },
  { id: "due_date", label: "Due", sortable: true },
  { id: "estimate", label: "Estimate", sortable: true },
  { id: "updated_at", label: "Updated", sortable: true },
];

/**
 * The columns shown when the user has no saved `list_columns`. These
 * are LST-2's exact ten, in order — every catalog column except
 * `reporter` (K24) and `estimate` (SET-9: estimate is opt-in like
 * reporter, and would otherwise be an eleventh default column, the
 * overflow LST-20 forbids). Kept as its own list, not derived by a bare
 * `ALL_COLUMNS` filter beyond these two exclusions, so adding a future
 * catalog column does not silently change the default view.
 */
export const DEFAULT_COLUMNS: readonly ColumnDef[] = ALL_COLUMNS.filter(
  c => c.id !== "reporter" && c.id !== "estimate",
);

/**
 * How the active project filter should affect the project column.
 *
 * PRU-3: the project column is only informative when rows can differ
 * in it. With exactly one project scoped, it is constant, so it is
 * hidden; in "all projects" mode (nothing scoped, or several scoped)
 * it is shown so two same-titled tasks in different projects are
 * distinguishable.
 *
 * `activeProjectCount` is the number of projects in the URL's
 * `?project=` filter — `search.project?.length ?? 0`. `0` and any
 * value `> 1` are both "all projects" for this purpose; only exactly
 * `1` is a single-project scope.
 */
export interface ColumnScope {
  readonly activeProjectCount: number;
}

/**
 * Resolves the visible, ordered columns for the current user.
 *
 * `UserSettings.list_columns` (when present) is an ordered array of
 * column ids — visibility AND order in one list, so a column absent
 * from it is hidden. We validate each id against the known columns and
 * drop unknowns (a stale setting referencing a removed column
 * shouldn't break the table). An empty or missing setting falls back
 * to the default order. The settings *editor* lives in M4; this is the
 * read side.
 *
 * `scope` applies PRU-3's automatic show/hide of the `project` column
 * *on top of* the resolved order, without mutating the saved order —
 * the result is derived per render. A single-project scope drops the
 * column; all-projects mode ensures it is present even when the user
 * has removed it from `list_columns`, because PRU-3 requires it to
 * "appear without the user having to add it via column settings".
 */
export function resolveColumns(
  settings: UserSettings | undefined,
  scope?: ColumnScope,
  /**
   * SET-9: whether estimation is enabled in the workflow. When it is
   * not, the `estimate` column is dropped from whatever this resolves —
   * default set, or a saved `list_columns` that names it — so a
   * workspace with estimation off never shows an Estimate column (the
   * same "nothing appears anywhere" rule the create modal and task
   * detail follow). Defaults to `true` so callers that do not thread the
   * workflow (and the estimation-on case) are unaffected.
   */
  estimationEnabled = true,
): readonly ColumnDef[] {
  // Resolve ids against the full catalog so an explicit list_columns
  // may name `reporter` (opt-in, K24); the *default* base is the ten
  // DEFAULT_COLUMNS, which omit it.
  const byId = new Map(ALL_COLUMNS.map(c => [c.id, c]));
  const raw = (settings as { list_columns?: unknown } | undefined)?.list_columns;
  let base: readonly ColumnDef[] = DEFAULT_COLUMNS;
  // Whether the user set their own columns. K19: the auto-insert of
  // the project column in all-projects mode is a default-only help —
  // an explicit list is honored verbatim and never gains a column the
  // user did not list. (A single-project scope still *hides* it, since
  // a constant column carries no information either way.)
  let explicitColumns = false;
  if (Array.isArray(raw)) {
    const resolved = raw
      .filter((id): id is string => typeof id === "string")
      .map(id => byId.get(id))
      .filter((c): c is ColumnDef => c !== undefined);
    if (resolved.length > 0) { base = resolved; explicitColumns = true; }
  }
  // SET-9: estimation off ⇒ no Estimate column, even if list_columns
  // names it (it may have been added while estimation was on).
  if (!estimationEnabled) base = base.filter(c => c.id !== "estimate");
  return applyProjectScope(base, scope, explicitColumns);
}

/**
 * The index of `project` in the canonical `ALL_COLUMNS` order, used to
 * place an auto-shown project column where the user would expect it
 * (after `key`) rather than appended at the end.
 */
const PROJECT_CANONICAL_INDEX = ALL_COLUMNS.findIndex(c => c.id === "project");

/**
 * Auto show/hide the project column per the active scope (PRU-3).
 *
 * Returns `base` unchanged when no scope is given (callers that do not
 * care about scoping — e.g. a settings editor — get the raw resolved
 * order). Otherwise:
 *
 * - single project (`activeProjectCount === 1`) → the project column
 *   is removed if present;
 * - all projects → the project column is inserted if absent, at the
 *   position nearest its canonical slot given the columns actually
 *   visible, so a user who reordered the rest keeps their order and
 *   only gains the one column.
 */
function applyProjectScope(
  base: readonly ColumnDef[],
  scope: ColumnScope | undefined,
  explicitColumns: boolean,
): readonly ColumnDef[] {
  if (scope === undefined) return base;
  const projectDef = ALL_COLUMNS.find(c => c.id === "project");
  if (projectDef === undefined) return base;

  const hasProject = base.some(c => c.id === "project");

  if (scope.activeProjectCount === 1) {
    return hasProject ? base.filter(c => c.id !== "project") : base;
  }

  // All-projects mode: ensure the column is present — but only for a
  // user on the default column set. K19: an explicit list_columns is
  // never overridden by this auto-insert.
  if (hasProject || explicitColumns) return base;
  // Insert before the first column whose canonical index is greater
  // than project's, so it lands just after `key` in the default order
  // and stays sensibly placed even if the user reordered other
  // columns. Appended only if no such column exists.
  const canonicalIndex = new Map(ALL_COLUMNS.map((c, i) => [c.id, i]));
  const insertAt = base.findIndex(
    c => (canonicalIndex.get(c.id) ?? Number.POSITIVE_INFINITY) > PROJECT_CANONICAL_INDEX,
  );
  if (insertAt === -1) return [...base, projectDef];
  return [...base.slice(0, insertAt), projectDef, ...base.slice(insertAt)];
}

