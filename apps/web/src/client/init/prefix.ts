/**
 * Prefix validation for the init wizard.
 *
 * ## Why this rule, and what it is *not*
 *
 * ONB-19 asks for two things that the shipped CLI cannot both satisfy:
 * that the wizard state the character rule and reject a prefix with a
 * space or a slash, and that "a value the CLI would take is not
 * rejected here, and vice versa".
 *
 * Measured against the built CLI at this SHA, `loctt init --prefix`
 * accepts **every** prefix tried — `"a b"`, `"web/x"`, `"lowercase-"`,
 * `"Ünicode-"`, `"NODASH"` — all exit 0. Core validates only
 * non-emptiness (`init.ts`, `prefix must be non-empty`). So the two
 * bullets cannot both hold: matching the CLI exactly means rejecting
 * nothing, and rejecting a slash means diverging from the CLI.
 *
 * A slash is not cosmetic. `--prefix "web/x"` produces keys like
 * `web/x1`, and the web UI routes tasks at `/tasks/$key`, so those
 * keys break their own task URLs.
 *
 * This is deliberately the **narrow** reading: reject only what
 * demonstrably breaks something (the characters that cannot survive a
 * URL path segment or a YAML scalar), and let everything else through
 * so a prefix the CLI accepted is not rejected here. It is recorded as
 * decision A78, with the conflict flagged rather than resolved
 * silently — the wider rule (uppercase-only, trailing `-` required)
 * would reject prefixes the CLI takes today, which is the half of
 * ONB-19 that would then fail.
 */

/**
 * K88/A80: a prefix is bare uppercase letters, 1–10. The `-` separator is
 * added automatically at key render, so it is NOT typed by the user.
 * Strict: anything else (dash, lowercase, digit, space, punctuation) is
 * rejected — the rule is stated, not silently normalised.
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
