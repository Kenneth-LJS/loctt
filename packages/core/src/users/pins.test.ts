import { describe, expect, it } from "vitest";

import { readSidebarPins, sweepSidebarPins } from "./pins.js";

/**
 * The stale-pin sweep. SET-13's drag list and SET-27's explanation
 * both rest on this partition, and both surfaces (web panel, CLI
 * `--sweep-pins`, MCP `sweep_sidebar_pins`) call it.
 */
describe("sweepSidebarPins", () => {
  // @verifies SET-13
  it("keeps pins whose views exist, in the stored pin order", () => {
    // Deliberately not the order the view list is in: the pin order is
    // the sidebar order, which is the point of the drag list.
    const sweep = sweepSidebarPins(["c", "a", "b"], ["a", "b", "c"]);
    expect(sweep.kept).toEqual(["c", "a", "b"]);
    expect(sweep.removed).toEqual([]);
    expect(sweep.changed).toBe(false);
  });

  // @verifies SET-13
  // @verifies SET-27
  it("reports removed pins by id rather than dropping them silently", () => {
    const sweep = sweepSidebarPins(["a", "gone", "b"], ["a", "b"]);
    expect(sweep.kept).toEqual(["a", "b"]);
    // The ids are *returned*, not merely absent from `kept`. That is
    // the whole difference between SET-27 and the superseded
    // "silently" wording in SET-13's third bullet.
    expect(sweep.removed).toEqual(["gone"]);
    expect(sweep.changed).toBe(true);
  });

  // @verifies SET-27
  it("reports every pin when all of them are deleted", () => {
    const sweep = sweepSidebarPins(["x", "y"], []);
    expect(sweep.kept).toEqual([]);
    expect(sweep.removed).toEqual(["x", "y"]);
    expect(sweep.changed).toBe(true);
  });

  // @verifies SET-13
  it("does not sweep a view that merely matches zero tasks", () => {
    // The sweep is given view *existence*, never task counts — so an
    // existing view cannot be swept no matter what it matches. A sweep
    // keyed on results instead of existence would delete this pin.
    const sweep = sweepSidebarPins(["empty-view"], ["empty-view"]);
    expect(sweep.removed).toEqual([]);
    expect(sweep.kept).toEqual(["empty-view"]);
  });
});

describe("readSidebarPins", () => {
  // @verifies SET-13
  it("reads a clean id array", () => {
    expect(readSidebarPins({ sidebar_pins: ["a", "b"] })).toEqual(["a", "b"]);
  });

  // @verifies SET-13
  it("treats a hand-broken value as no pins rather than throwing", () => {
    // Settings round-trip through `.passthrough()`, so this key can
    // hold anything. A throw here would take the sidebar down (P7).
    expect(readSidebarPins({ sidebar_pins: "not-an-array" } as never)).toEqual([]);
    expect(readSidebarPins({ sidebar_pins: [1, 2] } as never)).toEqual([]);
    // A repeated pin has no meaningful sidebar position.
    expect(readSidebarPins({ sidebar_pins: ["a", "a"] })).toEqual([]);
    expect(readSidebarPins({})).toEqual([]);
    expect(readSidebarPins(undefined)).toEqual([]);
  });
});
