import type { ProjectDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { filterByName, filterProjects, isBlankQuery } from "./search.js";

describe("isBlankQuery", () => {
  it("treats undefined, empty, and whitespace as blank", () => {
    expect(isBlankQuery(undefined)).toBe(true);
    expect(isBlankQuery("")).toBe(true);
    expect(isBlankQuery("   ")).toBe(true);
  });

  it("treats any non-whitespace content as non-blank", () => {
    expect(isBlankQuery("a")).toBe(false);
    expect(isBlankQuery("  x  ")).toBe(false);
  });
});

describe("filterByName (K90)", () => {
  const items = [
    { name: "Bug" },
    { name: "bugfix" },
    { name: "Feature" },
    { name: undefined },
  ];

  it("returns the input unchanged (same reference) for a blank query", () => {
    expect(filterByName(items, "")).toBe(items);
    expect(filterByName(items, undefined)).toBe(items);
    expect(filterByName(items, "   ")).toBe(items);
  });

  it("matches a case-insensitive substring of the name", () => {
    expect(filterByName(items, "bug").map(i => i.name)).toEqual(["Bug", "bugfix"]);
    expect(filterByName(items, "BUG").map(i => i.name)).toEqual(["Bug", "bugfix"]);
    expect(filterByName(items, "fix").map(i => i.name)).toEqual(["bugfix"]);
  });

  it("trims the query before matching", () => {
    expect(filterByName(items, "  feature  ").map(i => i.name)).toEqual(["Feature"]);
  });

  it("never matches an item whose name is undefined", () => {
    // A user with no name (name is optional on UserProfile) is simply
    // non-matching for a non-empty query, not a crash.
    expect(filterByName(items, "u").some(i => i.name === undefined)).toBe(false);
  });

  it("returns nothing when no name contains the query", () => {
    expect(filterByName(items, "zzz")).toEqual([]);
  });
});

describe("filterProjects (K90)", () => {
  const projects = [
    // slug `portal` shares nothing with the name "Website" or prefix WEB,
    // so a `portal` query can only match via the slug.
    { id: "a", name: "Website", slug: "portal", prefix: "WEB" },
    { id: "b", name: "Backend", slug: "backend", prefix: "BE" },
    { id: "c", name: "Infra", slug: "svc", prefix: "INF" },
  ] as unknown as ProjectDef[];

  it("returns the input unchanged for a blank query", () => {
    expect(filterProjects(projects, "")).toBe(projects);
  });

  it("matches on the display name", () => {
    expect(filterProjects(projects, "site").map(p => p.id)).toEqual(["a"]);
  });

  it("matches on the prefix — the handle a user types", () => {
    // "WEB" is the key prefix, not in the name "Website" as uppercase.
    expect(filterProjects(projects, "BE").map(p => p.id)).toEqual(["b"]);
  });

  it("matches on the slug — a handle absent from name and prefix", () => {
    expect(filterProjects(projects, "portal").map(p => p.id)).toEqual(["a"]);
  });

  it("is case-insensitive across all three fields", () => {
    // name (Website), slug (portal), prefix (WEB) all resolve to `a`.
    expect(filterProjects(projects, "WEBSITE").map(p => p.id)).toEqual(["a"]);
    expect(filterProjects(projects, "PORTAL").map(p => p.id)).toEqual(["a"]);
    expect(filterProjects(projects, "web").map(p => p.id)).toEqual(["a"]);
  });
});
