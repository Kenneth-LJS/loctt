import { describe, expect, it } from "vitest";

import { describeBulkResult } from "./useBulk.ts";

/**
 * `describeBulkResult` is a pure string builder, and until now its only
 * exercise was a full browser + server + disk round trip. Four branches
 * exist; Playwright reaches two, and the partial-failure branch was
 * reached by nothing at all — so a move that half-failed rendered prose
 * nobody had ever looked at.
 */
describe("describeBulkResult", () => {
  const moved = (pairs: readonly [string, string][]): { moved: { taskId: string; old_key: string; new_key: string }[] } => ({
    moved: pairs.map(([o, n], i) => ({ taskId: `t${String(i)}`, old_key: o, new_key: n })),
  });

  it("states a plain count when nothing was rekeyed", () => {
    const r = describeBulkResult(
      { bulk_op_id: "b", succeeded: ["a", "b"], failed: [] },
      "updated",
    );
    expect(r.message).toBe("2 tasks updated");
    expect(r.failures).toEqual([]);
  });

  // @verifies BLK-9
  it("names each key change, old first", () => {
    const r = describeBulkResult(
      {
        bulk_op_id: "b",
        succeeded: ["t0", "t1"],
        failed: [],
        ...moved([["WEB-1", "OPS-1"], ["WEB-2", "OPS-2"]]),
      },
      "moved",
    );
    // The direction is the whole point: "OPS-1 → WEB-1" would tell the
    // user their task moved from a key that did not exist yet to one
    // that no longer does.
    expect(r.message).toBe("2 tasks moved: WEB-1 → OPS-1, WEB-2 → OPS-2");
  });

  // @verifies BLK-26
  it("omits a task that was already in the destination", () => {
    const r = describeBulkResult(
      {
        bulk_op_id: "b",
        succeeded: ["t0", "t1"],
        failed: [],
        ...moved([["OPS-1", "OPS-1"], ["WEB-2", "OPS-2"]]),
      },
      "moved",
    );
    // Reported as moved — it is a success — but not as a rekey, because
    // no key changed and no number was burned.
    expect(r.message).toBe("2 tasks moved: WEB-2 → OPS-2");
    expect(r.message).not.toContain("OPS-1 →");
  });

  it("keeps the key changes visible alongside a partial failure", () => {
    const r = describeBulkResult(
      {
        bulk_op_id: "b",
        succeeded: ["t0"],
        failed: [{ taskId: "T-9", error: "task not found" }],
        ...moved([["WEB-1", "OPS-1"]]),
      },
      "moved",
    );
    expect(r.message).toBe("1 task moved: WEB-1 → OPS-1, 1 failed");
    expect(r.failures).toEqual(["T-9: task not found"]);
  });

  it("says nothing moved rather than reporting zero successes", () => {
    const r = describeBulkResult(
      {
        bulk_op_id: "b",
        succeeded: [],
        failed: [{ taskId: "T-9", error: "task not found" }],
      },
      "moved",
    );
    expect(r.message).toBe("No tasks moved. 1 failed.");
  });
});
