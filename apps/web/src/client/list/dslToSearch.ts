import { parseQuery, type QueryNode, type QueryValue, tokenize } from "@loctt/core";

import type { ListSearch } from "../router/listSearch.ts";

/**
 * The Advanced → Basic direction of the saved-view editor (VUE-11).
 *
 * `buildDsl.ts` goes Basic → Advanced. This goes back, and the hard
 * requirement is that it **refuses rather than approximates**: VUE-11
 * says the query "is never rewritten or truncated to fit". So this
 * returns a discriminated result — either a full `Partial<ListSearch>`
 * that reproduces the query exactly, or a `reason` naming the
 * construct basic mode cannot represent, which the disabled toggle
 * shows as its explanation.
 *
 * Expressible shape, mirroring exactly what `buildDslFromSearch`
 * emits — a flat `and` of per-field clauses, each either `field = v`
 * or `field in (a, b)`:
 *
 *     status in (a, b) and priority = high and archived != true
 *
 * Anything else — a disjunction, a negation, a comparison operator,
 * a relationship call, a repeated field, a field with no facet — is
 * not expressible. That conservatism is the point: silently dropping
 * a predicate would produce a basic filter that returns different
 * rows than the query the user wrote, which is the P10 failure this
 * case exists to prevent.
 */

/** Facet field name → the `ListSearch` key holding it. */
const FIELD_TO_FACET: Readonly<Record<string, string>> = {
  project: "project",
  status: "status",
  priority: "priority",
  task_type: "type",
  assignee: "assignee",
  reporter: "reporter",
  labels: "labels",
  milestone: "milestone",
  sprint: "sprint",
};

export type DslToSearchResult =
  | { readonly expressible: true; readonly search: Partial<ListSearch> }
  | { readonly expressible: false; readonly reason: string };

/** Human name for a node kind, for the disabled toggle's explanation. */
function describeNode(node: QueryNode): string {
  switch (node.type) {
    case "or":
      return "an “or” (basic mode combines filters with “and” only)";
    case "not":
      return "a “not” negation";
    case "has_link":
      return "a has_link(…) relationship test";
    default:
      return "an unsupported construct";
  }
}

/**
 * The string form of a scalar value, or `null` for one a facet chip
 * cannot hold (`today`, or a list nested inside a list).
 *
 * Values are stringified because `ListSearch` facets are string arrays
 * — the same representation the URL carries.
 */
function scalarText(v: QueryValue): string | null {
  switch (v.type) {
    case "string":
    case "date":
      return v.value;
    case "number":
      return String(v.value);
    case "boolean":
      return String(v.value);
    default:
      return null;
  }
}

/** Normalises a scalar or list value to a string array, or `null`. */
function scalarList(v: QueryValue): string[] | null {
  if (v.type === "list") {
    const out: string[] = [];
    for (const item of v.values) {
      const s = scalarText(item);
      if (s === null) return null;
      out.push(s);
    }
    return out;
  }
  const s = scalarText(v);
  return s === null ? null : [s];
}

/**
 * Flattens a left-nested `and` chain into its leaves. A non-`and` node
 * is its own single leaf.
 */
function flattenAnd(node: QueryNode, out: QueryNode[]): void {
  if (node.type === "and") {
    flattenAnd(node.left, out);
    flattenAnd(node.right, out);
    return;
  }
  out.push(node);
}

export function dslToSearch(dsl: string): DslToSearchResult {
  let root: QueryNode;
  try {
    root = parseQuery(tokenize(dsl));
  } catch {
    // A query that does not parse is not "inexpressible in basic mode",
    // it is broken — the editor shows the parse error instead, and the
    // toggle stays disabled either way.
    return { expressible: false, reason: "the query does not parse yet" };
  }

  const leaves: QueryNode[] = [];
  flattenAnd(root, leaves);

  const search: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const leaf of leaves) {
    if (leaf.type !== "comparison") {
      return { expressible: false, reason: `it contains ${describeNode(leaf)}` };
    }
    // `link_count(...) > 1` parses as a comparison carrying a `call`;
    // it has no facet and must not be mistaken for a field clause.
    if (leaf.call !== undefined) {
      return { expressible: false, reason: "it contains a link_count(…) comparison" };
    }

    const { field, op, value } = leaf;

    // The default-scope clause `buildDslFromSearch` always appends.
    // Round-tripping it as a filter would surface it as a chip the
    // user never set, so it maps back to the absence of `archived`.
    const isTrue = value.type === "boolean" && value.value === true;
    if (field === "archived" && op === "!=" && isTrue) {
      seen.add("archived");
      continue;
    }
    if (field === "archived" && op === "=" && isTrue) {
      search["archived"] = true;
      seen.add("archived");
      continue;
    }

    const facet = FIELD_TO_FACET[field];
    const isCustom = field.startsWith("fields.") && field.length > "fields.".length;
    if (facet === undefined && !isCustom) {
      return {
        expressible: false,
        reason: `basic mode has no control for “${field}”`,
      };
    }

    if (op !== "=" && op !== "in") {
      return {
        expressible: false,
        reason: `it uses “${op}” on “${field}”, and basic mode only offers equality`,
      };
    }

    const key = facet ?? `field.${field.slice("fields.".length)}`;
    if (seen.has(key)) {
      // Two clauses on one field are an intersection basic mode has no
      // way to show — its control holds a single OR-ed value set.
      return {
        expressible: false,
        reason: `“${field}” is filtered twice, which basic mode cannot show`,
      };
    }
    seen.add(key);

    const values = scalarList(value);
    if (values === null) {
      // `today` and nested lists have no representation in a facet
      // chip; a `due_date <= today` view stays advanced-only.
      return {
        expressible: false,
        reason: `“${field}” is compared against a value basic mode cannot hold`,
      };
    }
    search[key] = values;
  }

  return { expressible: true, search: search as Partial<ListSearch> };
}
