import { describe, expect, it } from "vitest";

import { describeBulkResult } from "./useBulk.ts";

/**
 * How a bulk result is put into words.
 *
 * ERR-26 is specifically about the *plural* failure: five tasks
 * failing for five different reasons must yield five reasons, each
 * attached to its task. Collapsing them into "5 tasks failed" or a
 * most-common-error summary throws away the only information that
 * makes any of them fixable.
 */

const KEYS: Record<string, string> = {
  "01M0AAAA000000000000000001": "T-1",
  "01M0AAAA000000000000000002": "T-2",
  "01M0AAAA000000000000000003": "T-3",
  "01M0AAAA000000000000000004": "T-4",
  "01M0AAAA000000000000000005": "T-5",
};
const keyOf = (id: string): string | undefined => KEYS[id];

describe("describeBulkResult", () => {
  /**
   * @verifies ERR-26
   */
  it("lists every distinct reason, attached to its own task", () => {
    const reasons = [
      "milestone is archived",
      "task not found",
      "permission denied",
      "task.md could not be parsed",
      "unknown status key: shipped",
    ];
    const result = {
      bulk_op_id: "op",
      succeeded: [],
      failed: Object.keys(KEYS).map((taskId, i) => ({
        taskId,
        error: reasons[i] ?? "",
      })),
    };

    const { message, failures } = describeBulkResult(result, "updated", keyOf);

    // Five reasons, not one summary line.
    expect(failures).toHaveLength(5);
    for (const [i, reason] of reasons.entries()) {
      const line = failures[i] ?? "";
      // Each carries its own reason...
      expect(line).toContain(reason);
      // ...attached to the key the user recognises, not a ULID.
      expect(line).toContain(`T-${i + 1}`);
      expect(line).not.toMatch(/01M0[A-Z0-9]{22}/);
    }

    // Nothing succeeded, and the headline says so plainly rather than
    // reporting zero successes as a partial result.
    expect(message).toMatch(/No tasks updated/);
    expect(message).toContain("5 failed");
    // The reasons are not collapsed into the headline either.
    for (const reason of reasons) {
      expect(message).not.toContain(reason);
    }
  });

  /**
   * @verifies ERR-26
   *
   * "Reasons are not collapsed into a most-common-error summary."
   * Four tasks failing the same way still produce four lines, because
   * which four is what the user needs to know.
   */
  it("does not deduplicate identical reasons", () => {
    const ids = Object.keys(KEYS).slice(0, 4);
    const result = {
      bulk_op_id: "op",
      succeeded: [],
      failed: ids.map(taskId => ({ taskId, error: "milestone is archived" })),
    };

    const { failures } = describeBulkResult(result, "updated", keyOf);
    expect(failures).toHaveLength(4);
    expect(new Set(failures).size).toBe(4);
  });

  /**
   * @verifies ERR-26
   *
   * A partial result reports both halves. Losing the successes would
   * be as misleading as losing the reasons.
   */
  it("reports the successes alongside every failure", () => {
    const ids = Object.keys(KEYS);
    const result = {
      bulk_op_id: "op",
      succeeded: ids.slice(0, 3),
      failed: [
        { taskId: ids[3] ?? "", error: "permission denied" },
        { taskId: ids[4] ?? "", error: "task not found" },
      ],
    };

    const { message, failures } = describeBulkResult(result, "archived", keyOf);
    expect(message).toContain("3");
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("permission denied");
    expect(failures[1]).toContain("task not found");
  });
});
