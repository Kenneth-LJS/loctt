import { describe, expect, it } from "vitest";

import {
  AdvancedFilterSchema,
  BrokenSavedQuerySchema,
  FilterSchema,
  SavedQuerySchema,
  SimpleFilterSchema,
} from "./query.js";

describe("SimpleFilterSchema", () => {
  it("accepts a well-formed simple filter", () => {
    const res = SimpleFilterSchema.safeParse({
      kind: "simple",
      field: "status",
      op: "=",
      values: ["done"],
    });
    expect(res.success).toBe(true);
  });

  it("allows an empty values array (is empty / is not empty operators)", () => {
    const res = SimpleFilterSchema.safeParse({
      kind: "simple",
      field: "due_date",
      op: "is empty",
      values: [],
    });
    expect(res.success).toBe(true);
  });

  it("rejects a stray `query` key (strict — cannot carry both shapes)", () => {
    const res = SimpleFilterSchema.safeParse({
      kind: "simple",
      field: "status",
      op: "=",
      values: ["done"],
      query: "status = done",
    });
    expect(res.success).toBe(false);
  });

  it("rejects an unknown comparison operator", () => {
    const res = SimpleFilterSchema.safeParse({
      kind: "simple",
      field: "status",
      op: "===",
      values: ["done"],
    });
    expect(res.success).toBe(false);
  });
});

describe("AdvancedFilterSchema", () => {
  it("accepts a well-formed advanced filter", () => {
    const res = AdvancedFilterSchema.safeParse({
      kind: "advanced",
      query: "status = done",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an empty query string", () => {
    const res = AdvancedFilterSchema.safeParse({ kind: "advanced", query: "" });
    expect(res.success).toBe(false);
  });

  it("rejects field/op/values on an advanced filter (strict)", () => {
    const res = AdvancedFilterSchema.safeParse({
      kind: "advanced",
      query: "status = done",
      field: "status",
      op: "=",
      values: ["done"],
    });
    expect(res.success).toBe(false);
  });
});

describe("FilterSchema discriminates simple vs advanced", () => {
  it("accepts a simple filter via the union", () => {
    const res = FilterSchema.safeParse({
      kind: "simple",
      field: "priority",
      op: "in",
      values: ["high", "urgent"],
    });
    expect(res.success).toBe(true);
  });

  it("accepts an advanced filter via the union", () => {
    const res = FilterSchema.safeParse({ kind: "advanced", query: 'text ~ "init"' });
    expect(res.success).toBe(true);
  });

  it("rejects an unknown discriminant", () => {
    const res = FilterSchema.safeParse({ kind: "bogus", field: "status" });
    expect(res.success).toBe(false);
  });

  it("rejects a filter mixing both shapes (no field on advanced, no query on simple)", () => {
    const res = FilterSchema.safeParse({
      kind: "advanced",
      query: "status = done",
      field: "status",
    });
    expect(res.success).toBe(false);
  });
});

describe("SavedQuerySchema", () => {
  const baseFilters = [
    { kind: "simple" as const, field: "status", op: "=" as const, values: ["done"] },
  ];

  it("accepts the new filters[] shape", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      filters: baseFilters,
    });
    expect(res.success).toBe(true);
  });

  it("accepts an empty filters array (a view matching everything in scope)", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      filters: [],
    });
    expect(res.success).toBe(true);
  });

  it("accepts a mix of simple and advanced filters, order preserved", () => {
    const filters = [
      { kind: "simple" as const, field: "status", op: "=" as const, values: ["done"] },
      { kind: "advanced" as const, query: 'text ~ "init"' },
    ];
    const res = SavedQuerySchema.safeParse({ id: "01ID", name: "v", filters });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.filters).toEqual(filters);
    }
  });

  it("rejects a saved view with no filters key at all", () => {
    const res = SavedQuerySchema.safeParse({ id: "01ID", name: "v" });
    expect(res.success).toBe(false);
  });

  it("rejects the old `query` DSL string shape (removed by K102)", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      query: "status = done",
    });
    expect(res.success).toBe(false);
  });

  it("rejects the old `conditions` BuilderTree shape (removed by K102)", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      conditions: { kind: "leaf", field: "status", op: "=", value: { type: "string", value: "done" } },
    });
    expect(res.success).toBe(false);
  });

  it("rejects a filters array containing an invalid filter", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      filters: [{ kind: "bogus" }],
    });
    expect(res.success).toBe(false);
  });
});

describe("BrokenSavedQuerySchema rawText passthrough (K28 / Phase Z C2)", () => {
  // A broken entry's `rawText` is opaque YAML — the schema must accept it
  // as a string and round-trip an entry that carries an unknown/extra key
  // inside that text. This proves an added field on a saved view is not
  // lost when the entry is broken (its full YAML lives in rawText).
  it("round-trips a rawText holding an unknown/extra key", () => {
    const rawText = [
      "id: 01BAD",
      "name: broken",
      "filters:",
      "  - kind: bogus",
      "some_future_field: kept",
    ].join("\n");

    const parsed = BrokenSavedQuerySchema.safeParse({
      id: "01BAD",
      name: "broken",
      summary: "(unreadable filters)",
      error: "filters: invalid discriminator",
      index: 0,
      rawText,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // The rawText is carried verbatim, extra key and all.
    expect(parsed.data.rawText).toContain("some_future_field: kept");
    expect(parsed.data.rawText).toBe(rawText);
  });

  it("rejects a broken entry with no rawText", () => {
    const parsed = BrokenSavedQuerySchema.safeParse({
      id: "01BAD",
      name: "broken",
      summary: "(unreadable filters)",
      error: "parse error",
      index: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a broken entry still carrying the old `query` field (replaced by `summary`)", () => {
    const parsed = BrokenSavedQuerySchema.safeParse({
      id: "01BAD",
      name: "broken",
      query: "status ==",
      error: "parse error",
      index: 0,
      rawText: "id: 01BAD\nname: broken\nquery: status ==",
    });
    expect(parsed.success).toBe(false);
  });
});
