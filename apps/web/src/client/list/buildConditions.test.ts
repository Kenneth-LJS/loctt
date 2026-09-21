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
    const tree = buildConditionsFromSearch({ status: ["in_progress"], archived: "all" }, parse);
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
    const tree = buildConditionsFromSearch({ type: ["feature", "bug", "task"], archived: "all" }, parse);
    const leaf = (tree as unknown as { children: { value: { values: { value: string }[] } }[] }).children[0];
    expect(leaf?.value.values.map(v => v.value)).toEqual(["feature", "bug", "task"]);
  });

  it("maps type→task_type and field.<key>→fields.<key>", () => {
    const tree = buildConditionsFromSearch(
      { type: ["bug"], "field.impact": ["p0"], archived: "all" } as Record<string, unknown>,
      parse,
    );
    const fields = (tree as { children: { field: string }[] }).children.map(c => c.field);
    expect(fields).toContain("task_type");
    expect(fields).toContain("fields.impact");
  });

  it("splices the free-text q as a parsed subtree, first", () => {
    const tree = buildConditionsFromSearch({ q: "text ~ login", archived: "all" }, parse) as {
      children: { kind: string; field?: string; op?: string }[];
    };
    const first = tree.children[0];
    expect(first?.kind).toBe("leaf");
    expect(first?.field).toBe("text");
    expect(first?.op).toBe("~");
  });

  // K107: this replaces the old boolean-toggle assertion (default guard vs
  // "archived on" omits it). The archived dimension is now the tri-state
  // scope, encoded into the saved view's query so re-running reproduces
  // what the user saw: absent/`active` → `archived != true`; `all` → no
  // archived leaf; `archived` → `archived = true`.
  it("encodes the tri-state archived scope into the guard leaf", () => {
    const openDefault = buildConditionsFromSearch({ status: ["backlog"] }, parse) as {
      children: { field: string; op?: string }[];
    };
    expect(openDefault.children.map(c => c.field)).toContain("archived");
    expect(openDefault.children.find(c => c.field === "archived")?.op).toBe("!=");

    const active = buildConditionsFromSearch({ status: ["backlog"], archived: "active" }, parse) as {
      children: { field: string; op?: string }[];
    };
    expect(active.children.find(c => c.field === "archived")?.op).toBe("!=");

    const all = buildConditionsFromSearch({ status: ["backlog"], archived: "all" }, parse) as {
      children: { field: string }[];
    };
    expect(all.children.map(c => c.field)).not.toContain("archived");

    const archivedOnly = buildConditionsFromSearch({ status: ["backlog"], archived: "archived" }, parse) as {
      children: { field: string; op?: string }[];
    };
    expect(archivedOnly.children.find(c => c.field === "archived")?.op).toBe("=");
  });

  it("falls back to the archived guard alone when nothing else is active", () => {
    // Scope `all` suppresses the guard AND there is no facet, so the tree
    // would be an empty group the serializer refuses — the fallback keeps
    // it a valid single-condition view.
    const tree = buildConditionsFromSearch({ archived: "all" }, parse) as {
      children: { field: string; op: string }[];
    };
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.field).toBe("archived");
    expect(tree.children[0]?.op).toBe("!=");
  });
});
