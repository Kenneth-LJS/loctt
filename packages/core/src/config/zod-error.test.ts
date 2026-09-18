import { describe, expect, it } from "vitest";
import { z } from "zod";

import { formatZodIssues } from "./zod-error.js";

function fail<T>(schema: z.ZodTypeAny, value: T): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected schema to reject value");
  return result.error;
}

describe("formatZodIssues", () => {
  describe("invalid_type", () => {
    it("formats missing required string as 'is required'", () => {
      const err = fail(z.object({ x: z.string() }), {});
      expect(formatZodIssues("root", err)).toBe("x is required (expected string)");
    });

    it("formats missing required boolean as 'is required'", () => {
      const err = fail(z.object({ enabled: z.boolean() }), {});
      expect(formatZodIssues("root", err)).toBe("enabled is required (expected boolean)");
    });

    it("formats missing required array as 'is required'", () => {
      const err = fail(z.object({ items: z.array(z.string()) }), {});
      expect(formatZodIssues("root", err)).toBe("items is required (expected array)");
    });

    it("formats wrong-type primitive as 'must be a <type>, got: <type>'", () => {
      const err = fail(z.object({ enabled: z.boolean() }), { enabled: "yes" });
      expect(formatZodIssues("root", err)).toBe("enabled must be a boolean, got: string");
    });

    it("uses 'an' before vowel-starting type names", () => {
      const err = fail(z.object({ items: z.array(z.string()) }), { items: 42 });
      expect(formatZodIssues("root", err)).toBe("items must be an array, got: number");
    });

    it("returns the prefix when the path is empty", () => {
      const err = fail(z.string(), 42);
      expect(formatZodIssues("payload", err)).toBe("payload must be a string, got: number");
    });
  });

  describe("too_small", () => {
    it("renders min(1) string as 'must be a non-empty string'", () => {
      const err = fail(z.object({ name: z.string().min(1) }), { name: "" });
      expect(formatZodIssues("root", err)).toBe("name must be a non-empty string");
    });

    it("renders numeric min as 'must be >= N'", () => {
      const err = fail(z.object({ n: z.number().int().min(1) }), { n: 0 });
      expect(formatZodIssues("root", err)).toBe("n must be >= 1");
    });

    it("renders array min(1) as 'must contain at least one item'", () => {
      const err = fail(z.object({ xs: z.array(z.string()).min(1) }), { xs: [] });
      expect(formatZodIssues("root", err)).toBe("xs must contain at least one item");
    });
  });

  describe("invalid_value (enum)", () => {
    it("renders enum mismatch with quoted options", () => {
      const err = fail(z.enum(["a", "b", "c"]), "d");
      expect(formatZodIssues("payload", err)).toBe(
        `payload must be one of: "a", "b", "c"`,
      );
    });

    it("includes path for nested enum mismatch", () => {
      const err = fail(
        z.object({ direction: z.enum(["asc", "desc"]) }),
        { direction: "sideways" },
      );
      expect(formatZodIssues("root", err)).toBe(
        `direction must be one of: "asc", "desc"`,
      );
    });
  });

  describe("custom refinement", () => {
    it("preserves the refinement's own message", () => {
      const err = fail(
        z.string().regex(/^[a-z]+$/, "must be lowercase letters"),
        "ABC",
      );
      expect(formatZodIssues("name", err)).toBe("name must be lowercase letters");
    });
  });

  describe("path formatting", () => {
    it("joins object/array paths into a.b[0].c form", () => {
      const err = fail(
        z.object({ a: z.array(z.object({ c: z.string() })) }),
        { a: [{ c: 42 }] },
      );
      expect(formatZodIssues("root", err)).toBe(
        "a[0].c must be a string, got: number",
      );
    });
  });

  describe("multi-issue errors", () => {
    it("joins multiple issues with semicolons", () => {
      const err = fail(
        z.object({ a: z.string(), b: z.number() }),
        { a: 1, b: "two" },
      );
      const formatted = formatZodIssues("root", err);
      expect(formatted).toContain("a must be a string, got: number");
      expect(formatted).toContain("b must be a number, got: string");
      expect(formatted).toContain("; ");
    });
  });

  describe("empty error", () => {
    it("falls back to '<prefix> is invalid' when issues array is empty", () => {
      const empty = new z.ZodError([]);
      expect(formatZodIssues("payload", empty)).toBe("payload is invalid");
    });
  });
});

/**
 * @verifies XS-62
 *
 * A message the schema author wrote must survive. This module exists
 * to insulate the surface from zod's wording changing under it — not
 * from ours — and overriding an author's message silently replaced
 * domain constraints with generic ones. `projects.yaml` says "at
 * least one project is required"; this was rewriting it to "projects
 * must contain at least one item", which states neither the domain
 * rule nor its fix.
 */
describe("author-supplied messages", () => {
  it("keeps a custom message on an array minimum", () => {
    const schema = z.object({
      projects: z.array(z.string()).min(1, "at least one project is required"),
    });
    const result = schema.safeParse({ projects: [] });
    expect(result.success).toBe(false);
    if (result.success) return;

    const text = formatZodIssues("projects.yaml", result.error);
    expect(text).toContain("at least one project is required");
    expect(text).not.toContain("must contain at least one item");
  });

  it("keeps a custom message on a string minimum", () => {
    const schema = z.object({ name: z.string().min(1, "every project needs a name") });
    const result = schema.safeParse({ name: "" });
    if (result.success) throw new Error("expected a failure");

    const text = formatZodIssues("projects.yaml", result.error);
    expect(text).toContain("every project needs a name");
    expect(text).not.toContain("non-empty string");
  });

  it("still normalises zod's own default wording", () => {
    // The whole point of the module: with no author message, the
    // stable phrasing is used rather than zod's, which changes
    // between versions.
    const schema = z.object({ enabled: z.boolean() });
    const result = schema.safeParse({ enabled: "yes" });
    if (result.success) throw new Error("expected a failure");

    const text = formatZodIssues("workflow.yaml", result.error);
    expect(text).toContain("must be a boolean, got: string");
    expect(text).not.toContain("Invalid input:");
  });

  it("still normalises a default array minimum", () => {
    const schema = z.object({ items: z.array(z.string()).min(1) });
    const result = schema.safeParse({ items: [] });
    if (result.success) throw new Error("expected a failure");

    const text = formatZodIssues("workflow.yaml", result.error);
    expect(text).toContain("must contain at least one item");
    expect(text).not.toContain("Too small:");
  });
});
