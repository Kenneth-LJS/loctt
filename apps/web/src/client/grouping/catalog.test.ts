import type { WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  buildGroupingCatalog,
  BUILTIN_TIMELINE_GROUPINGS,
  groupingLabel,
  isValidGrouping,
} from "./catalog.ts";

/**
 * The group-by catalog: eight builtins, plus single-value enum custom
 * fields. The load-bearing rule is the eligibility filter — a label or
 * multi-value enum in the catalog would let the user pick a grouping
 * that places one task in many bands and breaks TML-7.
 */

function wf(custom_fields: unknown[]): WorkflowConfig {
  return { relationships: [], custom_fields } as unknown as WorkflowConfig;
}

const singleEnum = {
  key: "area",
  label: "Area",
  type: "enum",
  multi: false,
  searchable: false,
  values: [{ key: "fe", label: "Frontend" }],
};

describe("buildGroupingCatalog", () => {
  it("returns the eight builtins, in fixed order, when there are no custom fields", () => {
    const catalog = buildGroupingCatalog(wf([]));
    expect(catalog).toEqual(BUILTIN_TIMELINE_GROUPINGS);
    expect(catalog.map(e => e.id)).toEqual([
      "none",
      "project",
      "milestone",
      "sprint",
      "assignee",
      "status",
      "priority",
      "task_type",
    ]);
  });

  it("returns the builtins even when the workflow is undefined", () => {
    expect(buildGroupingCatalog(undefined)).toEqual(BUILTIN_TIMELINE_GROUPINGS);
  });

  it("includes a single-value enum custom field as field.<key>, in config order", () => {
    const second = { ...singleEnum, key: "team", label: "Team" };
    const catalog = buildGroupingCatalog(wf([singleEnum, second]));
    const custom = catalog.filter(e => e.group === "custom");
    expect(custom.map(e => e.id)).toEqual(["field.area", "field.team"]);
    expect(custom.map(e => e.label)).toEqual(["Area", "Team"]);
  });

  it("EXCLUDES a multi-value enum field (breaks the one-band invariant)", () => {
    const catalog = buildGroupingCatalog(wf([{ ...singleEnum, multi: true }]));
    expect(catalog.some(e => e.id === "field.area")).toBe(false);
  });

  it("EXCLUDES a non-enum field (no closed set of values to band by)", () => {
    for (const type of ["string", "number", "date", "boolean"]) {
      const catalog = buildGroupingCatalog(wf([{ ...singleEnum, type, values: undefined }]));
      expect(catalog.some(e => e.id === "field.area")).toBe(false);
    }
  });

  it("EXCLUDES an enum field with no values", () => {
    expect(buildGroupingCatalog(wf([{ ...singleEnum, values: [] }])).some(e => e.id === "field.area"))
      .toBe(false);
    expect(buildGroupingCatalog(wf([{ ...singleEnum, values: undefined }])).some(e => e.id === "field.area"))
      .toBe(false);
  });
});

describe("isValidGrouping", () => {
  it("accepts a builtin and a catalogued custom field, rejects the rest", () => {
    const catalog = buildGroupingCatalog(wf([singleEnum]));
    expect(isValidGrouping("assignee", catalog)).toBe(true);
    expect(isValidGrouping("field.area", catalog)).toBe(true);
    expect(isValidGrouping("field.gone", catalog)).toBe(false);
    expect(isValidGrouping("labels", catalog)).toBe(false);
  });
});

describe("groupingLabel", () => {
  it("labels a catalogued grouping, and falls back to the id for a dangling one", () => {
    const catalog = buildGroupingCatalog(wf([singleEnum]));
    expect(groupingLabel("field.area", catalog)).toBe("Area");
    expect(groupingLabel("task_type", catalog)).toBe("Type");
    expect(groupingLabel("field.gone", catalog)).toBe("field.gone");
  });
});
