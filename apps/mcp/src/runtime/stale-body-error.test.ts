import { PartialRemapError, StaleBodyWriteError, TaskNotFoundError } from "@loctt/core";
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

/**
 * MSL-33 (and PRU-34). A partly-landed remap on a label or project
 * delete must reach the agent as an errorResult carrying the honest
 * split, not be rethrown as an opaque server fault. `PartialRemapError`
 * extends `LocttError` directly rather than `ProjectError`/`LabelError`,
 * so it was NOT in the classifier's list until MSL-33 — an agent's
 * `delete_label` / `delete_project` with a failing task write saw a
 * server error instead of the "N moved, M failed by key, NOT deleted,
 * retry" message the error was built to carry.
 *
 * Same rationale as the K10 block above: over stdio the SDK renders a
 * rethrow as `isError: true` too, so the classification is only
 * observable at this layer.
 */
describe("PartialRemapError classification (MSL-33)", () => {
  // @verifies MSL-33
  it("is a known domain error, so the agent gets the split and the retry path", () => {
    const err = new PartialRemapError(3, ["T-2"], "label");
    expect(isKnownDomainError(err)).toBe(true);
    // The message is the whole report: what moved, what did not, and
    // that the label survives for a retry.
    expect(err.message).toContain("T-2");
    expect(err.message).toMatch(/label has NOT been deleted/i);
  });
});
