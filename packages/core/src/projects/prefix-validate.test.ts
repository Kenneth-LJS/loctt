import { describe, expect, it } from "vitest";

import { ProjectError } from "./manage.js";
import { assertValidPrefix, PREFIX_RE } from "./prefix.js";

/**
 * K88/A80: the task-key prefix is bare uppercase letters, 1–10. The `-`
 * separator is inserted at key render (so a stored prefix "WEB" produces
 * "WEB-1"), which means a dash is NOT part of the stored prefix and is
 * strictly rejected on input — not normalised.
 *
 * @verifies A80
 */
describe("assertValidPrefix (K88/A80)", () => {
  it("accepts 1–10 uppercase letters", () => {
    for (const ok of ["T", "WEB", "PROJ", "ABCDEFGHIJ"]) {
      expect(() => { assertValidPrefix(ok); }, ok).not.toThrow();
    }
  });

  it("rejects a trailing dash — the separator is auto-added, not typed", () => {
    expect(() => { assertValidPrefix("T-"); }).toThrow(ProjectError);
    expect(() => { assertValidPrefix("WEB-"); }).toThrow(ProjectError);
  });

  it("rejects lowercase, digits, spaces, punctuation, and over-length", () => {
    for (const bad of ["web", "T2", "a b", "web/x", "A_B", "", "ABCDEFGHIJK"]) {
      expect(() => { assertValidPrefix(bad); }, bad).toThrow(ProjectError);
    }
  });

  it("the error names the rule (uppercase letters, auto-dash), not 'invalid input'", () => {
    let msg = "";
    try { assertValidPrefix("web-"); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/uppercase letters/i);
    expect(msg).toMatch(/WEB-1|added automatically/i);
    expect(msg).not.toMatch(/invalid input/i);
  });

  it("PREFIX_RE matches exactly the bare-uppercase form", () => {
    expect(PREFIX_RE.test("WEB")).toBe(true);
    expect(PREFIX_RE.test("WEB-")).toBe(false);
    expect(PREFIX_RE.test("web")).toBe(false);
  });
});
