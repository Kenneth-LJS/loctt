/**
 * The query-condition tree — core's structured representation of a query.
 *
 * Two audiences share ONE type ({@link BuilderTree}) but use different
 * entry points, and it is important to keep them apart:
 *
 * ## 1. Stored saved-view conditions (total, lossless)
 *
 * A saved view stores its filter as a {@link BuilderTree} and derives its
 * DSL `query` string from it. For that the tree must be able to hold
 * EVERY construct the parser accepts — including `not`, `has_link(...)`
 * and `link_count(...)` — so {@link queryToConditions} and
 * {@link builderTreeToQuery} form a TOTAL, lossless round-trip over the
 * whole grammar (only a genuine parse error is refused). The serializer's
 * ONLY permitted transformation is whitespace/spacing normalization: it
 * must NOT switch `= A` ↔ `in (A)`, must NOT canonicalize a list to a
 * negation, must NOT reorder values or invert operators — it re-emits the
 * user's own form, respaced.
 *
 * ## 2. The visual query builder's renderable subset (UI-facing)
 *
 * The visual builder (K83) renders a tree of AND/OR groups over leaf
 * comparisons, and deliberately refuses to render `not`, the link
 * predicates, and `date_fn` values (deferred to a later builder version).
 * {@link queryToBuilderTree} is that refusing entry point: it parses a
 * DSL string and returns the tree only when every node is renderable,
 * otherwise `{ ok: false, reason }`. This renderability check is SEPARATE
 * from the round-trip above and must stay separate — a stored view may
 * legitimately hold a `has_link` the visual builder cannot show (the
 * seeded `blocked` default view does exactly that).
 *
 * The result shape mirrors `dslToSearch.ts`'s discriminated
 * `{ ok }`/`{ expressible }` precedent: refuse rather than approximate.
 *
 * ## Renderable subset (agent decision A1/A2, recorded decisions.md §8)
 *
 * A leaf comparison is renderable iff:
 * - its `op` ∈ {`=`,`!=`,`in`,`not in`,`<`,`<=`,`>`,`>=`,`~`,`is empty`,
 *   `is not empty`}, AND
 * - it carries no `call` (i.e. it is not a `link_count(...)` comparison), AND
 * - its `field` is a plain queryable field or a `fields.<key>` custom
 *   field, AND
 * - its `value` kind ∈ {string, number, boolean, date, today,
 *   current_user, or a list of those}.
 *
 * A whole query is UNRENDERABLE (predicate returns `ok: false`) when it
 * contains any of:
 * - a `not` node anywhere (deferred);
 * - a `has_link(...)` node;
 * - a comparison carrying a `call` (i.e. `link_count(...)`);
 * - a `date_fn` value anywhere (date functions edit as text for now);
 * - a query that does not parse;
 * - anything else outside the subset above.
 */

import type { ComparisonOp, QueryNode, QueryValue } from "./parser.js";
import { parseQuery } from "./parser.js";
import { dslAtom } from "./serialize.js";
import { tokenize } from "./tokenizer.js";

/**
 * A `link_count(kind?)` call on the left-hand side of a comparison,
 * mirroring the parser's `comparison.call`. When a leaf carries this, its
 * `field` is the literal `"link_count"` and `op`/`value` are the numeric
 * comparison against the count.
 */
export interface LinkCountCall {
  readonly name: "link_count";
  // `| undefined` on the optionals so this type is byte-identical to the
  // contracts mirror (`LinkCountCallSchema`), whose zod output carries it
  // under `exactOptionalPropertyTypes`; the two must stay interchangeable
  // (a stored `SavedQuery.conditions` flows straight into these functions).
  readonly kind?: string | undefined;
}

export type BuilderTree =
  | { kind: "group"; op: "and" | "or"; children: BuilderTree[] }
  // A negation wrapping a single child tree (`not (...)`).
  | { kind: "not"; child: BuilderTree }
  // `has_link()` / `has_link(kind)` / `has_link(kind, target)`. Arity
  // picks the question (any link / a kind / a single edge), matching the
  // parser's `has_link` node. The relationship kind is `linkKind` (not
  // `kind`) because `kind` is this union's discriminant; `linkKind`/`target`
  // map 1:1 to the parser node's `kind`/`target`.
  | { kind: "has_link"; linkKind?: string | undefined; target?: string | undefined }
  // A leaf comparison. `call` is present only for a `link_count(...)`
  // comparison, in which case `field` is the literal `"link_count"`.
  | { kind: "leaf"; field: string; op: ComparisonOp; value: QueryValue; call?: LinkCountCall | undefined };

