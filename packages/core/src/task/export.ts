import type { Task } from "@loctt/contracts";

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
 *
 * Also neutralises spreadsheet formula injection. Excel, Numbers and
 * LibreOffice treat a cell beginning `=`, `+`, `-` or `@` as a formula
 * and evaluate it on open — so a task titled `=cmd|'/c calc'!A1`
 * executes on the machine of whoever opens the export. RFC 4180
 * quoting does not help: the quotes are stripped before the cell is
 * parsed.
 *
 * A leading apostrophe is the standard neutraliser — spreadsheets read
 * it as "this is text", show the value unchanged, and never evaluate
 * it. Tab and carriage return are included because they are stripped
 * before the formula check, so `\t=cmd` would otherwise slip through.
 */
function csvEscape(s: string): string {
  const value = /^[\t\r ]*[=+\-@]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    // A plain comma join is ambiguous the moment an element contains a
    // comma: `["a,b", "c"]` becomes `a,b,c`, which reimports as three
    // values (BLK-33). Elements that could be confused with the
    // separator are JSON-quoted so the boundary survives a round trip;
    // ordinary values stay bare, so the common case still reads as
    // `bug,ui` in a spreadsheet.
    const needsQuoting = value.some(
      v => typeof v === "string" && /[",]/.test(v),
    );
    const parts = value.map(v => {
      const s = primitiveString(v);
      return needsQuoting ? JSON.stringify(s) : s;
    });
    return csvEscape(parts.join(","));
  }
  if (typeof value === "object") return csvEscape(JSON.stringify(value));
  return csvEscape(primitiveString(value));
}

function primitiveString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return v.toString();
  // Symbols and functions don't have a meaningful CSV form — JSON-encode
  // so callers can spot the value rather than getting "[object Object]".
  return JSON.stringify(v) ?? "";
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
  return tasks.filter(t => !(t.frontmatter).archived);
}
