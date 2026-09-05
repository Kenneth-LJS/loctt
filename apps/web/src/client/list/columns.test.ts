import type { UserSettings } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { ALL_COLUMNS, DEFAULT_COLUMNS, resolveColumns } from "./columns.ts";

const settings = (list_columns: unknown): UserSettings =>
  ({ list_columns }) as unknown as UserSettings;

describe("resolveColumns", () => {
  it("returns the default columns in order when no setting is present", () => {
    // K24: the default set is the ten LST-2 columns, NOT the whole
    // catalog — the catalog includes the opt-in reporter column.
    expect(resolveColumns(undefined).map(c => c.id)).toEqual(DEFAULT_COLUMNS.map(c => c.id));
  });

  // @verifies LST-2
  it("LST-2: the default set is exactly the ten columns, with reporter absent (K24)", () => {
    const ids = resolveColumns(undefined).map(c => c.id);
    expect(ids).toEqual([
      "key", "project", "title", "status", "priority",
      "task_type", "assignee", "labels", "due_date", "updated_at",
    ]);
    // reporter is a real catalog column, just not a default one.
    expect(ids).not.toContain("reporter");
  });

  // @verifies PRU-25
  it("offers a sortable reporter column in the catalog, added opt-in via list_columns", () => {
    const reporter = ALL_COLUMNS.find(c => c.id === "reporter");
    expect(reporter).toBeDefined();
    expect(reporter?.label).toBe("Reporter");
    // reporter is a real TaskFrontmatter field, so the server can sort it.
    expect(reporter?.sortable).toBe(true);
    // K24: NOT in the default view — a user must opt in.
    expect(resolveColumns(undefined).map(c => c.id)).not.toContain("reporter");
    // ...and when they do opt in, it resolves and renders (PRU-25's
    // degraded reporter cell has a column to live in).
    const opted = resolveColumns(settings(["key", "assignee", "reporter"])).map(c => c.id);
    expect(opted).toEqual(["key", "assignee", "reporter"]);
  });

  it("respects a user's column order + visibility", () => {
    const cols = resolveColumns(settings(["title", "status", "key"]));
    expect(cols.map(c => c.id)).toEqual(["title", "status", "key"]);
  });

  it("drops unknown column ids from a stale setting", () => {
    const cols = resolveColumns(settings(["title", "removed_column", "status"]));
    expect(cols.map(c => c.id)).toEqual(["title", "status"]);
  });

  it("falls back to defaults when the setting resolves to nothing", () => {
    expect(resolveColumns(settings(["totally", "unknown"])).map(c => c.id)).toEqual(
      DEFAULT_COLUMNS.map(c => c.id),
    );
  });

  it("ignores a non-array list_columns", () => {
    expect(resolveColumns(settings("title,status")).map(c => c.id)).toEqual(
      DEFAULT_COLUMNS.map(c => c.id),
    );
  });
});

describe("resolveColumns — project scope (PRU-3)", () => {
  // @verifies PRU-3
  it("hides the project column when exactly one project is scoped", () => {
    const cols = resolveColumns(undefined, { activeProjectCount: 1 });
    expect(cols.map(c => c.id)).not.toContain("project");
    // Every other default column survives — only project is dropped.
    expect(cols.map(c => c.id)).toEqual(
      DEFAULT_COLUMNS.filter(c => c.id !== "project").map(c => c.id),
    );
  });

  // @verifies PRU-3
  it("shows the project column in all-projects mode (nothing scoped)", () => {
    const cols = resolveColumns(undefined, { activeProjectCount: 0 });
    expect(cols.map(c => c.id)).toContain("project");
    expect(cols.map(c => c.id)).toEqual(DEFAULT_COLUMNS.map(c => c.id));
  });

  // @verifies PRU-3
  it("shows the project column when several projects are scoped", () => {
    const cols = resolveColumns(undefined, { activeProjectCount: 3 });
    expect(cols.map(c => c.id)).toContain("project");
  });

  // @verifies PRU-3
  // @verifies LST-6
  it("does NOT auto-insert project over an explicit list_columns (K19)", () => {
    // K19: an explicit list_columns is honored verbatim — the
    // all-projects auto-insert is a default-only help, because
    // overriding a column set the user deliberately chose is the
    // silent-override LST-6 forbids. This test asserted the opposite
    // before K19 (it expected project inserted here); it was encoding
    // the behaviour the ruling overturned.
    const cols = resolveColumns(settings(["key", "title", "status"]), {
      activeProjectCount: 0,
    });
    expect(cols.map(c => c.id)).toEqual(["key", "title", "status"]);
  });

  // @verifies PRU-3
  it("auto-inserts project (after key) in all-projects mode for the DEFAULT column set", () => {
    // The user has not customised columns, so the help applies:
    // same-titled rows across projects stay distinguishable without
    // opening column settings.
    const cols = resolveColumns(undefined, { activeProjectCount: 0 });
    const ids = cols.map(c => c.id);
    expect(ids).toContain("project");
    expect(ids.indexOf("project")).toBe(ids.indexOf("key") + 1);
  });

  // @verifies PRU-3
  it("does not mutate the saved order across a scope toggle", () => {
    const saved = ["key", "project", "title", "status"];
    const s = settings([...saved]);
    // Hide it (single project) then show it (all projects): the input
    // setting is never rewritten, so a component that toggles scope
    // does not lose the user's saved order.
    resolveColumns(s, { activeProjectCount: 1 });
    const back = resolveColumns(s, { activeProjectCount: 0 });
    expect(back.map(c => c.id)).toEqual(saved);
    expect((s as unknown as { list_columns: string[] }).list_columns).toEqual(saved);
  });
});
