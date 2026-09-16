/**
 * The visual query builder's data model (K83, step 1 — pure core).
 *
 * The builder renders a tree of AND/OR groups over leaf comparisons,
 * with nesting allowed and NO `not` (deferred to v2 — K83 (iii)). This
 * module is the two-way bridge between that tree and the DSL text the
 * parser/evaluator already speak:
 *
 * - {@link queryToBuilderTree} parses a DSL string and, if every node
 *   is renderable, returns the flattened {@link BuilderTree}; otherwise
 *   it returns `{ ok: false, reason }` naming the construct the visual
 *   builder cannot show. The UI (later) uses that to refuse to open the
 *   visual view (K83 (i)) — not this module's concern.
 * - {@link builderTreeToQuery} serializes a tree back to a DSL string
 *   the parser accepts and that round-trips.
 *
 * The result shape mirrors `dslToSearch.ts`'s discriminated
 * `{ ok }`/`{ expressible }` precedent: refuse rather than approximate.
 *
 * ## Renderable subset (agent decision A1/A2, recorded decisions.md §8)
 *
 * A leaf comparison is renderable iff:
 * - its `op` ∈ {`=`,`!=`,`in`,`not in`,`<`,`<=`,`>`,`>=`,`~`,`is empty`,
 *   `is not empty`}, AND
 * - its `field` is a plain queryable field or a `fields.<key>` custom
 *   field, AND
 * - its `value` kind ∈ {string, number, boolean, date, today,
 *   current_user, or a list of those}.
 *
 * A whole query is UNRENDERABLE (predicate returns `ok: false`) when it
 * contains any of:
 * - a `not` node anywhere (deferred to v2);
 * - a `has_link(...)` node;
 * - a comparison carrying a `call` (i.e. `link_count(...)`);
 * - a `date_fn` value anywhere (date functions edit as text in v1);
 * - a query that does not parse;
 * - anything else outside the subset above.
 */

import type { ComparisonOp, QueryNode, QueryValue } from "./parser.js";
import { parseQuery } from "./parser.js";
import { dslAtom } from "./serialize.js";
import { tokenize } from "./tokenizer.js";

export type BuilderTree =
  | { kind: "group"; op: "and" | "or"; children: BuilderTree[] }
  | { kind: "leaf"; field: string; op: ComparisonOp; value: QueryValue };

/** The comparison operators the visual builder can render. */
const RENDERABLE_OPS: ReadonlySet<ComparisonOp> = new Set<ComparisonOp>([
  "=", "!=", "in", "not in", "<", "<=", ">", ">=", "~",
  "is empty", "is not empty",
]);

/**
 * A leaf value must be a plain scalar, `today`, `current_user`, the
 * `empty` sentinel (for the postfix presence ops), or a list of plain
 * scalars. A `date_fn` value is deliberately excluded — date functions
 * edit as text in v1 (K83). A list nested in a list, or a list holding a
 * `date_fn`/`empty`, is not renderable either.
 */
function isRenderableScalar(v: QueryValue): boolean {
  switch (v.type) {
    case "string":
    case "number":
    case "boolean":
    case "date":
    case "today":
    case "current_user":
      return true;
    default:
      // date_fn, empty, list — not a scalar.
      return false;
  }
}

function isRenderableValue(v: QueryValue): boolean {
  if (v.type === "empty") return true; // presence-test sentinel
  if (v.type === "list") return v.values.every(isRenderableScalar);
  return isRenderableScalar(v);
}

/**
 * `null` when the comparison is renderable, otherwise a human reason.
 * Only handles the `comparison` node itself; callers reject `not` /
 * `has_link` before reaching here.
 */
function unrenderableComparisonReason(
  node: Extract<QueryNode, { type: "comparison" }>,
): string | null {
  if (node.call !== undefined) {
    return "link_count(…) isn't shown in the visual builder";
  }
  if (!RENDERABLE_OPS.has(node.op)) {
    return `the operator "${node.op}" isn't shown in the visual builder`;
  }
  // A leaf `field` is a plain queryable field or `fields.<key>` custom
  // field. Enum-attribute paths (`status.category`) and other dotted
  // fields are read as-is — the builder edits the field as a string, so
  // any single field token is representable; what it must reject is a
  // value or operator it cannot render, handled below. We keep the field
  // verbatim rather than re-validating it here (validateQuery owns that).
  if (!isRenderableValue(node.value)) {
    return "a date function or other value the visual builder can't edit yet";
  }
  return null;
}

/**
 * Recursively converts an AST node to a {@link BuilderTree}, flattening
 * same-operator and/or chains into n-ary groups. Returns the reason
 * string on the first unrenderable node (short-circuit).
 */
