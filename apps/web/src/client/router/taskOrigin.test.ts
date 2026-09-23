import { afterEach, describe, expect, it } from "vitest";

import { recordTaskOrigin, resetTaskOriginForTest, takeTaskOrigin } from "./taskOrigin.ts";

/**
 * UI-12. `taskOrigin` is the module backing the task/milestone detail
 * back affordance: it must hand back exactly what was recorded (path +
 * search, split for `<Link to/search>`), must not hand back anything
 * when nothing was recorded (the cold-load case — Ken: "if cold load
 * then no back button"), and must not hand the same origin out twice.
 */

afterEach(() => {
  resetTaskOriginForTest();
});

describe("taskOrigin", () => {
  // @verifies LST-5 (cold load — direct link, refresh, shared URL — has
  // no origin at all, not a guessed or default one)
  it("returns undefined when nothing was recorded (the cold-load case)", () => {
    expect(takeTaskOrigin()).toBeUndefined();
  });

  // @verifies LST-5 (the back target carries the origin's search params,
  // not just its bare path)
  it("splits a recorded href into pathname, search and label", () => {
    recordTaskOrigin("/list?status=in_progress&page=2");
    const origin = takeTaskOrigin();
    expect(origin).toBeDefined();
    expect(origin?.href).toBe("/list?status=in_progress&page=2");
    expect(origin?.pathname).toBe("/list");
    expect(origin?.search).toBe("?status=in_progress&page=2");
    expect(origin?.label).toBe("Back to list");
  });

  it("handles a bare path with no search", () => {
    recordTaskOrigin("/board");
    const origin = takeTaskOrigin();
    expect(origin?.pathname).toBe("/board");
    expect(origin?.search).toBe("");
    expect(origin?.label).toBe("Back to board");
  });

  it("labels known routes distinctly", () => {
    recordTaskOrigin("/timeline");
    expect(takeTaskOrigin()?.label).toBe("Back to timeline");
    recordTaskOrigin("/sprints");
    expect(takeTaskOrigin()?.label).toBe("Back to sprints");
    recordTaskOrigin("/milestones");
    expect(takeTaskOrigin()?.label).toBe("Back to milestones");
  });

  it("falls back to a plain 'Back' label for an unrecognised route", () => {
    recordTaskOrigin("/sprints/01ABC");
    expect(takeTaskOrigin()?.label).toBe("Back");
  });

  // @verifies LST-5 (consumed once — a second, unrelated mount must not
  // inherit a stale origin from a previous navigation)
  it("clears the recorded origin once taken", () => {
    recordTaskOrigin("/list?status=done");
    expect(takeTaskOrigin()).toBeDefined();
    expect(takeTaskOrigin()).toBeUndefined();
  });
});
