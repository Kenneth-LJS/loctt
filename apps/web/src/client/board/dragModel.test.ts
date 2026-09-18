import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { BoardColumn } from "./columns.ts";
import {
  insertionIndex,
  isNoOpDrop,
  needsStatusWrite,
  neighboursAt,
  statusForColumn,
} from "./dragModel.ts";

function card(key: string, rank?: string): TaskFrontmatterPublic {
  return {
    id: `id-${key}`,
    key,
    title: key,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "not_started",
    ...(rank !== undefined ? { board_rank: rank } : {}),
  } as TaskFrontmatterPublic;
}

function column(id: string, statuses: string[]): BoardColumn {
  return { id, label: id, statuses, kind: "configured" };
}

describe("insertionIndex", () => {
  const rects = [
    { top: 0, bottom: 100 },
    { top: 100, bottom: 200 },
    { top: 200, bottom: 300 },
  ];

  // @verifies BRD-25
  //
  // A pointer above the first card's midpoint lands at index 0, which
  // is what makes the top-of-column drop reachable at all.
  it("lands at the top when the pointer is above the first midpoint", () => {
    expect(insertionIndex(10, rects)).toBe(0);
    expect(insertionIndex(49, rects)).toBe(0);
  });

  // @verifies BRD-26
  //
  // Past the last card's midpoint the slot is the end. Comparing
  // against each card's *top* edge instead would make this index
  // unreachable — the pointer would have to leave the column.
  it("lands at the end when the pointer is below the last midpoint", () => {
    expect(insertionIndex(280, rects)).toBe(3);
    expect(insertionIndex(9999, rects)).toBe(3);
  });

  it("lands between two cards at their shared boundary", () => {
    // Past card 0's midpoint (50), before card 1's midpoint (150).
    expect(insertionIndex(120, rects)).toBe(1);
    // Past card 1's midpoint, before card 2's (250).
    expect(insertionIndex(210, rects)).toBe(2);
  });

  it("lands at index 0 in an empty column", () => {
    expect(insertionIndex(42, [])).toBe(0);
  });
});

describe("neighboursAt", () => {
  const cards = [card("A"), card("B"), card("C")];

  // @verifies BRD-25
  it("has no `after` at the top of a column", () => {
    expect(neighboursAt(cards, 0)).toEqual({ before: "A" });
  });

  // @verifies BRD-26
  it("has no `before` at the bottom of a column", () => {
    expect(neighboursAt(cards, 3)).toEqual({ after: "C" });
  });

  // @verifies BRD-9
  //
  // The rank the server computes must fall strictly between these two,
  // so naming the wrong pair puts the card in the wrong place.
  it("names the flanking pair for a middle slot", () => {
    expect(neighboursAt(cards, 1)).toEqual({ after: "A", before: "B" });
    expect(neighboursAt(cards, 2)).toEqual({ after: "B", before: "C" });
  });

  it("has neither neighbour in an empty column", () => {
    expect(neighboursAt([], 0)).toEqual({});
  });
});

describe("isNoOpDrop", () => {
  // A, B, D remain after C (the dragged card) is lifted out. C sat
  // between B and D.
  const rest = [card("A"), card("B"), card("D")];
  const originNeighbours = { after: "B", before: "D" };

  // @verifies BRD-31
  //
  // Dropping back between the same two cards must issue no request.
  // Index 2 of the remaining list is the slot between B and D.
  it("is a no-op when the card is dropped between its own neighbours", () => {
    expect(isNoOpDrop("todo", { columnId: "todo", index: 2 }, rest, originNeighbours))
      .toBe(true);
  });

  // @verifies BRD-31
  //
  // The reason this compares neighbours rather than indices. While the
  // card is held it is out of the flow, so the cards below shift up
  // and the pointer's original pixel resolves to a DIFFERENT index
  // than the card started at. An index comparison sent a request for a
  // drop that moved nothing — measured, and caught by the BRD-31 spec.
  it("is a no-op at the top of a column, where there is no `after`", () => {
    // The dragged card was first, so it had no card above it. The
    // equivalent slot in the remaining list is index 0 — and an
    // `after` of `undefined` must compare equal to an absent `after`,
    // not be treated as a different position.
    expect(isNoOpDrop("todo", { columnId: "todo", index: 0 }, rest, { before: "A" }))
      .toBe(true);
    // One slot down is genuinely different.
    expect(isNoOpDrop("todo", { columnId: "todo", index: 1 }, rest, { before: "A" }))
      .toBe(false);
  });

  // @verifies BRD-31
  //
  // Both neighbours have to match. Checking only one of them makes a
  // genuine move at the end of a column look like a no-op: dropping
  // after D and dropping after B both have no `before`, so a
  // `before`-only comparison would silently swallow the write.
  it("requires both neighbours to match, not just one", () => {
    // Same `before` (undefined, end of column) but a different `after`.
    expect(isNoOpDrop("todo", { columnId: "todo", index: 3 }, rest, { after: "B" }))
      .toBe(false);
    // Same `after` but a different `before`.
    expect(isNoOpDrop("todo", { columnId: "todo", index: 2 }, rest, { after: "B" }))
      .toBe(false);
  });

  it("is not a no-op when the position changes", () => {
    // Index 3 is after D — a different pair.
    expect(isNoOpDrop("todo", { columnId: "todo", index: 3 }, rest, originNeighbours))
      .toBe(false);
    // Index 1 is between A and B.
    expect(isNoOpDrop("todo", { columnId: "todo", index: 1 }, rest, originNeighbours))
      .toBe(false);
  });

  // @verifies BRD-31
  //
  // Crossing a column is never a no-op even at the same index — the
  // status changes, which is the whole point of the move.
  it("is never a no-op across columns", () => {
    expect(isNoOpDrop("todo", { columnId: "doing", index: 2 }, rest, originNeighbours))
      .toBe(false);
  });
});

describe("statusForColumn", () => {
  // @verifies BRD-13
  //
  // A column collapsing several statuses writes the FIRST entry,
  // deterministically — not the last, and not an arbitrary pick.
  it("adopts the first status of a multi-status column", () => {
    expect(statusForColumn(column("flight", ["in_progress", "in_review", "blocked"])))
      .toBe("in_progress");
  });

  // @verifies BRD-13
  //
  // Reordering `statuses` in workflow.yaml changes what a drop writes.
  // This is the second bullet of the case, and it is what "first, not
  // arbitrary" actually means.
  it("follows a reordered statuses array", () => {
    expect(statusForColumn(column("flight", ["blocked", "in_progress", "in_review"])))
      .toBe("blocked");
  });

  it("has no status for a column that lists none", () => {
    expect(statusForColumn(column("empty", []))).toBeUndefined();
  });
});

describe("needsStatusWrite", () => {
  // @verifies BRD-12
  // @verifies XS-9
  //
  // A reorder inside a multi-status column must NOT rewrite status: a
  // `blocked` card dragged above an `in_progress` one stays `blocked`.
  // Returning true here is what would clobber it.
  it("does not write status for a reorder inside one column", () => {
    const flight = column("flight", ["in_progress", "in_review", "blocked"]);
    expect(needsStatusWrite("flight", flight)).toBe(false);
  });

  // @verifies BRD-12
  it("writes status when the card leaves its column", () => {
    const done = column("done", ["completed"]);
    expect(needsStatusWrite("flight", done)).toBe(true);
  });
});
