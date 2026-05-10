import { z } from "zod";

/**
 * Refined string primitives shared across config schemas. Each is
 * a z.string() with a regex refinement; the inferred TypeScript
 * type stays as plain `string` so callsites that already produce
 * known-good values don't need to round-trip through a parser to
 * satisfy the type checker. The runtime validation runs at the
 * YAML boundary, where untrusted input enters.
 */

/** YYYY-MM-DD calendar date. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export type IsoDate = z.infer<typeof IsoDate>;

/**
 * lowercase-letters/digits/hyphens/underscores slug, used for
 * project/label/milestone keys. Must start with a letter or
 * digit (no leading dash or underscore).
 */
export const SlugKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "must be a slug (lowercase letters, digits, hyphen, underscore; no leading separator)");
export type SlugKey = z.infer<typeof SlugKey>;

/**
 * Sprint keys allow dots in addition to slug characters. Common
 * pattern: sprint_2026.q1 or 2026.q1-iteration-3.
 */
export const SprintKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, "must be a slug (lowercase letters, digits, hyphen, dot, underscore)");
export type SprintKey = z.infer<typeof SprintKey>;

/**
 * Hex color string. Accepts 3- and 6-digit lowercase or uppercase
 * forms, optionally prefixed with `#`. Stored as the value the
 * user wrote — no normalization.
 */
export const HexColor = z
  .string()
  .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color (e.g. #1e6fcb or #f00)");
export type HexColor = z.infer<typeof HexColor>;

/**
 * IANA timezone identifier. Validated against
 * Intl.supportedValuesOf("timeZone") when available; falls back
 * to a coarse syntactic check on older runtimes.
 */
const SUPPORTED_TIMEZONES: ReadonlySet<string> | null = (() => {
  try {
    // Node 18+ exposes Intl.supportedValuesOf
    const fn = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof fn === "function") {
      return new Set(fn.call(Intl, "timeZone"));
    }
  } catch {
    // ignore
  }
  return null;
})();

export const IanaTimezone = z
  .string()
  .superRefine((value, ctx) => {
    if (SUPPORTED_TIMEZONES !== null) {
      // UTC isn't always in the list on every runtime; accept it explicitly.
      if (value === "UTC" || SUPPORTED_TIMEZONES.has(value)) return;
      ctx.addIssue({ code: "custom", message: `unknown IANA timezone: ${value}` });
      return;
    }
    // Fallback: at least require Region/City shape or "UTC".
    if (value === "UTC") return;
    if (!/^[A-Z][A-Za-z_]+\/[A-Z][A-Za-z_/+\-0-9]*$/.test(value)) {
      ctx.addIssue({ code: "custom", message: `not a recognizable IANA timezone: ${value}` });
    }
  });
export type IanaTimezone = z.infer<typeof IanaTimezone>;