/** The comparison operators the visual builder can render. */
const RENDERABLE_OPS: ReadonlySet<ComparisonOp> = new Set<ComparisonOp>([
  "=", "!=", "in", "not in", "<", "<=", ">", ">=", "~",
  "is empty", "is not empty",
]);

/**
 * A leaf value must be a plain scalar, `today`, `current_user`, the
 * `empty` sentinel (for the postfix presence ops), or a list of plain
 * scalars. A `date_fn` value is deliberately excluded — date functions
 * edit as text for now (K83). A list nested in a list, or a list holding a
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
 * `null` when the comparison leaf is renderable, otherwise a human
 * reason. Only handles a `leaf` node; the whole-tree predicate rejects
 * `not` / `has_link` before reaching here.
 */
function unrenderableLeafReason(leaf: Extract<BuilderTree, { kind: "leaf" }>): string | null {
  if (leaf.call !== undefined) {
    return "link_count(…) isn't shown in the visual builder";
  }
  if (!RENDERABLE_OPS.has(leaf.op)) {
    return `the operator "${leaf.op}" isn't shown in the visual builder`;
  }
  // A leaf `field` is a plain queryable field or `fields.<key>` custom
  // field. Enum-attribute paths (`status.category`) and other dotted
  // fields are read as-is — the builder edits the field as a string, so
  // any single field token is representable; what it must reject is a
  // value or operator it cannot render, handled below. We keep the field
  // verbatim rather than re-validating it here (validateQuery owns that).
  if (!isRenderableValue(leaf.value)) {
    return "a date function or other value the visual builder can't edit yet";
  }
  return null;
}

/**
 * The visual builder's renderability predicate over a total
 * {@link BuilderTree}. Returns `null` when the tree is fully renderable,
 * otherwise the first reason it is not. This is the UI-facing check —
 * kept SEPARATE from the round-trip functions, which are total. Callers
 * that need to decide whether to open the visual builder use this (via
 * {@link queryToBuilderTree}); the stored-conditions path never does.
 */
export function unrenderableTreeReason(tree: BuilderTree): string | null {
  switch (tree.kind) {
    case "not":
      return "a NOT/negation isn't shown in the visual builder yet";
    case "has_link":
      return "has_link() isn't shown in the visual builder";
    case "leaf":
      return unrenderableLeafReason(tree);
    case "group": {
      for (const child of tree.children) {
        const reason = unrenderableTreeReason(child);
        if (reason !== null) return reason;
      }
      return null;
    }
  }
}

/**
 * Recursively converts an AST node to a total {@link BuilderTree},
 * flattening same-operator and/or chains into n-ary groups. This is
 * LOSSLESS and never refuses a node — every parser node kind maps to a
 * tree kind. (A parse error is caught by the caller.)
 */
function nodeToTree(node: QueryNode): BuilderTree {
  switch (node.type) {
    case "not":
      return { kind: "not", child: nodeToTree(node.operand) };
    case "has_link":
      return {
        kind: "has_link",
        ...(node.kind !== undefined ? { linkKind: node.kind } : {}),
        ...(node.target !== undefined ? { target: node.target } : {}),
      };
    case "comparison":
      return {
        kind: "leaf",
        field: node.field,
        op: node.op,
        value: node.value,
        ...(node.call !== undefined ? { call: node.call } : {}),
      };
    case "and":
    case "or": {
      const children: BuilderTree[] = [];
      // Flatten same-operator children: `a and b and c` parses
      // left-nested as `and(and(a,b),c)`, and we collapse it to one AND
      // group of three. A child of the *other* operator stays a nested
      // group.
      const collect = (n: QueryNode): void => {
        if (n.type === node.type) {
          collect(n.left);
          collect(n.right);
          return;
        }
        children.push(nodeToTree(n));
      };
      collect(node);
      return { kind: "group", op: node.type, children };
    }
  }
}

/**
 * Parses a DSL string into a total, lossless {@link BuilderTree} — the
 * stored-conditions direction. Every construct the parser accepts is
 * representable, so this returns `{ ok: false }` ONLY when the string
 * does not parse. Use {@link queryToBuilderTree} instead when you need the
 * visual-builder renderability check.
 */
