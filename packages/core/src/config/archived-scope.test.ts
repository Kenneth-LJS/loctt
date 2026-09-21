import { describe, expect, it } from "vitest";

import { applyArchivedScope } from "./archived-scope.js";

/** @verifies K107 — the one shared archived-scope filter for config entities. */
describe("applyArchivedScope (K107)", () => {
  const items = [
    { id: "a" },
    { id: "b", archived: true },
    { id: "c", archived: false },
    { id: "d", archived: true },
  ];

  it("defaults to 'active' — hides archived", () => {
    expect(applyArchivedScope(items).map(i => i.id)).toEqual(["a", "c"]);
  });

  it("'active' hides archived", () => {
    expect(applyArchivedScope(items, "active").map(i => i.id)).toEqual(["a", "c"]);
  });

  it("'archived' keeps ONLY archived", () => {
    expect(applyArchivedScope(items, "archived").map(i => i.id)).toEqual(["b", "d"]);
  });

  it("'all' keeps everything", () => {
    expect(applyArchivedScope(items, "all").map(i => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns a fresh array (never the input reference)", () => {
    expect(applyArchivedScope(items, "all")).not.toBe(items);
  });
});
