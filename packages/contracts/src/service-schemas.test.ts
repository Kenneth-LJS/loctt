import { describe, expect, it } from "vitest";

import { CreateViewRequestSchema, EditViewRequestSchema } from "./service-schemas.js";

/**
 * @verifies K102 filters[] hoist for saved-view create/edit requests.
 *
 * The create/edit view request schemas are shared by all three surfaces.
 * A view carries an ORDERED list of filters — each either a `simple`
 * field/op/values filter or an `advanced` DSL string — and there is no
 * separate "web sends structure, CLI sends DSL" split and no derived
 * canonical query string. These lock in that the ONE contracts schema
 * carries `filters` in that shape.
 */
describe("view request schemas carry filters[]", () => {
  const filters = [
    {
      kind: "simple" as const,
      field: "status",
      op: "in" as const,
      values: ["backlog", "in_progress"],
    },
  ];

  it("accepts a create body with a simple filter", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "open-work",
      filters,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filters).toEqual(filters);
    }
  });

  it("accepts a create body with an advanced (DSL) filter", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "open-work",
      filters: [{ kind: "advanced", query: "status = backlog" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filters).toEqual([{ kind: "advanced", query: "status = backlog" }]);
    }
  });

  it("accepts an empty filters array (matches everything in scope)", () => {
    const parsed = CreateViewRequestSchema.safeParse({ name: "everything", filters: [] });
    expect(parsed.success).toBe(true);
  });

  it("requires `filters` on create", () => {
    const parsed = CreateViewRequestSchema.safeParse({ name: "open-work" });
    expect(parsed.success).toBe(false);
  });

  it("accepts an edit body carrying `filters`", () => {
    const parsed = EditViewRequestSchema.safeParse({ filters });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filters).toEqual(filters);
    }
  });

  it("allows an edit body to omit `filters` (leaves them untouched)", () => {
    const parsed = EditViewRequestSchema.safeParse({ name: "renamed" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filters).toBeUndefined();
    }
  });

  it("still rejects unknown fields (schema stays strict)", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "x",
      filters,
      bogus: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects the old `query` DSL string field on create (removed by K102)", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "x",
      query: "status = backlog",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects the old `conditions` field on create (removed by K102)", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "x",
      conditions: { kind: "leaf", field: "status" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed filter in the list", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "x",
      filters: [{ kind: "simple", field: "status" }], // missing op/values
    });
    expect(parsed.success).toBe(false);
  });

  it("edit accepts `sort: null` as the explicit clear-sort signal", () => {
    const parsed = EditViewRequestSchema.safeParse({ sort: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sort).toBeNull();
    }
  });
});
