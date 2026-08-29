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

export const ALL_COLUMNS: readonly ColumnDef[] = [
  { id: "key", label: "Key", sortable: true },
  { id: "project", label: "Project", sortable: true },
  { id: "title", label: "Title", sortable: true },
  { id: "status", label: "Status", sortable: true },
  { id: "priority", label: "Priority", sortable: true },
  { id: "task_type", label: "Type", sortable: true },
  { id: "assignee", label: "Assignee", sortable: true },
  { id: "labels", label: "Labels", sortable: false },
  { id: "due_date", label: "Due", sortable: true },
  { id: "updated_at", label: "Updated", sortable: true },
];

/** Default visible column order when the user has no saved preference. */
export const DEFAULT_COLUMN_ORDER: readonly string[] = ALL_COLUMNS.map(c => c.id);

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
 */
export function resolveColumns(settings: UserSettings | undefined): readonly ColumnDef[] {
  const byId = new Map(ALL_COLUMNS.map(c => [c.id, c]));
  const raw = (settings as { list_columns?: unknown } | undefined)?.list_columns;
  if (Array.isArray(raw)) {
    const resolved = raw
      .filter((id): id is string => typeof id === "string")
      .map(id => byId.get(id))
      .filter((c): c is ColumnDef => c !== undefined);
    if (resolved.length > 0) return resolved;
  }
  return ALL_COLUMNS;
}

