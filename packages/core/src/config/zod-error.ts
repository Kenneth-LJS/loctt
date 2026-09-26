import type { z } from "zod";

/**
 * Renders a zod ZodError into a stable, human-readable single
 * sentence — one issue per line, semicolon-separated for
 * multi-issue errors:
 *
 *   labels[0].key must be a slug, got: "1bad"; labels[1].label must be a non-empty string
 *
 * Why translate instead of using zod's own messages?  Zod's
 * default messages are good but they drift between minor
 * versions ("Invalid input: expected string, received undefined"
 * → "Required" → ...), and assertions in our test suite would
 * break every time. We standardize the most common codes here so
 * the parser layer's error contract is ours to evolve.
 *
 * `prefix` is what to call the root in the error if a top-level
 * issue happens (e.g. "labels config", "task frontmatter").
 */
export function formatZodIssues(prefix: string, err: z.ZodError): string {
  if (err.issues.length === 0) return `${prefix} is invalid`;
  return err.issues
    .map(issue => {
      const pathSegs = issue.path.map(seg =>
        typeof seg === "number" ? `[${seg}]` : `.${String(seg)}`,
      );
      const path = pathSegs.length === 0
        ? prefix
        : pathSegs.join("").replace(/^\./, "");
      return `${path} ${stableMessage(issue)}`;
    })
    .join("; ");
}

/**
 * Fields removed from a schema, mapped to what replaced them.
 *
 * `.strict()` rejects an unknown key before any `superRefine` runs, so
 * a removed field cannot explain itself from inside its own schema —
 * the rejection happens first. This is where the explanation goes.
 *
 * Keyed by bare field name rather than full path: these names are
 * distinctive enough that a collision would be a naming problem in its
 * own right.
 */
const REMOVED_FIELD_HINTS: Readonly<Record<string, string>> = {
  structural:
    "'structural' was replaced by 'graph': use graph: tree for a hierarchy (cycles rejected, drawable as a tree axis), or graph: acyclic to reject cycles only.",
};

interface ZodLikeIssue {
  readonly code: string;
  readonly message: string;
  readonly expected?: unknown;
  readonly received?: unknown;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
  readonly origin?: unknown;
  readonly type?: unknown;
  readonly inclusive?: unknown;
  readonly options?: unknown;
  readonly values?: unknown;
  readonly keys?: unknown;
}

/**
 * Translates the most common zod issue codes into stable
 * human-readable messages. Uncovered codes fall back to the
 * issue's default message.
 *
 * A message the *schema author* supplied always wins. The point of
 * this function is insulating the surface from zod's own wording
 * changing under it — not from ours. Overriding an author's message
 * silently replaced domain constraints with generic ones: XS-62
 * requires `projects.yaml` to state "at least one project is
 * required", which the schema says in exactly those words, and this
 * was rewriting it to "projects must contain at least one item".
 */
function stableMessage(issue: z.ZodIssue): string {
  const custom = customMessage(issue);
  if (custom !== undefined) return custom;

  // Zod v4's discriminated union uses different field names per
  // code (origin vs type, values vs options); read everything
  // generically so the test surface stays stable.
  const i = issue as unknown as ZodLikeIssue;

  switch (i.code) {
    case "invalid_type": {
      const expected = asScalarString(i.expected, "value");
      // zod v4 raises invalid_type for missing-required (received
      // is omitted from the issue) AND for wrong-type (received
      // present). The default message says "received undefined"
      // for missing keys, "received <type>" for wrong type.
      const isMissing =
        i.received === undefined
        && /received undefined/.test(issue.message);
      if (isMissing) {
        return `is required (expected ${expected})`;
      }
      const received = asScalarString(
        i.received ?? extractReceived(issue.message),
        "value",
      );
      const article = /^[aeiou]/i.test(expected) ? "an" : "a";
      return `must be ${article} ${expected}, got: ${received}`;
    }
    case "too_small": {
      const min = asScalarString(i.minimum, "");
      const origin = asScalarString(i.origin ?? i.type, "");
      if (origin === "string" && min === "1") return `must be a non-empty string`;
      if (origin === "array" && min === "1") return `must contain at least one item`;
      if (origin === "number") return `must be >= ${min}`;
      return `is too small (min ${min})`;
    }
    case "too_big": {
      const max = asScalarString(i.maximum, "");
      const origin = asScalarString(i.origin ?? i.type, "");
      if (origin === "number") return `must be <= ${max}`;
      return `is too large (max ${max})`;
    }
    case "invalid_value":
    case "invalid_enum_value": {
      const list = (Array.isArray(i.values) ? i.values
        : Array.isArray(i.options) ? i.options
        : []) as readonly unknown[];
      return list.length > 0
        ? `must be one of: ${list.map(o => JSON.stringify(o)).join(", ")}`
        : `is not one of the allowed values`;
    }
    case "invalid_format":
    case "invalid_string": {
      // Brand types and z.string().regex() bubble through here
      // — our schemas attach a custom message for each, so
      // prefer that over a generic.
      return issue.message || `has an invalid format`;
    }
    case "unrecognized_keys": {
      const rawKeys = Array.isArray(i.keys) ? (i.keys as unknown[]) : [];
      const keys = rawKeys.map(k => JSON.stringify(k)).join(", ");
      // A removed-and-replaced field is the common case behind an
      // unrecognized key in a hand-edited config. The bare "has
      // unrecognized key(s)" leaves the reader to guess the new
      // spelling, so name it where we know one.
      const hints = rawKeys
        .map(k => (typeof k === "string" ? REMOVED_FIELD_HINTS[k] : undefined))
        .filter((h): h is string => h !== undefined);
      const hint = hints.length > 0 ? `. ${hints.join(" ")}` : "";
      return keys.length > 0
        ? `has unrecognized key(s): ${keys}${hint}`
        : `has unrecognized keys`;
    }
    case "custom":
      return issue.message;
    default:
      return issue.message;
  }
}

