import type { Filter } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { buildFacetOptions, type FacetOptions } from "./facetOptions.ts";
import {
  type CustomFieldLookup,
  resolveFilterRow,
  resolveFilterRows,
  sortFieldLabel,
} from "./filterPreview.tsx";

/**
 * Pure-function tests for the "Save as view" filter preview resolver
 * (A337). `SaveViewDialog.test.tsx` covers the rendered dialog; these
 * pin the resolution logic directly, without mounting React or a query
 * client.
 */

const OPTIONS: FacetOptions = buildFacetOptions({
  projects: [{ id: "p_web", name: "Web Client" }],
  users: [{ id: "u_ken", name: "Ken Loh" }],
  labels: [{ id: "l_bug", name: "bug" }],
  milestones: [{ id: "m_live", name: "Beta launch" }],
  sprints: [{ id: "s1", name: "Sprint 1" }],
  workflow: {
    statuses: [{ key: "backlog", label: "Backlog", category: "pending" }],
    priorities: [{ key: "high", label: "High" }],
    task_types: [],
    relationships: [],
    custom_fields: [
      { key: "severity", label: "Severity", type: "enum", values: [{ key: "sev1", label: "Sev 1" }] },
    ],
  } as never,
});

const CUSTOM_FIELDS = new Map<string, CustomFieldLookup>([
  ["severity", { label: "Severity", values: [{ key: "sev1", label: "Sev 1" }] }],
]);

describe("resolveFilterRow — simple filters", () => {
  it("resolves a facet id to its NAME, not the raw id (P-4)", () => {
    const f: Filter = { kind: "simple", field: "milestone", op: "in", values: ["m_live"] };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    expect(row).toEqual({
      kind: "simple",
      fieldLabel: "Milestone",
      opLabel: "is any of",
      valueless: false,
      values: [{ key: "m_live", label: "Beta launch", dangling: false }],
    });
  });

  it("keeps every value in a multi-value filter as its OWN entry (a set, not a joined string)", () => {
    const f: Filter = { kind: "simple", field: "labels", op: "in", values: ["l_bug", "l_missing"] };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    if (row.kind !== "simple") throw new Error("expected simple row");
    expect(row.values).toHaveLength(2);
    expect(row.values[0]).toEqual({ key: "l_bug", label: "bug", dangling: false });
  });

  it("marks an id that resolves to nothing as a DEGRADED value, never the raw id", () => {
    const f: Filter = { kind: "simple", field: "milestone", op: "in", values: ["m_deleted"] };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    if (row.kind !== "simple") throw new Error("expected simple row");
    expect(row.values).toEqual([{ key: "m_deleted", label: "Deleted milestone", dangling: true }]);
    // The raw id must not leak into the label under any circumstance.
    expect(row.values[0]?.label).not.toContain("m_deleted");
  });

  it("resolves a custom enum field's value key to its config label", () => {
    const f: Filter = { kind: "simple", field: "fields.severity", op: "in", values: ["sev1"] };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    if (row.kind !== "simple") throw new Error("expected simple row");
    expect(row.fieldLabel).toBe("Severity");
    expect(row.values).toEqual([{ key: "sev1", label: "Sev 1", dangling: false }]);
  });

  it("reads negation/membership operators in plain words", () => {
    const f: Filter = { kind: "simple", field: "status", op: "not in", values: ["backlog"] };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    if (row.kind !== "simple") throw new Error("expected simple row");
    expect(row.opLabel).toBe("is none of");
  });

  it("a valueless operator (is empty/is not empty) carries no values", () => {
    const f: Filter = { kind: "simple", field: "milestone", op: "is empty", values: [] };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    if (row.kind !== "simple") throw new Error("expected simple row");
    expect(row.valueless).toBe(true);
    expect(row.values).toEqual([]);
  });

  it("a free-text field's value is shown verbatim, never marked dangling", () => {
    const f: Filter = { kind: "simple", field: "title", op: "~", values: ["urgent"] };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    if (row.kind !== "simple") throw new Error("expected simple row");
    expect(row.values).toEqual([{ key: "urgent", label: "urgent", dangling: false }]);
  });
});

describe("resolveFilterRow — advanced filters", () => {
  it("shows the DSL verbatim — the one legitimate place for query text", () => {
    const f: Filter = { kind: "advanced", query: 'has_link("is_blocked_by")' };
    const row = resolveFilterRow(f, OPTIONS, CUSTOM_FIELDS);
    expect(row).toEqual({ kind: "advanced", query: 'has_link("is_blocked_by")' });
  });
});

describe("resolveFilterRows", () => {
  it("resolves an ordered list end to end", () => {
    const filters: Filter[] = [
      { kind: "simple", field: "status", op: "in", values: ["backlog"] },
      { kind: "advanced", query: "priority = high" },
    ];
    const rows = resolveFilterRows(filters, OPTIONS, CUSTOM_FIELDS);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind).toBe("simple");
    expect(rows[1]?.kind).toBe("advanced");
  });
});

describe("sortFieldLabel", () => {
  it("labels a built-in sort field the same way a filter row would", () => {
    expect(sortFieldLabel({ field: "priority", direction: "desc" }, CUSTOM_FIELDS)).toBe("Priority");
  });

  it("labels a custom-field sort using the workflow config", () => {
    expect(sortFieldLabel({ field: "fields.severity", direction: "asc" }, CUSTOM_FIELDS)).toBe("Severity");
  });
});
