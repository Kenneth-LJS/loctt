/**
 * Canonical DSL value formatting, shared by every surface that turns a
 * value back into query text.
 *
 * `dslAtom` was born in `apps/web/src/client/list/buildDsl.ts` (the
 * Basic → Advanced saved-view direction). The visual query builder
 * (K83) serializes the same values back to DSL, and if the two used
 * different quoting rules a value could survive one path and break the
 * other — so the rule lives here once and both import it.
 *
 * The rule: a value passes through UNQUOTED only when it both looks like
 * a bare identifier AND re-tokenizes to a single plain FIELD/STRING token
 * equal to itself; anything else is double-quoted with `\` and `"`
 * backslash-escaped, matching exactly what the tokenizer's string scanner
 * unescapes.
 *
 * ## Why the tokenizer round-trip, not just the identifier regex (F1)
 *
 * The identifier regex `/^[A-Za-z0-9_.-]+$/` alone under-quoted: a STRING
 * value whose *text* collides with the DSL grammar passed through bare and
 * then re-parsed as a DIFFERENT type, or broke the query outright —
 * silently corrupting the query (P-11), which the K83 builder's
 * open→Apply-with-no-edits path made user-visible:
 *   - `"true"`/`"false"` → BOOLEAN,  `"today"` → TODAY sentinel,
 *     `"currentUser"` → CURRENT_USER,  `"123"` → NUMBER,
 *     `"2024-01-15"` → DATE  (meaning changed),
 *   - `"and"`/`"or"`/`"not"`/`"in"`/`"is"` → an operator/keyword →
 *     INVALID DSL (throws on reparse).
 * The regex cannot know any of this — only the tokenizer's own keyword,
 * number and date rules can — so we ask the tokenizer directly. Reusing
 * it (rather than replicating a `needsQuoting` predicate) means it can
 * never drift from the grammar it must agree with. Benign extra quotes
 * (e.g. always quoting a bare `123`) are acceptable; silent corruption is
 * not.
 */

import type { ComparisonOp, QueryNode, QueryValue } from "./parser.js";
import { tokenize } from "./tokenizer.js";

