import { StaleBodyWriteError } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { KNOWN_DOMAIN_ERRORS } from "./errors.js";

/**
 * K10. A refused body write is listed as a CLI domain error.
 *
 * **What this does and does not prove, measured.** The observable
 * behaviour is the same either way: `main()`'s outer catch also prints
 * `Error: <message>` and exits 1, so no end-to-end CLI test can tell a
 * registered error from an unregistered one — verified by deleting the
 * entry and watching the integration suite stay green.
 *
 * What the list still controls is real: `runCommand`'s branch is where
 * a `LocttError`'s `detail` gets printed, and the list is the repo's
 * stated convention for "this failure is a rejection, not a crash".
 * So the membership is asserted here directly, at the only layer where
 * it is visible, rather than through a test that would appear to cover
 * it while asserting nothing.
 */
describe("StaleBodyWriteError is a CLI domain error (K10)", () => {
  it("is in KNOWN_DOMAIN_ERRORS, so a refusal is a rejection not a crash", () => {
    const err = new StaleBodyWriteError("T-1");
    const matched = KNOWN_DOMAIN_ERRORS.some(K => err instanceof K);
    expect(matched).toBe(true);
  });

  it("does not match an unrelated bug", () => {
    // Control: a list that matched everything would make the above vacuous.
    const bug = new TypeError("undefined is not a function");
    expect(KNOWN_DOMAIN_ERRORS.some(K => bug instanceof K)).toBe(false);
  });
});
