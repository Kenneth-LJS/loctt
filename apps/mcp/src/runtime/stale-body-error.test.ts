import { StaleBodyWriteError, TaskNotFoundError } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { isKnownDomainError } from "./errors.js";

/**
 * K10. A refused body write must be classified as a domain error.
 *
 * The dispatcher (`index.ts`) branches on this: known domain errors
 * become an `errorResult` carrying the message; anything else is
 * rethrown as a server fault on the grounds that it is a real bug.
 *
 * This is asserted here rather than through the stdio integration
 * suite for a measured reason: over stdio the two paths are
 * *indistinguishable* — the MCP SDK also catches a rethrown handler
 * error and renders it as `isError: true` with the same message. So
 * an end-to-end test cannot pin this classification, and one that
 * claimed to would be asserting nothing. This layer is the only place
 * the branch is observable.
 */
describe("StaleBodyWriteError classification (K10)", () => {
  it("is a known domain error, so the agent gets the retry instructions", () => {
    const err = new StaleBodyWriteError("T-1");
    expect(isKnownDomainError(err)).toBe(true);
    // The message is the agent's whole remedy; an errorResult forwards it.
    expect(err.message).toContain("NOT been saved");
  });

  it("still refuses to classify a genuine bug as a domain error", () => {
    // Positive control on the negative: if this helper returned true
    // for everything, the assertion above would be worthless.
    expect(isKnownDomainError(new TypeError("undefined is not a function"))).toBe(false);
    // And a control on the positive: an unrelated known error is known.
    expect(isKnownDomainError(new TaskNotFoundError("T-9"))).toBe(true);
  });
});
