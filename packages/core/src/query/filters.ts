import type { AdvancedFilter, Filter, SimpleFilter } from "@loctt/contracts";

import type { ComparisonOp, QueryNode, QueryValue } from "./parser.js";
import { ParseError, parseQuery } from "./parser.js";
import { dslAtom, queryNodeToDsl } from "./serialize.js";
import { tokenize, TokenizeError } from "./tokenizer.js";

/**
 * Execution and rendering for a saved view's ordered filter list (K102).
 *
 * A View is an ORDERED LIST of filters that ALL AND together. The list is
 * the stored source of truth; this module is the only place that turns it
 * into something runnable or readable.
 *
 * The cardinal rule of K102 lives here: **storage and execution are
 * separate**. `filtersToNode` composes an AST in memory so the existing
 * validate/evaluate pipeline is reused unchanged — that AST is returned to
 * the caller, used for one list call, and discarded. It is never
 * serialized, never written to `queries.yaml`, and never fed back into an
 * edit dialog. Nothing in this module reconstructs a canonical DSL string
 * for storage.
 */

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterError";
  }
}

/** Operators that take no right-hand value. */
const POSTFIX_OPS: ReadonlySet<ComparisonOp> = new Set<ComparisonOp>([
  "is empty",
  "is not empty",
]);

/** Operators whose right-hand side is a list of values. */
const LIST_OPS: ReadonlySet<ComparisonOp> = new Set<ComparisonOp>(["in", "not in"]);

/**
 * Coerce one stored simple-filter value string into a `QueryValue`.
 *
 * A simple filter stores its values as STRINGS — that is what a dropdown
 * yields, and keeping them as strings is what lets a reopened view render
 * the picker without re-parsing anything. The evaluator, though, speaks
 * typed values, so a boolean or a number round-trips to its typed form
 * here (`archived` = `"true"` must compare as a boolean, not the string
 * `"true"`, or `archived = true` silently matches nothing).
 *
 * Dates stay strings: the evaluator compares ISO dates lexically and
 * `{type:"date"}` would require validating the shape here, which belongs
 * to the validator, not the coercion.
 */
function toQueryValue(raw: string): QueryValue {
  if (raw === "true") return { type: "boolean", value: true };
  if (raw === "false") return { type: "boolean", value: false };
  // A numeric literal, but only when the round-trip is exact — so an id
  // like "007" or a version "1.10" stays the string it was authored as.
  if (raw !== "" && String(Number(raw)) === raw) {
    return { type: "number", value: Number(raw) };
  }
  return { type: "string", value: raw };
}

/**
 * One simple filter → one comparison node.
 *
 * Multi-value simple filters are the reason `values` is an array: a
 * dropdown that lets you tick `backlog` and `in_progress` means "status is
 * either" — so several values under an equality operator become an `in`
 * list, and several under `!=` become `not in`. This is the ONE place a
 * simple filter's shape is interpreted, and it happens at execution time
 * only; the stored filter keeps its `op` and `values` exactly as authored.
 */
function simpleToNode(f: SimpleFilter): QueryNode {
  if (POSTFIX_OPS.has(f.op)) {
    return { type: "comparison", field: f.field, op: f.op, value: { type: "empty" } };
  }

  if (f.values.length === 0) {
    throw new FilterError(
      `Filter on "${f.field}" needs a value for the "${f.op}" operator.`,
    );
  }

  if (LIST_OPS.has(f.op)) {
    return {
      type: "comparison",
      field: f.field,
      op: f.op,
      value: { type: "list", values: f.values.map(toQueryValue) },
    };
  }

  if (f.values.length === 1) {
    const only = f.values[0];
    // Narrowing only — length was just checked.
    if (only === undefined) throw new FilterError(`filter on "${f.field}" has no value`);
    return { type: "comparison", field: f.field, op: f.op, value: toQueryValue(only) };
  }

  // Several values under a scalar operator. `=` widens to `in` (match any
  // of them) and `!=` widens to `not in` (match none of them); anything
  // else (`<`, `~`, …) has no sensible multi-value reading, so rejecting
  // beats silently picking the first.
  if (f.op === "=") {
    return {
      type: "comparison",
      field: f.field,
      op: "in",
      value: { type: "list", values: f.values.map(toQueryValue) },
    };
  }
  if (f.op === "!=") {
    return {
      type: "comparison",
      field: f.field,
      op: "not in",
      value: { type: "list", values: f.values.map(toQueryValue) },
    };
  }
  throw new FilterError(
    `Filter on "${f.field}" has ${f.values.length} values, which the "${f.op}" operator cannot combine.`,
  );
}

