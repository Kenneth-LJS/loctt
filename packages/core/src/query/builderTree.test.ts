// @verifies K83 — the visual query builder's core: AST ⇄ BuilderTree and
// the renderability predicate (refuse rather than approximate).
import { describe, expect, it } from "vitest";

import { builderTreeToQuery, conditionsToDsl, queryToBuilderTree, queryToConditions } from "./builderTree.js";
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

describe("grammar-colliding string values stay STRINGs (F1 / LST-42)", () => {
  // A STRING value whose TEXT collides with the DSL grammar must survive
  // serialize∘parse as the SAME string, not silently re-type as a
  // boolean/number/date/keyword or break the query. Before the dslAtom
  // fix these serialized bare (`status = true`) and re-parsed as a
  // different type, or threw (`title ~ and`) — the P-11 / K83-(i) bug.
  it.each([
    ['status = "true"', "true"],
    ['status = "false"', "false"],
    ['label = "today"', "today"],
    ['owner = "currentUser"', "currentUser"],
    ['code = "123"', "123"],
    ['tag = "2024-01-15"', "2024-01-15"],
    ['title ~ "and"', "and"],
    ['title ~ "or"', "or"],
    ['title ~ "not"', "not"],
    ['title ~ "in"', "in"],
    ['title ~ "is"', "is"],
  ])("keeps %s as a STRING of that exact text", (q, text) => {
    const res = queryToBuilderTree(q);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const reserialized = builderTreeToQuery(res.tree);
    // Must re-parse (no throw) and to the identical structure...
    const reparsed = parse(reserialized);
    expect(normalize(reparsed)).toEqual(normalize(parse(q)));
    // ...and the value must still be a STRING carrying the same text —
    // the assertion that pins "did not silently re-type".
    expect(reparsed.type).toBe("comparison");
    if (reparsed.type !== "comparison") return;
    expect(reparsed.value).toEqual({ type: "string", value: text });
  });

  it("keeps a list of colliding values as STRINGs: foo in (\"true\", \"123\")", () => {
    const q = 'foo in ("true", "123")';
    const res = queryToBuilderTree(q);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const reparsed = parse(builderTreeToQuery(res.tree));
    expect(normalize(reparsed)).toEqual(normalize(parse(q)));
    expect(reparsed.type).toBe("comparison");
    if (reparsed.type !== "comparison") return;
    expect(reparsed.value).toEqual({
      type: "list",
      values: [
        { type: "string", value: "true" },
        { type: "string", value: "123" },
      ],
    });
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

// ── Stored-conditions round-trip: total + FORM-PRESERVING ─────────────
//
// `queryToConditions` (total, lossless) + `conditionsToDsl` (the
// spacing-only serializer) back a saved view's stored `conditions` and its
// DERIVED `query`. Unlike the UI `queryToBuilderTree`, these accept EVERY
// construct the grammar has, and the serializer's only transformation is
// whitespace: it must never switch `= A` ↔ `in (A)`, canonicalize a list
// to a negation, invert an operator, or reorder values.
describe("conditions round-trip is form-preserving (spacing-only)", () => {
  // Each case: [input, exact expected DSL after one round-trip]. The
  // expected string is byte-for-byte — that is what pins "spacing only".
  const cases: ReadonlyArray<readonly [string, string]> = [
    // `= A` stays `= A`, never widened to `in (A)`.
    ["status = A", "status = A"],
    // `in (A)` stays `in (A)`, never narrowed to `= A`.
    ["status in (A)", "status in (A)"],
    // A multi-value list stays `in (...)`, never flipped to a negation.
    ["status in (A, B)", "status in (A, B)"],
    // `not in` stays `not in`, never inverted.
    ["status not in (A, B)", "status not in (A, B)"],
    // Value order is preserved verbatim.
    ["status in (C, A, B)", "status in (C, A, B)"],
    // Only whitespace is normalized: tight input → canonical spacing.
    ["status=A", "status = A"],
    ["status   =   A", "status = A"],
    ["status in (A,B)", "status in (A, B)"],
    // `!=` is preserved, not rewritten to `not (... = ...)`.
    ["status != A", "status != A"],
  ];

  it.each(cases)("%s → %s (form preserved, only whitespace normalized)", (input, expected) => {
    const res = queryToConditions(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(conditionsToDsl(res.tree)).toBe(expected);
  });

  it("preserves value ORDER through the tree (no reordering)", () => {
    const res = queryToConditions("status in (zeta, alpha, mid)");
    expect(res.ok).toBe(true);
    if (!res.ok || res.tree.kind !== "leaf") return;
    expect(res.tree.value).toEqual({
      type: "list",
      values: [
        { type: "string", value: "zeta" },
        { type: "string", value: "alpha" },
        { type: "string", value: "mid" },
      ],
    });
    // And it survives serialization in the same order.
    expect(conditionsToDsl(res.tree)).toBe("status in (zeta, alpha, mid)");
  });

  it("keeps `= A` distinct from `in (A)` (no count-based operator switch)", () => {
    // If the serializer ever collapsed a single-value list to `=` (or
    // widened `=` to a list), these two would converge. They must not.
    const eq = queryToConditions("status = A");
    const list = queryToConditions("status in (A)");
    expect(eq.ok && list.ok).toBe(true);
    if (!eq.ok || !list.ok) return;
    expect(conditionsToDsl(eq.tree)).toBe("status = A");
    expect(conditionsToDsl(list.tree)).toBe("status in (A)");
    expect(conditionsToDsl(eq.tree)).not.toBe(conditionsToDsl(list.tree));
  });
});

// ── The BuilderTree extension: not / has_link / link_count ────────────
//
// These are the node kinds Stage 1 added so the stored tree is TOTAL over
// the grammar. Each must round-trip losslessly through
// queryToConditions → conditionsToDsl.
describe("extended node kinds round-trip losslessly", () => {
  const extended: readonly string[] = [
    "not (status = done)",
    "not (status in (a, b))",
    "status = a and not (priority = high)",
    'has_link("blocks")',
    'has_link("blocks", "T-10")',
    "has_link()",
    'link_count("child") > 2',
    "link_count() >= 1",
    'archived != true and has_link("is_blocked_by")',
    "due_date >= startOfWeek()",
    'due_date <= endOfWeek("+1w")',
    "created_at >= now()",
  ];

  it.each(extended)("round-trips %s to a semantically equal query", (q) => {
    const res = queryToConditions(q);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const reserialized = conditionsToDsl(res.tree);
    expect(normalize(parse(reserialized))).toEqual(normalize(parse(q)));
  });

  it("represents a `not` node structurally (kind: 'not')", () => {
    const res = queryToConditions("not (status = done)");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tree.kind).toBe("not");
  });

  it("represents has_link with linkKind/target (not the discriminant `kind`)", () => {
    const res = queryToConditions('has_link("blocks", "T-10")');
    expect(res.ok).toBe(true);
    if (!res.ok || res.tree.kind !== "has_link") return;
    expect(res.tree.linkKind).toBe("blocks");
    expect(res.tree.target).toBe("T-10");
  });

  it("represents link_count as a leaf carrying a `call`", () => {
    const res = queryToConditions('link_count("child") > 2');
    expect(res.ok).toBe(true);
    if (!res.ok || res.tree.kind !== "leaf") return;
    expect(res.tree.call).toEqual({ name: "link_count", kind: "child" });
    expect(res.tree.op).toBe(">");
  });

  it("the seeded `blocked` view round-trips (proves the has_link extension)", () => {
    const dsl = 'archived != true and has_link("is_blocked_by")';
    const res = queryToConditions(dsl);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Re-serializes to the same DSL (modulo spacing) and reparses equal.
    expect(normalize(parse(conditionsToDsl(res.tree)))).toEqual(normalize(parse(dsl)));
  });
});

// ── The two entry points stay SEPARATE ────────────────────────────────
//
// queryToConditions is total (only a parse error is refused);
// queryToBuilderTree layers the visual-builder renderability check on top
// and STILL refuses not/has_link/link_count/date_fn.
describe("queryToConditions is total; queryToBuilderTree still refuses", () => {
  const unrenderableButRepresentable: readonly string[] = [
    "not (status = done)",
    'has_link("blocks")',
    'link_count("child") > 2',
    "due_date >= startOfWeek()",
  ];

  it.each(unrenderableButRepresentable)("queryToConditions accepts %s", (q) => {
    expect(queryToConditions(q).ok).toBe(true);
  });

  it.each(unrenderableButRepresentable)("queryToBuilderTree still refuses %s", (q) => {
    expect(queryToBuilderTree(q).ok).toBe(false);
  });

  it("queryToConditions refuses ONLY a genuine parse error", () => {
    expect(queryToConditions("status = ").ok).toBe(false);
    expect(queryToConditions("status == done").ok).toBe(false);
  });

  it("builderTreeToQuery and conditionsToDsl are the same serializer", () => {
    const res = queryToConditions("status = a and status = b");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(conditionsToDsl(res.tree)).toBe(builderTreeToQuery(res.tree));
  });
});
