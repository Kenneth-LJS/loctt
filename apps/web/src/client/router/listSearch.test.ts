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

  it("rejects zero or negative page numbers", () => {
    expect(() => listSearchSchema.parse({ page: "0" })).toThrow();
    expect(() => listSearchSchema.parse({ page: "-1" })).toThrow();
  });

  it("caps the limit at 200 to avoid runaway queries", () => {
    expect(() => listSearchSchema.parse({ limit: "9999" })).toThrow();
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
      archived: true,
    };
    const serialized = serializeListSearch(original);
    const reparsed = listSearchSchema.parse(serialized);
    expect(reparsed).toEqual(original);
  });
});
