// @verifies K83 — the visual query builder's core: AST ⇄ BuilderTree and
// the renderability predicate (refuse rather than approximate).
import { describe, expect, it } from "vitest";

import { builderTreeToQuery, queryToBuilderTree } from "./builderTree.js";
import type { QueryNode } from "./parser.js";
import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";

/**
 * Normalizes an AST to a canonical shape for semantic comparison,
 * dropping `position` (a serialize/reparse won't preserve byte offsets)
 * and flattening left-nested and/or chains (so `a and b and c` and any
 * re-association compare equal). This is the semantic-equality yardstick
 * the round-trip asserts against.
 */
function normalize(node: QueryNode): unknown {
  switch (node.type) {
    case "and":
    case "or": {
      const parts: unknown[] = [];
      const walk = (n: QueryNode): void => {
        if (n.type === node.type) {
          walk(n.left);
          walk(n.right);
        } else {
          parts.push(normalize(n));
        }
      };
      walk(node);
      return { type: node.type, parts };
    }
    case "comparison": {
      const { position: _p, ...rest } = node;
      return rest;
    }
    default:
      return node;
  }
}

function parse(q: string): QueryNode {
  return parseQuery(tokenize(q));
}

describe("queryToBuilderTree / builderTreeToQuery round-trip (K83)", () => {
  const renderable: readonly string[] = [
    "status = done",
    "status = done and priority = high",
    "status = done and priority = high and assignee = me",
    "status = backlog or status = done",
    "status = a or status = b or status = c",
    "status = done and (priority = high or priority = urgent)",
    "(status = a or status = b) and priority = high",
    "status in (backlog, done)",
    "labels not in (a, b, c)",
    "milestone is empty",
    "assignee is not empty",
    "title ~ login",
    "estimate < 5",
    "estimate <= 5",
    "estimate > 5",
    "estimate >= 5",
    "assignee = currentUser()",
    "due_date = today",
    "due_date >= 2024-01-15",
    'text ~ "say \\"hi\\""',
    'title ~ "has space"',
    "fields.points > 3",
    "status = done and priority = high or status = backlog",
  ];

  it.each(renderable)("round-trips %s to a semantically equal query", (q) => {
    const res = queryToBuilderTree(q);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const reserialized = builderTreeToQuery(res.tree);
    // The re-serialized string must parse, and to the SAME structure.
    expect(normalize(parse(reserialized))).toEqual(normalize(parse(q)));
  });

  it.each(renderable)("is stable under a second round-trip: %s", (q) => {
    const first = queryToBuilderTree(q);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const once = builderTreeToQuery(first.tree);
    const second = queryToBuilderTree(once);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const twice = builderTreeToQuery(second.tree);
    expect(twice).toBe(once);
  });
});

describe("flatten (K83)", () => {
  it("collapses a and b and c into ONE group of three children", () => {
    const res = queryToBuilderTree("status = a and status = b and status = c");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tree).toMatchObject({ kind: "group", op: "and" });
    if (res.tree.kind !== "group") return;
    expect(res.tree.children).toHaveLength(3);
    // No child is itself an AND group — the chain was flattened, not nested.
    for (const child of res.tree.children) {
      expect(child.kind).toBe("leaf");
    }
  });

  it("collapses a or b or c into ONE group of three children", () => {
    const res = queryToBuilderTree("status = a or status = b or status = c");
    expect(res.ok).toBe(true);
    if (!res.ok || res.tree.kind !== "group") return;
    expect(res.tree.children).toHaveLength(3);
  });

  it("keeps a differing nested operator as its own group", () => {
    const res = queryToBuilderTree("status = a and (status = b or status = c)");
    expect(res.ok).toBe(true);
    if (!res.ok || res.tree.kind !== "group") return;
    expect(res.tree.op).toBe("and");
    expect(res.tree.children).toHaveLength(2);
    const nested = res.tree.children[1];
    expect(nested).toMatchObject({ kind: "group", op: "or" });
  });
});

describe("refuse unrenderable queries (K83)", () => {
  it("refuses a NOT node with a reason naming negation", () => {
    const res = queryToBuilderTree("not status = done");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/not|negation/i);
  });

  it("refuses a NOT nested deep inside", () => {
    const res = queryToBuilderTree("status = done and not priority = high");
    expect(res.ok).toBe(false);
  });

  it("refuses has_link()", () => {
    const res = queryToBuilderTree('has_link("blocks")');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/has_link/i);
  });

  it("refuses a link_count() comparison", () => {
    const res = queryToBuilderTree('link_count("child") > 2');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/link_count/i);
  });

  it("refuses a date_fn value", () => {
    const res = queryToBuilderTree("due_date >= startOfWeek()");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/date function|can't edit/i);
  });

  it("refuses a query that does not parse, surfacing the message", () => {
    const res = queryToBuilderTree("status = ");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/couldn't be parsed/i);
  });
});

describe("quoting round-trip (LST-42)", () => {
  it.each([
    'title = "has space"',
    'text ~ "say \\"hi\\""',
    'title = "a\\\\b"',
    'labels in ("x y", "z")',
  ])("a value needing quotes/escapes survives: %s", (q) => {
    const res = queryToBuilderTree(q);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const reserialized = builderTreeToQuery(res.tree);
    // The escaped value must survive verbatim through re-parse.
    expect(normalize(parse(reserialized))).toEqual(normalize(parse(q)));
  });
});
