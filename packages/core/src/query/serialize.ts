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
 * The rule: a bare identifier (`/^[A-Za-z0-9_.-]+$/`) passes through
 * unquoted; anything else is double-quoted with `\` and `"`
 * backslash-escaped, matching exactly what the tokenizer's string
 * scanner unescapes.
 */

/** Bare identifiers pass through; everything else is quoted + escaped. */
export function dslAtom(value: string): string {
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
