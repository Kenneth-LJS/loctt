import { describe, expect, it } from "vitest";

import { firstKeyPreview, PREFIX_RULE, prefixProblem } from "./prefix.ts";

/**
 * K88/A80's prefix rule, as a unit: a prefix is 1–10 uppercase letters,
 * the `-` separator is auto-added at render, and anything else is
 * rejected with the rule stated (not "invalid input"). This supersedes
 * the pre-K88 ONB-19 wording that accepted dashes/lowercase/unicode
 * (matching the old permissive CLI); the CLI is now strict too.
 */
describe("prefixProblem", () => {
  // @verifies ONB-19
  it("rejects a prefix that isn't 1–10 uppercase letters, stating the rule", () => {
    // The load-bearing rejections: a slash (would break `/tasks/$key`),
    // a space, and — new under K88 — a trailing dash (the separator is
    // added automatically, so the user must not type it), lowercase, and
    // digits.
    for (const bad of ["web/x", "a b", "a?b", "WEB-", "web", "T2", "ABCDEFGHIJK"]) {
      expect(prefixProblem(bad), bad).not.toBeNull();
    }
  });

  // @verifies ONB-19
  it("states the rule rather than 'invalid input'", () => {
    const msg = prefixProblem("web/x") ?? "";
    expect(msg).not.toMatch(/invalid input/i);
    expect(msg).toContain(PREFIX_RULE);
    // The rule names the uppercase-letters constraint and the auto-dash.
    expect(PREFIX_RULE).toMatch(/uppercase letters/i);
    expect(PREFIX_RULE).toMatch(/added automatically/i);
  });

  // @verifies ONB-19
  it("accepts a bare uppercase-letters prefix (K88)", () => {
    // The `-` is NOT typed — it is inserted at render. So the accepted
    // forms are bare letters only.
    expect(prefixProblem("T")).toBeNull();
    expect(prefixProblem("WEB")).toBeNull();
    expect(prefixProblem("PROJ")).toBeNull();
    expect(prefixProblem("ABCDEFGHIJ")).toBeNull(); // exactly 10
  });

  // @verifies ONB-20
  it("reports an empty prefix as a required field", () => {
    expect(prefixProblem("")).toMatch(/enter a key prefix/i);
    expect(prefixProblem("   ")).toMatch(/enter a key prefix/i);
  });
});

describe("firstKeyPreview", () => {
  // @verifies ONB-3
  it("previews the key init will actually allocate first, with the auto-dash", () => {
    // `defaultStateYaml` writes `next_number: 1`, and the `-` is inserted
    // at render (K88), so a bare prefix `WEB` previews as `WEB-1`.
    expect(firstKeyPreview("T")).toBe("T-1");
    expect(firstKeyPreview("WEB")).toBe("WEB-1");
  });
});
