import { describe, expect, it } from "vitest";

import {
  BrokenSavedQuerySchema,
  BuilderTreeSchema,
  SavedQuerySchema,
} from "./query.js";

/** A minimal valid conditions tree, reused across cases. */
const leafConditions = {
  kind: "leaf" as const,
  field: "status",
  op: "=" as const,
  value: { type: "string" as const, value: "done" },
};

describe("SavedQuerySchema requires conditions", () => {
  it("rejects a saved view with no conditions", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      query: "status = done",
      // conditions omitted
    });
    expect(res.success).toBe(false);
  });

  it("accepts a saved view carrying a conditions tree", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      query: "status = done",
      conditions: leafConditions,
    });
    expect(res.success).toBe(true);
  });

  it("rejects a conditions tree with an unknown node kind (strict discriminant)", () => {
    const res = SavedQuerySchema.safeParse({
      id: "01ID",
      name: "v",
      query: "status = done",
      conditions: { kind: "frobnik", foo: 1 },
    });
    expect(res.success).toBe(false);
  });
});

describe("BuilderTreeSchema mirrors the extended core type", () => {
  it("validates a nested group of leaves", () => {
    const tree = {
      kind: "group",
      op: "and",
      children: [
        leafConditions,
        { kind: "group", op: "or", children: [leafConditions] },
      ],
    };
    expect(BuilderTreeSchema.safeParse(tree).success).toBe(true);
  });

  it("validates the extended kinds: not / has_link / link_count leaf", () => {
    expect(BuilderTreeSchema.safeParse({ kind: "not", child: leafConditions }).success).toBe(true);
    expect(BuilderTreeSchema.safeParse({ kind: "has_link", linkKind: "blocks", target: "T-10" }).success).toBe(true);
    expect(BuilderTreeSchema.safeParse({
      kind: "leaf",
      field: "link_count",
      op: ">",
      value: { type: "number", value: 2 },
      call: { name: "link_count", kind: "child" },
    }).success).toBe(true);
  });

  it("validates a date_fn value with an offset", () => {
    expect(BuilderTreeSchema.safeParse({
      kind: "leaf",
      field: "due_date",
      op: ">=",
      value: { type: "date_fn", fn: "endOfWeek", offset: { sign: 1, n: 1, unit: "w" } },
    }).success).toBe(true);
  });

  it("rejects an unknown comparison operator", () => {
    expect(BuilderTreeSchema.safeParse({
      kind: "leaf", field: "status", op: "===", value: { type: "string", value: "x" },
    }).success).toBe(false);
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
      "query: status ==",
      "some_future_field: kept",
      "conditions:",
      "  kind: leaf",
      "  field: status",
      "  op: '='",
      "  value:",
      "    type: string",
      "    value: x",
    ].join("\n");

    const parsed = BrokenSavedQuerySchema.safeParse({
      id: "01BAD",
      name: "broken",
      query: "status ==",
      error: "parse error",
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
      query: "status ==",
      error: "parse error",
      index: 0,
    });
    expect(parsed.success).toBe(false);
  });
});
