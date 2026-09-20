import { queryToConditions } from "@loctt/core/query/builderTree.js";
import { describe, expect, it } from "vitest";

import { buildConditionsFromSearch } from "./buildConditions.ts";

/**
 * The structured half of the "Save as view" builder. These pin the tree
 * shape directly — the right layer for the operator-choice invariant, so a
 * regression is caught before it ever reaches serialization.
 */
describe("buildConditionsFromSearch", () => {
  const parse = queryToConditions;

  it("emits membership for a SINGLE-value multi-select facet, never `=`", () => {
    // The load-bearing assertion (Ken's ruling). The old builder produced
    // a `= A` leaf for a lone value; this pins the `in` membership leaf so
    // that count-based downgrade cannot come back. Red-proof: switch the
    // leaf back to `{ op: "=", value: { type: "string", value: "in_progress" } }`
    // in membershipLeaf and this goes red.
    const tree = buildConditionsFromSearch({ status: ["in_progress"], archived: true }, parse);
    expect(tree).toEqual({
      kind: "group",
      op: "and",
      children: [
        {
          kind: "leaf",
          field: "status",
          op: "in",
          value: { type: "list", values: [{ type: "string", value: "in_progress" }] },
        },
      ],
    });
    // And explicitly: it is never the scalar `=` form.
    const leaf = (tree as { children: { op: string }[] }).children[0];
    expect(leaf?.op).toBe("in");
    expect(leaf?.op).not.toBe("=");
  });

  it("preserves value order within a facet", () => {
    const tree = buildConditionsFromSearch({ type: ["feature", "bug", "task"], archived: true }, parse);
    const leaf = (tree as { children: { value: { values: { value: string }[] } }[] }).children[0];
    expect(leaf?.value.values.map(v => v.value)).toEqual(["feature", "bug", "task"]);
  });

  it("maps type→task_type and field.<key>→fields.<key>", () => {
    const tree = buildConditionsFromSearch(
      { type: ["bug"], "field.impact": ["p0"], archived: true } as Record<string, unknown>,
      parse,
    );
    const fields = (tree as { children: { field: string }[] }).children.map(c => c.field);
    expect(fields).toContain("task_type");
    expect(fields).toContain("fields.impact");
  });

  it("splices the free-text q as a parsed subtree, first", () => {
    const tree = buildConditionsFromSearch({ q: "text ~ login", archived: true }, parse) as {
      children: { kind: string; field?: string; op?: string }[];
    };
    const first = tree.children[0];
    expect(first?.kind).toBe("leaf");
    expect(first?.field).toBe("text");
    expect(first?.op).toBe("~");
  });

  it("adds the archived guard by default and omits it when archived is on", () => {
    const open = buildConditionsFromSearch({ status: ["backlog"] }, parse) as {
      children: { field: string }[];
    };
    expect(open.children.map(c => c.field)).toContain("archived");

    const withArchived = buildConditionsFromSearch(
      { status: ["backlog"], archived: true },
      parse,
    ) as { children: { field: string }[] };
    expect(withArchived.children.map(c => c.field)).not.toContain("archived");
  });

  it("falls back to the archived guard alone when nothing else is active", () => {
    // `{ archived: true }` suppresses the guard AND has no facet, so the
    // tree would be an empty group the serializer refuses — the fallback
    // keeps it a valid single-condition view.
    const tree = buildConditionsFromSearch({ archived: true }, parse) as {
      children: { field: string; op: string }[];
    };
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.field).toBe("archived");
    expect(tree.children[0]?.op).toBe("!=");
  });
});
