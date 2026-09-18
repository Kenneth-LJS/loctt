/**
 * Prefix validation for the init wizard.
 *
 * ## The rule, and why the wizard and the CLI now agree
 *
 * ONB-19 asks that the wizard state the character rule and reject a
 * malformed prefix, AND that "a value the CLI would take is not rejected
 * here, and vice versa". Both hold under K88, because the CLI is now
 * strict too: `assertValidPrefix` (`packages/core/src/projects/prefix.ts`)
 * enforces `^[A-Z]{1,10}$` at `init`, `createProject`, and
 * `setProjectPrefix`. So this validator is not a *narrower* client-only
 * rule (the superseded A78 reading, from when core validated only
 * non-emptiness and the wizard rejected just URL-breaking characters) —
 * it is the *same* rule the CLI applies, kept in sync so the two surfaces
 * cannot disagree about which prefix is acceptable.
 *
 * A dash is the common mistake it catches: the `-` separator is inserted
 * at key render (`WEB` → `WEB-1`), so typing `WEB-` would render `WEB--1`.
 * K88 rejects it rather than stripping it.
 */

/**
 * K88/A80: a prefix is bare uppercase letters, 1–10. The `-` separator is
 * added automatically at key render, so it is NOT typed by the user.
 * Strict: anything else (dash, lowercase, digit, space, punctuation) is
 * rejected — the rule is stated, not silently normalised. This mirrors
 * core's `PREFIX_RE`; the two must stay identical.
 */
const PREFIX_RE = /^[A-Z]{1,10}$/;

export const PREFIX_RULE =
  "Use 1–10 uppercase letters (A–Z). The \"-\" separator is added "
  + "automatically, so \"WEB\" produces keys like \"WEB-1\".";

/**
 * Returns a user-facing problem with `prefix`, or `null` when it is
 * acceptable. Never returns "invalid input": ONB-19 requires the
 * actual rule be stated.
 */
export function prefixProblem(prefix: string): string | null {
  if (prefix.trim().length === 0) return "Enter a key prefix.";
  if (!PREFIX_RE.test(prefix)) {
    return `That key prefix isn't allowed. ${PREFIX_RULE}`;
  }
  return null;
}

/**
 * The first key this prefix will allocate — the wizard's live preview
 * (ONB-3). Key numbering starts at 1, matching `defaultStateYaml`; the
 * dash is inserted at render (K88), so "WEB" previews as "WEB-1".
 */
export function firstKeyPreview(prefix: string): string {
  return `${prefix}-1`;
}