function nodeToTree(node: QueryNode): { ok: true; tree: BuilderTree } | { ok: false; reason: string } {
  switch (node.type) {
    case "not":
      return { ok: false, reason: "a NOT/negation isn't shown in the visual builder yet" };
    case "has_link":
      return { ok: false, reason: "has_link() isn't shown in the visual builder" };
    case "comparison": {
      const reason = unrenderableComparisonReason(node);
      if (reason !== null) return { ok: false, reason };
      return {
        ok: true,
        tree: { kind: "leaf", field: node.field, op: node.op, value: node.value },
      };
    }
    case "and":
    case "or": {
      const children: BuilderTree[] = [];
      // Flatten same-operator children: `a and b and c` parses
      // left-nested as `and(and(a,b),c)`, and we collapse it to one AND
      // group of three. A child of the *other* operator stays a nested
      // group.
      const collect = (n: QueryNode): { ok: true } | { ok: false; reason: string } => {
        if (n.type === node.type) {
          const l = collect(n.left);
          if (!l.ok) return l;
          const r = collect(n.right);
          if (!r.ok) return r;
          return { ok: true };
        }
        const sub = nodeToTree(n);
        if (!sub.ok) return sub;
        children.push(sub.tree);
        return { ok: true };
      };
      const res = collect(node);
      if (!res.ok) return res;
      return { ok: true, tree: { kind: "group", op: node.type, children } };
    }
  }
}

/**
 * Parses a DSL string and, if every node is renderable, returns the
 * flattened {@link BuilderTree}. A parse error or any unrenderable node
 * yields `{ ok: false, reason }`.
 */
export function queryToBuilderTree(
  q: string,
): { ok: true; tree: BuilderTree } | { ok: false; reason: string } {
  let root: QueryNode;
  try {
    root = parseQuery(tokenize(q));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `this query couldn't be parsed: ${msg}` };
  }
  return nodeToTree(root);
}

/** Serializes a single leaf value to its DSL text. */
function serializeValue(op: ComparisonOp, value: QueryValue): string {
  const atom = (v: QueryValue): string => {
    switch (v.type) {
      case "string":
        return dslAtom(v.value);
      case "number":
        return String(v.value);
      case "boolean":
        return String(v.value);
      case "date":
        // A date is a bare YYYY-MM-DD(THH:…) — never needs quoting, and
        // quoting it would retokenize it as a string, not a DATE.
        return v.value;
      case "today":
        return "today";
      case "current_user":
        return "currentUser()";
      default:
        // list/date_fn/empty never reach here: `empty` is handled by the
        // postfix ops above, and date_fn/nested-list are unrenderable.
        throw new Error(`unserializable value kind "${v.type}"`);
    }
  };

  if (op === "in" || op === "not in") {
    if (value.type !== "list") {
      throw new Error(`"${op}" expects a list value`);
    }
    return `(${value.values.map(atom).join(", ")})`;
  }
  return atom(value);
}

/** Serializes one leaf comparison to DSL text. */
function serializeLeaf(leaf: Extract<BuilderTree, { kind: "leaf" }>): string {
  // Postfix presence tests carry no right-hand value.
  if (leaf.op === "is empty" || leaf.op === "is not empty") {
    return `${leaf.field} ${leaf.op}`;
  }
  return `${leaf.field} ${leaf.op} ${serializeValue(leaf.op, leaf.value)}`;
}

/**
 * Serializes a {@link BuilderTree} to a DSL string the parser accepts and
 * that round-trips. A group's children are joined by ` and `/` or `; a
 * child group whose op differs from the parent's is parenthesized (nested
 * same-op groups are flattened, so they never need parens). A single-child
 * group serializes as just that child.
 */
export function builderTreeToQuery(tree: BuilderTree): string {
  if (tree.kind === "leaf") return serializeLeaf(tree);

  if (tree.children.length === 0) {
    // A group with no children has no meaning; the builder should never
    // produce one, but rather than emit invalid DSL we surface it.
    throw new Error("cannot serialize an empty group");
  }
  if (tree.children.length === 1) {
    // A single-child group is just the child — no operator, no parens.
    const only = tree.children[0];
    if (only === undefined) throw new Error("cannot serialize an empty group");
    return builderTreeToQuery(only);
  }

  const joiner = tree.op === "and" ? " and " : " or ";
  const parts = tree.children.map((child) => {
    const text = builderTreeToQuery(child);
    // Parenthesize a nested group whose operator differs from ours, so
    // precedence (and binds tighter than or) can't reassociate it. A
    // same-op child was flattened into this group already, so it won't be
    // a group here — but if one is, it does not need parens.
    if (child.kind === "group" && child.op !== tree.op) {
      return `(${text})`;
    }
    return text;
  });
  return parts.join(joiner);
}