/**
 * Extracts the "received: <type>" tail from zod's default
 * invalid_type message when the issue object doesn't expose
 * `received` directly. Returns undefined when not found.
 */
function extractReceived(message: string): string | undefined {
  const m = /received\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(message);
  return m ? m[1] : undefined;
}

/**
 * Coerces a possibly-unknown zod field into a string suitable for
 * error rendering. Strings/numbers/booleans pass through as-is;
 * objects/arrays fall back to a sentinel because their default
 * `toString()` is "[object Object]" / "1,2,3" — not useful in an
 * error message. Returns `fallback` for null/undefined.
 */
function asScalarString(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

/**
 * Formats a caught value if it is a ZodError, else returns null.
 *
 * Exists so surfaces without a zod dependency — the CLI — can turn a
 * validator error into prose without importing zod or knowing its
 * shape. Printing a ZodError's `.message` raw yields the serialized
 * issue array, which is what TSK-C1 forbids.
 */
export function formatIfZodError(err: unknown, prefix: string): string | null {
  // Structural check, not `instanceof`: this module imports zod as a
  // type only, and keeping it that way means core does not pull zod
  // into every consumer's runtime. A ZodError is identifiable by its
  // issues array regardless of which zod copy produced it — which also
  // makes this correct across duplicated installs, where instanceof
  // silently fails.
  if (err === null || typeof err !== "object") return null;
  const issues = (err as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;
  return formatZodIssues(prefix, err as z.ZodError);
}

/**
 * The message an author attached to a schema rule, or undefined when
 * the issue carries only zod's default.
 *
 * Zod does not flag which of the two an issue holds, so this compares
 * against what zod would have produced for the same issue with no
 * custom message. Anything different was written by us.
 */
function customMessage(issue: z.ZodIssue): string | undefined {
  const isDefault = defaultMessagesFor(issue).some(d =>
    typeof d === "string" ? d === issue.message : d.test(issue.message),
  );
  return isDefault ? undefined : issue.message;
}

/** Escapes a string for literal use inside a RegExp. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The default messages zod emits for an issue, for the codes this
 * module rewrites.
 *
 * Listed rather than derived because zod builds them from an internal
 * locale table that is not exported. Getting an entry wrong is safe in
 * one direction only: a missed default leaks zod's wording through as
 * if it were ours, which is a cosmetic regression rather than a lost
 * constraint. Missing a *custom* message is the failure that matters,
 * and that cannot happen — an unlisted default simply passes through.
 */
function defaultMessagesFor(issue: z.ZodIssue): readonly (string | RegExp)[] {
  const i = issue as unknown as ZodLikeIssue;
  switch (i.code) {
    case "invalid_type":
      // `received` is absent from the issue object even when the
      // message names it, so this matches the message's shape rather
      // than rebuilding it from fields that are not there.
      return [
        new RegExp(`^Invalid input: expected ${escapeRe(String(i.expected))}(, received .+)?$`),
      ];
    case "too_small":
      return [
        `Too small: expected ${String(i.origin ?? i.type)} to have >=${String(i.minimum)} characters`,
        `Too small: expected ${String(i.origin ?? i.type)} to have >=${String(i.minimum)} items`,
        `Too small: expected ${String(i.origin ?? i.type)} to be >=${String(i.minimum)}`,
      ];
    case "too_big":
      return [
        `Too big: expected ${String(i.origin ?? i.type)} to have <=${String(i.maximum)} characters`,
        `Too big: expected ${String(i.origin ?? i.type)} to have <=${String(i.maximum)} items`,
        `Too big: expected ${String(i.origin ?? i.type)} to be <=${String(i.maximum)}`,
      ];
    default:
      // Codes this module does not rewrite fall through to the issue's
      // own message anyway, so the distinction does not arise.
      return [issue.message];
  }
}
