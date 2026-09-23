import type { UserSettings, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { FacetKey } from "./FilterBar.tsx";
import {
  addableFilters,
  buildFilterCatalog,
  BUILTIN_DEFAULT_VISIBLE,
  resolveVisibleFilters,
  userVisibleFiltersOf,
  VISIBLE_FILTERS_KEY,
  withUserVisibleFilters,
} from "./visibleFilters.ts";

/**
 * The K97 visible-filter set: catalog assembly, the resolution chain
 * (active view's set → per-user default → built-in default), and the
 * per-user (de)serialisation. Pure logic, asserted directly — this is
 * where the resolution precedence and the stale-id dropping live.
 */

const BUILTINS: { readonly id: FacetKey; readonly label: string }[] = [
  { id: "project", label: "Project" },
  { id: "status", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "type", label: "Type" },
  { id: "assignee", label: "Assignee" },
  { id: "reporter", label: "Reporter" },
  { id: "labels", label: "Label" },
  { id: "milestone", label: "Milestone" },
  { id: "sprint", label: "Sprint" },
];

const WORKFLOW = {
  statuses: [], priorities: [], task_types: [], relationships: [],
  custom_fields: [
    { key: "team", label: "Team", type: "enum", multi: false, searchable: false,
      values: [{ key: "core", label: "Core" }] },
    { key: "notes", label: "Notes", type: "text", multi: false, searchable: false },
  ],
} as unknown as WorkflowConfig;

describe("buildFilterCatalog", () => {
  it("lists built-ins first, then enum custom fields only", () => {
    const cat = buildFilterCatalog(BUILTINS, WORKFLOW);
    // 9 built-ins + the single ENUM custom field (the text field is not
    // faceted, so it is not offered).
    expect(cat.map(e => e.id)).toEqual([
      "project", "status", "priority", "type", "assignee",
      "reporter", "labels", "milestone", "sprint",
      "field.team",
    ]);
    expect(cat.find(e => e.id === "field.team")?.group).toBe("custom");
    expect(cat.find(e => e.id === "field.notes")).toBeUndefined();
  });

  it("has only built-ins when the workflow has no custom fields", () => {
    const cat = buildFilterCatalog(BUILTINS, undefined);
    expect(cat).toHaveLength(9);
    expect(cat.every(e => e.group === "builtin")).toBe(true);
  });
});

describe("resolveVisibleFilters — the K97 chain", () => {
  const catalog = buildFilterCatalog(BUILTINS, WORKFLOW);

  it("falls to the built-in default when nothing is set", () => {
    expect(resolveVisibleFilters({ catalog })).toEqual([...BUILTIN_DEFAULT_VISIBLE]);
  });

  it("uses the per-user default over the built-in default", () => {
    expect(
      resolveVisibleFilters({ userSet: ["status", "labels"], catalog }),
    ).toEqual(["status", "labels"]);
  });

  it("uses the active view's set over BOTH the per-user and built-in defaults", () => {
    expect(
      resolveVisibleFilters({
        viewSet: ["sprint", "field.team"],
        userSet: ["status", "labels"],
        catalog,
      }),
    ).toEqual(["sprint", "field.team"]);
  });

  it("orders by the catalog, not by the stored order", () => {
    // Stored reversed; resolution returns canonical catalog order so the
    // toolbar is stable regardless of how ids were written.
    expect(
      resolveVisibleFilters({ viewSet: ["priority", "status", "project"], catalog }),
    ).toEqual(["project", "status", "priority"]);
  });

  it("drops an id for a since-removed custom field", () => {
    // A view stored `field.gone`, but the workflow no longer defines it —
    // it must not render as a broken dropdown.
    expect(
      resolveVisibleFilters({ viewSet: ["status", "field.gone"], catalog }),
    ).toEqual(["status"]);
  });

  it("never shows a withheld (hidden) facet even when a set names it", () => {
    // The sprint-scope route withholds `sprint`; a stored set naming it is
    // still filtered out.
    expect(
      resolveVisibleFilters({
        viewSet: ["status", "sprint"],
        catalog,
        hidden: ["sprint"],
      }),
    ).toEqual(["status"]);
  });

  it("preserves an explicit empty view set (show nothing extra)", () => {
    expect(resolveVisibleFilters({ viewSet: [], userSet: ["status"], catalog })).toEqual([]);
  });
});

describe("addableFilters", () => {
  const catalog = buildFilterCatalog(BUILTINS, WORKFLOW);

  it("offers everything not already visible", () => {
    const addable = addableFilters(catalog, ["project", "status"]);
    expect(addable.map(e => e.id)).toEqual([
      "priority", "type", "assignee", "reporter", "labels", "milestone", "sprint", "field.team",
    ]);
  });

  it("never offers a hidden facet", () => {
    const addable = addableFilters(catalog, ["project"], ["sprint"]);
    expect(addable.map(e => e.id)).not.toContain("sprint");
  });
});

describe("per-user (de)serialisation", () => {
  it("reads a stored array, drops non-strings", () => {
    const settings = { [VISIBLE_FILTERS_KEY]: ["status", 7, "labels"] } as unknown as UserSettings;
    expect(userVisibleFiltersOf(settings)).toEqual(["status", "labels"]);
  });

  it("returns undefined (not []) when unset, so resolution falls through", () => {
    expect(userVisibleFiltersOf({} as UserSettings)).toBeUndefined();
    expect(userVisibleFiltersOf(undefined)).toBeUndefined();
    expect(userVisibleFiltersOf({ [VISIBLE_FILTERS_KEY]: "oops" } as unknown as UserSettings))
      .toBeUndefined();
  });

  it("round-trips through withUserVisibleFilters, carrying other keys", () => {
    const settings = { default_project: "p_web" } as unknown as UserSettings;
    const next = withUserVisibleFilters(settings, ["status", "labels"]);
    // The other key survives (PUT replaces the whole doc — A26/BRD-4).
    expect((next as Record<string, unknown>).default_project).toBe("p_web");
    expect(userVisibleFiltersOf(next)).toEqual(["status", "labels"]);
  });
});

describe("resolveVisibleFilters — custom fields before the workflow loads (LST-57)", () => {
  // The catalog built with no workflow has no custom entries at all:
  // exactly the state while /api/workflow is loading or has failed.
  const catalogWithoutWorkflow = buildFilterCatalog(BUILTINS, undefined);

  // @verifies LST-57
  it("keeps a stored custom-field filter while its definition is unknown", () => {
    expect(
      resolveVisibleFilters({
        viewSet: ["status", "field.team"],
        catalog: catalogWithoutWorkflow,
        customFieldsKnown: false,
      }),
    ).toEqual(["status", "field.team"]);
  });

  // @verifies LST-57
  it("drops a custom field that genuinely no longer exists once the workflow has loaded", () => {
    expect(
      resolveVisibleFilters({
        viewSet: ["status", "field.gone"],
        catalog: buildFilterCatalog(BUILTINS, WORKFLOW),
        customFieldsKnown: true,
      }),
    ).toEqual(["status"]);
  });
});
