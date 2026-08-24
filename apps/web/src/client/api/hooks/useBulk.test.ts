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
        failed: [{ taskId: "t9", error: "task not found" }],
        ...moved([["WEB-1", "OPS-1"]]),
      },
      "moved",
      id => (id === "t9" ? "T-9" : undefined),
    );
    expect(r.message).toBe("1 task moved: WEB-1 → OPS-1, 1 failed");
    // Named by its key: the selection holds ids, and an id means
    // nothing to the user (P-4).
    expect(r.failures).toEqual(["T-9: task not found"]);
  });

  // @verifies BLK-22
  it("never puts a bare ULID in the message when a key cannot be resolved", () => {
    const r = describeBulkResult(
      {
        bulk_op_id: "b",
        succeeded: [],
        failed: [{ taskId: "01ARCHVED00000000000000000", error: "task not found" }],
      },
      "updated",
      () => undefined,
    );
    // P-4 keeps ULIDs out of UI content. A failure on a task that is no
    // longer on the loaded page still has to be reported — described,
    // not named with an id that means nothing to the user.
    expect(r.failures[0]).not.toContain("01ARCHVED");
    // A non-ULID ref is echoed instead: it is whatever the caller sent,
    // and naming it is the most useful thing available.
    expect(r.failures[0]).toContain("no longer listed");
    expect(r.failures[0]).toContain("task not found");
  });


  // @verifies BLK-27
  it("keeps no-ops out of the count when something else failed", () => {
    const r = describeBulkResult(
      {
        bulk_op_id: "b",
        succeeded: ["t0", "t1"],
        unchanged: ["t1"],
        failed: [{ taskId: "t2", error: "task not found" }],
      },
      "archived",
      id => (id === "t2" ? "T-3" : undefined),
    );
    // Not "2 tasks archived, 1 failed": one of the two was already
    // archived. A failure elsewhere in the batch must not turn a no-op
    // back into a change.
    expect(r.message).toBe("1 task archived · 1 already archived, 1 failed");
  });

  // @verifies BLK-27
  it("does not say a task that was never archived was 'already restored'", () => {
    const r = describeBulkResult(
      { bulk_op_id: "b", succeeded: ["t0", "t1"], unchanged: ["t1"], failed: [] },
      "restored",
    );
    expect(r.message).toBe("1 task restored · 1 was not archived");
    expect(r.message).not.toContain("already restored");
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