/** Bare identifiers pass through; everything else is quoted + escaped. */
export function dslAtom(value: string): string {
  if (isBareSafe(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Whether `value` can be emitted unquoted and re-tokenize back to the
 * identical plain FIELD/STRING it came from. Requires the identifier
 * shape first (a fast reject for anything with whitespace/quotes/parens),
 * then confirms the tokenizer yields exactly one FIELD or STRING token
 * whose value equals the input — so a keyword/number/date-shaped word, or
 * anything the tokenizer would throw on, is caught and quoted instead.
 */
function isBareSafe(value: string): boolean {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) return false;
  let tokens;
  try {
    tokens = tokenize(value);
  } catch {
    // The tokenizer throwing on the bare form (e.g. a lone `is`) means it
    // is definitely not bare-safe.
    return false;
  }
  const only = tokens.length === 1 ? tokens[0] : undefined;
  return (
    only !== undefined
    && (only.type === "FIELD" || only.type === "STRING")
    && only.value === value
  );
}

/**
 * Serializes a parsed {@link QueryNode} back to DSL text.
 *
 * The transformation is FORMATTING ONLY: operators, fields, values, list
 * order and structure are re-emitted exactly as the AST holds them. No
 * `=`↔`in` switching, no negation canonicalization, no value reordering.
 *
 * Parentheses are the one thing that is both preserved AND added. Ken
 * (K102): *"i think we should store parens as needed to prevent ambiguity
 * or whatever, but if the user adds more parens for clarity, we should
 * keep."* So each node emits
 * `max(authored pairs, pairs precedence requires)`:
 *
 *  - a pair the author wrote SURVIVES even when redundant — `(a or b)` at
 *    top level stays `(a or b)`, and `((x))` stays `((x))`;
 *  - a pair precedence NEEDS is added even when unwritten — an `or` under
 *    an `and`, and any `not` operand, are wrapped so the text reparses to
 *    the same tree.
 *
 * Taking the max (rather than adding) is what keeps normalization
 * IDEMPOTENT: re-parsing the output records exactly the pairs just
 * emitted, so normalizing twice equals normalizing once and a saved
 * view's text never drifts.
 *
 * This is what K102 means by "you may normalise spacing, dont edit
 * anything else" (Ken): an advanced filter's stored text is this
 * function's output for the AST the user's text parsed to, so
 * `status=done` is stored as `status = done` and nothing semantic
 * changes.
 *
 * Ported from the former `builderTreeToQuery`, which did the same job one
 * AST removed — K102 deleted the `BuilderTree` mirror, so the serializer
 * now works on the parser's own node type.
 */
export function queryNodeToDsl(node: QueryNode): string {
  return emit(node, 0);
}

/**
 * Serializes `node`, wrapping it in `max(authored, required)` paren pairs.
 *
 * `required` is what the PARENT needs for the text to reparse to this same
 * tree (1 for an `or` under an `and`, 1 for a `not` operand, 0 otherwise).
 * `node.parenthesized` is what the AUTHOR wrote. Neither alone satisfies
 * Ken's rule; the max does.
 */
function emit(node: QueryNode, required: number): string {
  const pairs = Math.max(node.parenthesized ?? 0, required);
  const inner = emitBare(node);
  return pairs > 0 ? `${"(".repeat(pairs)}${inner}${")".repeat(pairs)}` : inner;
}

/** The node's own text, with no wrapping parens of its own. */
function emitBare(node: QueryNode): string {
  switch (node.type) {
    case "comparison": {
      // A `link_count(kind?)` comparison: the left-hand side is the call,
      // not the literal field name.
      const lhs = node.call !== undefined
        ? `link_count(${node.call.kind !== undefined ? dslAtom(node.call.kind) : ""})`
        : node.field;
      // Postfix presence tests carry no right-hand value.
      if (node.op === "is empty" || node.op === "is not empty") {
        return `${lhs} ${node.op}`;
      }
      return `${lhs} ${node.op} ${serializeNodeValue(node.op, node.value)}`;
    }
    case "has_link": {
      const args: string[] = [];
      if (node.kind !== undefined) args.push(dslAtom(node.kind));
      // A target is only meaningful alongside a kind, matching the
      // parser's positional arguments.
      if (node.target !== undefined) args.push(dslAtom(node.target));
      return `has_link(${args.join(", ")})`;
    }
    case "not":
      // `not` binds tighter than and/or; the operand always takes at least
      // one pair so a compound child keeps its meaning and the result
      // reparses identically. An author who wrote more keeps them.
      return `not ${emit(node.operand, 1)}`;
    case "and":
    case "or": {
      const joiner = node.type === "and" ? " and " : " or ";
      // `and` binds tighter than `or`, so an `or` nested under an `and`
      // needs a pair or it reassociates on reparse.
      const required = (child: QueryNode): number =>
        (node.type === "and" && child.type === "or" ? 1 : 0);
      return `${emit(node.left, required(node.left))}${joiner}${emit(node.right, required(node.right))}`;
    }
  }
}

/** Serializes a comparison's right-hand value to DSL text. */
function serializeNodeValue(op: ComparisonOp, value: QueryValue): string {
  const atom = (v: QueryValue): string => {
    switch (v.type) {
      case "string":
        return dslAtom(v.value);
      case "number":
      case "boolean":
        return String(v.value);
      case "date":
        // A bare YYYY-MM-DD(THH:…) — quoting it would retokenize it as a
        // string rather than a DATE.
        return v.value;
      case "today":
        return "today";
      case "current_user":
        return "currentUser()";
      case "date_fn": {
        if (v.offset === undefined) return `${v.fn}()`;
        const sign = v.offset.sign === -1 ? "-" : "+";
        return `${v.fn}("${sign}${v.offset.n}${v.offset.unit}")`;
      }
      default:
        // list/empty never reach here: `empty` is handled by the postfix
        // ops above, and a nested list is not a legal value.
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
