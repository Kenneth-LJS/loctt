import { describe, expect, it } from "vitest";

import { firstKeyPreview, PREFIX_RULE, prefixProblem } from "./prefix.ts";

/**
 * ONB-19's rule, as a unit: the browser spec asserts the message
 * reaches the user, this asserts *which* prefixes it fires on.
 */
describe("prefixProblem", () => {
  // @verifies ONB-19
  it("rejects characters that would break the task's own URL, naming the character", () => {
    // A slash is the load-bearing one: `--prefix web/x` allocates
    // `web/x1`, and the app routes tasks at `/tasks/$key`.
    expect(prefixProblem("web/x")).toMatch(/cannot contain/i);
    expect(prefixProblem("web/x")).toContain("/");
    // A space is named in words rather than shown as an invisible
    // character between quotes.
    expect(prefixProblem("a b")).toContain("a space");
    expect(prefixProblem("a?b")).toMatch(/cannot contain/i);
    expect(prefixProblem("a#b")).toMatch(/cannot contain/i);
  });

  // @verifies ONB-19
  it("states the rule rather than 'invalid input'", () => {
    const msg = prefixProblem("web/x") ?? "";
    expect(msg).not.toMatch(/invalid input/i);
    // The allowed set and the trailing-dash convention are both said.
    expect(msg).toContain(PREFIX_RULE);
    expect(PREFIX_RULE).toMatch(/trailing - is conventional/i);
  });

  // @verifies ONB-19
  it("accepts what the CLI accepts, including forms a stricter rule would reject", () => {
    // Measured against the built CLI: `loctt init --prefix` takes all
    // of these. Rejecting them here would break ONB-19's "a value the
    // CLI would take is not rejected here".
    expect(prefixProblem("T-")).toBeNull();
    expect(prefixProblem("WEB-")).toBeNull();
    expect(prefixProblem("NODASH")).toBeNull();
    expect(prefixProblem("lowercase-")).toBeNull();
    expect(prefixProblem("Ünicode-")).toBeNull();
    expect(prefixProblem("a.b_c-")).toBeNull();
  });

  // @verifies ONB-20
  it("reports an empty prefix as a required field", () => {
    expect(prefixProblem("")).toMatch(/enter a key prefix/i);
    expect(prefixProblem("   ")).toMatch(/enter a key prefix/i);
  });
});

describe("firstKeyPreview", () => {
  // @verifies ONB-3
  it("previews the key init will actually allocate first", () => {
    // `defaultStateYaml` writes `next_number: 1`, so the first key is
    // `<prefix>1`. A preview of `<prefix>0` would be a promise the
    // tracker does not keep.
    expect(firstKeyPreview("T-")).toBe("T-1");
    expect(firstKeyPreview("WEB-")).toBe("WEB-1");
  });
});