export function queryToConditions(
  q: string,
): { ok: true; tree: BuilderTree } | { ok: false; reason: string } {
  let root: QueryNode;
  try {
    root = parseQuery(tokenize(q));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `this query couldn't be parsed: ${msg}` };
  }
  return { ok: true, tree: nodeToTree(root) };
}

/**
 * Parses a DSL string and, if every node is RENDERABLE by the visual
 * builder, returns the flattened {@link BuilderTree}. A parse error or any
 * unrenderable node yields `{ ok: false, reason }`. This is the UI entry
 * point — it layers the renderability predicate over the total
 * {@link queryToConditions}.
 */
export function queryToBuilderTree(
  q: string,
): { ok: true; tree: BuilderTree } | { ok: false; reason: string } {
  const res = queryToConditions(q);
  if (!res.ok) return res;
  const reason = unrenderableTreeReason(res.tree);
  if (reason !== null) return { ok: false, reason };
  return res;
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
      case "date_fn":
        // A date function: `now()`, or a boundary fn with an optional
        // signed offset (`endOfWeek("+1w")`). Serialized back to the same
        // call the parser accepts.
        return serializeDateFn(v);
      default:
        // list/empty never reach here: `empty` is handled by the postfix
        // ops, and a nested list is not a legal value.
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

/** Serializes a `date_fn` value to its DSL call text. */
function serializeDateFn(v: Extract<QueryValue, { type: "date_fn" }>): string {
  if (v.offset === undefined) return `${v.fn}()`;
  const sign = v.offset.sign === -1 ? "-" : "+";
  return `${v.fn}("${sign}${v.offset.n}${v.offset.unit}")`;
}

/** Serializes a `has_link(...)` node to DSL, quoting each name argument. */
function serializeHasLink(node: Extract<BuilderTree, { kind: "has_link" }>): string {
  const args: string[] = [];
  if (node.linkKind !== undefined) args.push(dslAtom(node.linkKind));
  // A target is only meaningful alongside a kind, matching the parser's
  // positional arguments; the tree never carries a bare target.
  if (node.target !== undefined) args.push(dslAtom(node.target));
  return `has_link(${args.join(", ")})`;
}

/** Serializes one leaf comparison to DSL text. */
function serializeLeaf(leaf: Extract<BuilderTree, { kind: "leaf" }>): string {
  // A `link_count(kind?)` comparison: the left-hand side is the call, not
  // the literal field name.
  const lhs = leaf.call !== undefined
    ? `link_count(${leaf.call.kind !== undefined ? dslAtom(leaf.call.kind) : ""})`
    : leaf.field;
  // Postfix presence tests carry no right-hand value.
  if (leaf.op === "is empty" || leaf.op === "is not empty") {
    return `${lhs} ${leaf.op}`;
  }
  return `${lhs} ${leaf.op} ${serializeValue(leaf.op, leaf.value)}`;
}

/**
 * Serializes a total {@link BuilderTree} to a DSL string the parser
 * accepts and that round-trips. The ONLY transformation is spacing
 * normalization — operators, fields, values, list order and structure are
 * re-emitted exactly as the tree holds them (no `=`↔`in` switch, no
 * negation canonicalization, no value reordering).
 *
 * A group's children are joined by ` and `/` or `; a child that could bind
 * differently under DSL precedence (a group of the other operator, or a
 * `not`) is parenthesized. A single-child group serializes as just that
 * child. A `not` wraps its child in `not (...)`.
 */
export function builderTreeToQuery(tree: BuilderTree): string {
  switch (tree.kind) {
    case "leaf":
      return serializeLeaf(tree);
    case "has_link":
      return serializeHasLink(tree);
    case "not":
      // `not` binds tighter than and/or; wrap the child in parens so a
      // group child keeps its meaning and the result reparses identically.
      return `not (${builderTreeToQuery(tree.child)})`;
    case "group": {
      if (tree.children.length === 0) {
        // A group with no children has no meaning; the builder should
        // never produce one, but rather than emit invalid DSL we surface it.
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
        // same-op child was flattened into this group already, so it won't
        // be a group here — but if one is, it does not need parens.
        if (child.kind === "group" && child.op !== tree.op) {
          return `(${text})`;
        }
        return text;
      });
      return parts.join(joiner);
    }
  }
}

/**
 * The spacing-only serializer for stored saved-view conditions — the same
 * total serializer as {@link builderTreeToQuery}, named for the intent at
 * its call sites (a view's derived `query` is `conditionsToDsl(conditions)`).
 */
export const conditionsToDsl = builderTreeToQuery;
