import { describe, expect, it } from "vitest";

import { CreateViewRequestSchema, EditViewRequestSchema } from "./service-schemas.js";

/**
 * @verifies Stage-3 contracts hoist for structured saved-view conditions.
 *
 * The create/edit view request schemas are shared by all three surfaces.
 * They must accept BOTH shapes of a view's filter, because core derives
 * whichever is missing:
 *   - structured `conditions` (the web builder's path);
 *   - a DSL `query` string (the CLI/MCP raw-DSL path).
 * Before the hoist the web server re-extended a `{name,query,sort}`-only
 * schema locally; these lock in that the ONE contracts schema carries
 * `conditions`.
 */
describe("view request schemas carry structured conditions", () => {
  const conditions = {
    kind: "leaf" as const,
    field: "status",
    op: "in" as const,
    value: {
      type: "list" as const,
      values: [
        { type: "string" as const, value: "backlog" },
        { type: "string" as const, value: "in_progress" },
      ],
    },
  };

  it("accepts a create body with structured `conditions` (web path)", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "open-work",
      conditions,
    });
    expect(parsed.success).toBe(true);
    // The parity assertion the red-proof breaks: conditions survives
    // parsing rather than being stripped by a schema that never knew it.
    if (parsed.success) {
      expect(parsed.data.conditions).toEqual(conditions);
    }
  });

  it("accepts a create body with only a DSL `query` (CLI/MCP path)", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "open-work",
      query: "status = backlog",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.query).toBe("status = backlog");
      expect(parsed.data.conditions).toBeUndefined();
    }
  });

  it("accepts an edit body carrying `conditions`", () => {
    const parsed = EditViewRequestSchema.safeParse({ conditions });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.conditions).toEqual(conditions);
    }
  });

  it("still rejects unknown fields (schema stays strict)", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "x",
      query: "status = backlog",
      bogus: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed `conditions` tree", () => {
    const parsed = CreateViewRequestSchema.safeParse({
      name: "x",
      conditions: { kind: "leaf", field: "status" }, // missing op/value
    });
    expect(parsed.success).toBe(false);
  });
});
