import { describe, expect, it } from "vitest";

import { listSearchSchema, serializeListSearch } from "./listSearch.ts";

describe("listSearchSchema", () => {
  it("parses an empty search to an empty object", () => {
    const parsed = listSearchSchema.parse({});
    expect(parsed).toEqual({});
  });

  it("parses a single string into a single-element array for multi-value filters", () => {
    const parsed = listSearchSchema.parse({ project: "p_web" });
    expect(parsed.project).toEqual(["p_web"]);
  });

  it("splits CSV strings into trimmed arrays", () => {
    const parsed = listSearchSchema.parse({ labels: "frontend, backend, urgent" });
    expect(parsed.labels).toEqual(["frontend", "backend", "urgent"]);
  });

  it("accepts arrays directly when the URL parser hands them in", () => {
    const parsed = listSearchSchema.parse({ status: ["in_progress", "done"] });
    expect(parsed.status).toEqual(["in_progress", "done"]);
  });

  it("coerces page and limit to integers", () => {
    const parsed = listSearchSchema.parse({ page: "3", limit: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
  });

  // These previously threw. validateSearch runs on every navigation and
  // the client has no errorComponent, so a throw broke the entire /list
  // route rather than just pagination. The bound is still enforced —
  // it's applied by clamping instead of rejecting.
  it("clamps zero or negative page numbers up to the first page", () => {
    expect(listSearchSchema.parse({ page: "0" }).page).toBe(1);
    expect(listSearchSchema.parse({ page: "-1" }).page).toBe(1);
  });

  it("caps the limit at 200 to avoid runaway queries", () => {
    expect(listSearchSchema.parse({ limit: "9999" }).limit).toBe(200);
    expect(listSearchSchema.parse({ limit: "200" }).limit).toBe(200);
    expect(listSearchSchema.parse({ limit: "0" }).limit).toBe(1);
  });

  it("falls back to undefined for non-numeric page/limit rather than throwing", () => {
    expect(listSearchSchema.parse({ page: "abc" }).page).toBeUndefined();
    expect(listSearchSchema.parse({ limit: "" }).limit).toBeUndefined();
    expect(listSearchSchema.parse({ page: " " }).page).toBeUndefined();
    expect(listSearchSchema.parse({ limit: "Infinity" }).limit).toBeUndefined();
  });

  it("truncates fractional page numbers instead of failing the route", () => {
    expect(listSearchSchema.parse({ page: "2.7" }).page).toBe(2);
  });

  it("accepts real numbers for page/limit (in-memory state, not from the URL)", () => {
    expect(listSearchSchema.parse({ page: 3, limit: 25 }).page).toBe(3);
    expect(listSearchSchema.parse({ page: 3, limit: 25 }).limit).toBe(25);
  });

  it("enforces the dir enum", () => {
    expect(() => listSearchSchema.parse({ dir: "sideways" })).toThrow();
    const ok = listSearchSchema.parse({ dir: "asc" });
    expect(ok.dir).toBe("asc");
  });

  it("passes unknown keys through unchanged (TanStack Router shares the param bag)", () => {
    const parsed = listSearchSchema.parse({ debug: "1", unknownKey: "x" });
    expect(parsed).toMatchObject({ debug: "1", unknownKey: "x" });
  });

  it("drops empty strings from CSV arrays", () => {
    const parsed = listSearchSchema.parse({ labels: " , bug, " });
    expect(parsed.labels).toEqual(["bug"]);
  });

  it("treats a fully-empty CSV as undefined, not []", () => {
    const parsed = listSearchSchema.parse({ labels: " , " });
    expect(parsed.labels).toBeUndefined();
  });
});

describe("csv de-duplication", () => {
  // @verifies LST-34
  it("collapses repeated values in a CSV param", () => {
    const parsed = listSearchSchema.parse({ status: "done,done,in_progress" });
    // One entry per distinct value: the chip row renders one chip per
    // entry, so a repeat here is a duplicate chip with a duplicate key.
    expect(parsed.status).toEqual(["done", "in_progress"]);
  });

  // @verifies LST-34
  it("collapses repeats arriving as an array", () => {
    const parsed = listSearchSchema.parse({ labels: ["a", "a", "b"] });
    expect(parsed.labels).toEqual(["a", "b"]);
  });

  it("preserves the first-seen order", () => {
    const parsed = listSearchSchema.parse({ status: "in_progress,done,in_progress" });
    // Order is what the chip row and the URL both show; re-sorting
    // would churn the URL on every interaction.
    expect(parsed.status).toEqual(["in_progress", "done"]);
  });
});

describe("serializeListSearch", () => {
  it("emits a string-keyed record suitable for URLSearchParams", () => {
    const out = serializeListSearch({
      q: "alpha",
      project: ["p_web", "p_backend"],
      page: 2,
      dir: "desc",
    });
    expect(out).toEqual({
      q: "alpha",
      project: "p_web,p_backend",
      page: "2",
      dir: "desc",
    });
  });

  it("omits undefined fields entirely", () => {
    const out = serializeListSearch({ q: "alpha" });
    expect(out).toEqual({ q: "alpha" });
    expect(Object.keys(out)).not.toContain("project");
  });

  it("drops empty arrays so the URL doesn't carry ?labels=", () => {
    const out = serializeListSearch({ labels: [] });
    expect(out).not.toHaveProperty("labels");
  });

  it("round-trip preserves a complex search", () => {
    const original = {
      q: "auth bug",
      project: ["p_web"],
      status: ["in_progress", "done"],
      assignee: ["u_ken"],
      sort: "updated_at",
      dir: "desc" as const,
      page: 3,
      limit: 25,
    };
    const serialized = serializeListSearch(original);
    const reparsed = listSearchSchema.parse(serialized);
    expect(reparsed).toEqual(original);
  });
});
