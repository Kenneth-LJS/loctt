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