/** One advanced filter → the AST its DSL parses to. */
function advancedToNode(f: AdvancedFilter): QueryNode {
  try {
    return parseQuery(tokenize(f.query));
  } catch (err) {
    if (err instanceof TokenizeError || err instanceof ParseError) {
      throw new FilterError(`Advanced filter does not parse: ${err.message}.`);
    }
    throw err;
  }
}

/** One filter → one AST node. */
export function filterToNode(f: Filter): QueryNode {
  return f.kind === "simple" ? simpleToNode(f) : advancedToNode(f);
}

/**
 * The whole ordered filter list → one AST, folded left with `and`.
 *
 * Returns `undefined` for an empty list — a view with no filters matches
 * everything within its archived scope, and `undefined` lets the caller
 * skip query evaluation entirely rather than evaluate a tautology.
 *
 * The fold is LEFT and in array order, so the composed AST mirrors the
 * authored order. That has no semantic effect (`and` is associative and
 * commutative here) but it keeps an error message's position pointing at
 * the filter the user is looking at.
 */
export function filtersToNode(filters: readonly Filter[]): QueryNode | undefined {
  let node: QueryNode | undefined;
  for (const f of filters) {
    const next = filterToNode(f);
    node = node === undefined ? next : { type: "and", left: node, right: next };
  }
  return node;
}

/**
 * A human-readable one-line rendering of a filter list.
 *
 * DISPLAY ONLY (K102). `loctt views`, MCP `list_views` and the web echoes
 * need something to print now that a view stores no derived DSL string.
 * This is computed at display time, never persisted, and never parsed
 * back — a stored summary would be a second source of truth that goes
 * stale the moment the filters change, which is the derived-field trap
 * K102 removes.
 *
 * Simple filters read as plain `field = a, b`; an advanced filter shows
 * its query text verbatim so it is recognisable as the thing the human
 * typed.
 */
export function filtersToSummary(filters: readonly Filter[]): string {
  if (filters.length === 0) return "(no filters)";
  return filters.map(filterToSummary).join(" · ");
}

/** One filter rendered for display. See `filtersToSummary`. */
export function filterToSummary(f: Filter): string {
  if (f.kind === "advanced") return f.query;
  if (POSTFIX_OPS.has(f.op)) return `${f.field} ${f.op}`;
  const values = f.values.map((v: string) => dslAtom(v)).join(", ");
  return `${f.field} ${f.op} ${values}`;
}

/**
 * Normalize one filter for storage.
 *
 * FORMATTING ONLY (Ken, K102: *"you may normalise spacing, dont edit
 * anything else"*). An advanced filter's DSL is parsed and re-serialized,
 * which rewrites whitespace — no operator rewriting, no negation flipping,
 * no value reordering (see `queryNodeToDsl`).
 *
 * Parentheses the author wrote are KEPT even when redundant, and pairs
 * precedence requires are ADDED (Ken: *"store parens as needed to prevent
 * ambiguity or whatever, but if the user adds more parens for clarity, we
 * should keep"*). Normalization is idempotent, so a view's stored text
 * does not drift across saves. A simple filter is returned untouched: it has no
 * text to normalize, and rewriting its `op`/`values` is exactly the
 * transformation K102 forbids.
 *
 * Throws `FilterError` on an advanced filter whose DSL does not parse, so
 * a write never stores unparseable text.
 */
export function normalizeFilter(f: Filter): Filter {
  if (f.kind === "simple") return f;
  return { kind: "advanced", query: queryNodeToDsl(advancedToNode(f)) };
}

/** Normalizes every filter in a list, preserving order. */
export function normalizeFilters(filters: readonly Filter[]): Filter[] {
  return filters.map(normalizeFilter);
}

/**
 * The query-ish text a filter list references, for callers that need to
 * scan a view's filters for a field name without executing them.
 *
 * The comment-mentions gate (CMT-10) is the motivating case: it loads
 * comment I/O only when the effective query references
 * `comment_mentions`, and a saved view no longer has one query string to
 * scan. Each simple filter contributes its FIELD NAME and each advanced
 * filter its DSL, which is exactly what a field-reference scan needs.
 */
export function filtersToScannableText(filters: readonly Filter[]): string[] {
  return filters.map(f => (f.kind === "advanced" ? f.query : f.field));
}
