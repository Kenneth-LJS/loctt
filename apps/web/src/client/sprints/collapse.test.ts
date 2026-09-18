// @vitest-environment jsdom
import type { SprintDef } from "@loctt/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { isExpanded, readOverrides, toggle, writeOverrides } from "./collapse.ts";
import type { SprintColumn } from "./columns.ts";
import { NO_SPRINT_COLUMN_ID } from "./columns.ts";

function col(id: string, state: SprintDef["state"]): SprintColumn {
  return {
    id,
    kind: "sprint",
    label: id,
    sprint: {
      id, name: id, state,
      start_date: "2026-01-01", end_date: "2026-01-14",
    },
  };
}

const active = col("act", "active");
const completed = col("done", "completed");

beforeEach(() => { window.localStorage.clear(); });

describe("sprint collapse persistence", () => {
  // @verifies SPR-3
  it("an expanded completed sprint survives a reload", () => {
    expect(isExpanded(completed, readOverrides())).toBe(false);
    writeOverrides(toggle(completed, readOverrides()));
    // A fresh read is what a reload does.
    expect(isExpanded(completed, readOverrides())).toBe(true);
  });

  // @verifies SPR-3
  it("a collapsed active sprint survives a reload — the default is not re-applied", () => {
    // The bullet that rules out storing an expanded-id set: with that
    // shape, the active sprint's default puts it straight back open.
    expect(isExpanded(active, readOverrides())).toBe(true);
    writeOverrides(toggle(active, readOverrides()));
    expect(isExpanded(active, readOverrides())).toBe(false);
  });

  // @verifies SPR-3
  it("a column the user never touched keeps its own default", () => {
    writeOverrides(toggle(completed, readOverrides()));
    const stored = readOverrides();
    // The untouched active sprint is still open, and the untouched
    // No-sprint column still open too.
    expect(isExpanded(active, stored)).toBe(true);
    expect(isExpanded(
      { id: NO_SPRINT_COLUMN_ID, kind: "none", label: "No sprint" },
      stored,
    )).toBe(true);
  });

  // @verifies SPR-3
  it("toggling back to the default clears the override rather than pinning it", () => {
    const once = toggle(active, readOverrides());
    expect(once.has("act")).toBe(true);
    const twice = toggle(active, once);
    expect(twice.has("act")).toBe(false);
    expect(isExpanded(active, twice)).toBe(true);
  });

  // @verifies SPR-3
  it("does not write to sprint config — only to localStorage under its own key", () => {
    writeOverrides(toggle(completed, readOverrides()));
    expect(window.localStorage.getItem("loctt.sprints.collapse")).toBe('["done"]');
  });

  // @verifies SPR-3
  it("a corrupt stored value degrades to defaults instead of throwing", () => {
    window.localStorage.setItem("loctt.sprints.collapse", "{not json");
    expect(() => readOverrides()).not.toThrow();
    expect(isExpanded(active, readOverrides())).toBe(true);
  });
});
