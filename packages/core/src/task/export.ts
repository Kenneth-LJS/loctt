import type { Task, TaskFrontmatter } from "@loctt/contracts";

/**
 * Built-in fields that are exported by default when the caller doesn't
 * specify a column list. Custom fields are excluded by default — they
 * vary per project and would produce sparse columns.
 */
export const DEFAULT_EXPORT_COLUMNS: readonly string[] = [
  "key",
  "id",
  "title",
  "project",
  "status",
  "priority",
  "task_type",
  "labels",
  "assignee",
  "reporter",
  "start_date",
  "due_date",
  "estimate",
  "milestone",
  "sprint",
  "completed_date",
  "created_at",
  "updated_at",
];

export interface ExportOptions {
  /** Explicit column list (built-in field names or `fields.<custom>`). */
  readonly columns?: readonly string[];
  /** Include the body in JSON output and as a `body` column in CSV. */
  readonly includeBody?: boolean;
}

function getColumnValue(t: Task, column: string): unknown {
  if (column === "body") return t.body;
  if (column.startsWith("fields.")) {
    return t.frontmatter.fields?.[column.slice("fields.".length)];
  }
  const fm = t.frontmatter as unknown as Record<string, unknown>;
  return fm[column];
}

/**
 * Serializes the given tasks to JSON. The output is an array of objects,
 * one per task, with the requested columns. Field values are emitted
 * verbatim (preserving arrays, booleans, etc.) — JSON callers want the
 * native shape, not the CSV string form.
 */
export function exportTasksToJSON(
  tasks: readonly Task[],
  options: ExportOptions = {},
): string {
  const columns = options.columns ?? DEFAULT_EXPORT_COLUMNS;
  const rows = tasks.map(t => {
    const row: Record<string, unknown> = {};
    for (const c of columns) {
      const v = getColumnValue(t, c);
      if (v !== undefined) row[c] = v;
    }
    if (options.includeBody) row["body"] = t.body;
    return row;
  });
  return JSON.stringify(rows, null, 2);
}

/**
 * Escapes a single CSV field per RFC 4180: doubled quotes, wrapped in
 * quotes if the value contains a quote/comma/newline.
 */
function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return csvEscape(value.map(v => String(v)).join(","));
  }
  if (typeof value === "object") return csvEscape(JSON.stringify(value));
  return csvEscape(String(value));
}

/**
 * Serializes the given tasks to CSV (RFC 4180). The first row is the
 * header — column names as given. Array-valued cells (labels, multi
 * custom fields) are joined with commas inside their quoted cell.
 */
export function exportTasksToCSV(
  tasks: readonly Task[],
  options: ExportOptions = {},
): string {
  const columns = [...(options.columns ?? DEFAULT_EXPORT_COLUMNS)];
  if (options.includeBody && !columns.includes("body")) columns.push("body");
  const lines: string[] = [];
  lines.push(columns.map(c => csvEscape(c)).join(","));
  for (const t of tasks) {
    const cells = columns.map(c => csvCell(getColumnValue(t, c)));
    lines.push(cells.join(","));
  }
  return lines.join("\n") + "\n";
}

/**
 * Helper: filter a task list by archived flag for export. Most export
 * callers want active-only by default; pass includeArchived to override.
 */
export function filterForExport(
  tasks: readonly Task[],
  includeArchived: boolean,
): Task[] {
  if (includeArchived) return [...tasks];
  return tasks.filter(t => !(t.frontmatter as TaskFrontmatter).archived);
}
