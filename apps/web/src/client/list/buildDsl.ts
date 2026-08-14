import type { ListSearch } from "../router/listSearch.ts";

/**
 * Builds a LocTT query-DSL string from the active list filters, for
 * saving the current view (M1.3 "Save as view"). This mirrors the
 * server's structured-filter → DSL translation so a saved view
 * reproduces exactly what the filter bar currently shows.
 *
 * Each multi-value facet becomes `field = a` or `field in [a, b]`;
 * facets are AND-ed; the free-text `q` (already DSL) is wrapped in
 * parens and AND-ed in; custom `field.<key>` filters map to
 * `fields.<key>`. Values flow through {@link dslAtom} so an id/key can
 * never inject query structure.
 */

const FACET_TO_FIELD: Readonly<Record<string, string>> = {
  project: "project",
  status: "status",
  priority: "priority",
  type: "task_type",
  assignee: "assignee",
  reporter: "reporter",
  labels: "labels",
  milestone: "milestone",
  sprint: "sprint",
};

/** Bare identifiers pass through; everything else is quoted + escaped. */
export function dslAtom(value: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clause(field: string, values: readonly string[]): string | null {
  const v = values.map(s => s.trim()).filter(Boolean);
  const first = v[0];
  if (first === undefined) return null;
  if (v.length === 1) return `${field} = ${dslAtom(first)}`;
  return `${field} in [${v.map(dslAtom).join(", ")}]`;
}

export function buildDslFromSearch(search: Partial<ListSearch>): string {
  const clauses: string[] = [];
  if (typeof search.q === "string" && search.q.trim().length > 0) {
    clauses.push(`(${search.q})`);
  }
  const bag = search as Record<string, unknown>;
  for (const [facet, field] of Object.entries(FACET_TO_FIELD)) {
    const v = bag[facet];
    if (Array.isArray(v)) {
      const c = clause(field, v.filter((x): x is string => typeof x === "string"));
      if (c) clauses.push(c);
    }
  }
  for (const [k, v] of Object.entries(search)) {
    if (k.startsWith("field.") && k.length > "field.".length) {
      const list = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? v.split(",") : [];
      const c = clause(`fields.${k.slice("field.".length)}`, list);
      if (c) clauses.push(c);
    }
  }
  if (search.archived !== true) {
    // Mirror the default "open" semantics — a saved view that omitted
    // this would surface archived tasks when re-run.
    clauses.push("archived != true");
  }
  return clauses.length > 0 ? clauses.join(" and ") : "archived != true";
}
