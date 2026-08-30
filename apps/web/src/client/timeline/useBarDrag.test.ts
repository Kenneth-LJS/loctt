import { describe, expect, it } from "vitest";

import { applyDelta } from "./useBarDrag.ts";

/**
 * The drag's date arithmetic (TML-9, TML-10, TML-11, TML-36).
 *
 * `applyDelta` is the whole of what the three drags *mean*, and it is
 * tested here rather than only through the browser because a UI test
 * asserting "the bar moved" passes whether the delta was applied to
 * one end, the other, or both. The payload shape and the file contents
 * are pinned in `tests/ui/flow-timeline.spec.ts`; the arithmetic is
 * pinned here.
 */

describe("applyDelta", () => {
  // @verifies TML-9
  it("TML-9: an end-edge drag moves due_date and leaves start_date alone", () => {
    const r = applyDelta("end", "2026-03-02", "2026-03-06", 3);
    expect(r.due).toBe("2026-03-09");
    expect(r.start).toBe("2026-03-02");
  });

  // @verifies TML-10
  it("TML-10: a start-edge drag moves start_date and leaves due_date alone", () => {
    const r = applyDelta("start", "2026-03-02", "2026-03-06", -2);
    expect(r.start).toBe("2026-02-28");
    // TML-10's second bullet: the right edge does not move at all.
    expect(r.due).toBe("2026-03-06");
  });

  // @verifies TML-11
  it("TML-11: a body drag applies an identical delta to both dates", () => {
    const r = applyDelta("body", "2026-03-02", "2026-03-06", 4);
    expect(r.start).toBe("2026-03-06");
    expect(r.due).toBe("2026-03-10");
  });

  // @verifies TML-11
  it("TML-11: a body drag preserves the duration exactly", () => {
    // The off-by-one this rules out is a start that moves 4 days and a
    // due that moves 3 — the bar would still "move", and would be a
    // day shorter. Asserted as a span so the failure names the defect.
    for (const delta of [-11, -1, 0, 1, 4, 30]) {
      const r = applyDelta("body", "2026-03-02", "2026-03-06", delta);
      const days =
        (Date.parse(`${r.due}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86_400_000;
      expect(days).toBe(4);
    }
  });

  // @verifies TML-11
  it("TML-11: a body drag across a month boundary keeps both deltas equal", () => {
    // Naive month arithmetic ("day 2 + 30 = day 32") is where the two
    // ends drift apart; a 5-day bar dragged over the end of February
    // is where it shows.
    const r = applyDelta("body", "2026-02-25", "2026-03-01", 10);
    expect(r.start).toBe("2026-03-07");
    expect(r.due).toBe("2026-03-11");
  });

  // @verifies TML-36
  it("TML-36: an end-edge drag stops at a one-day bar, never zero or negative", () => {
    // A 5-day bar dragged 40 days left: the due date clamps to the
    // start, giving a one-day span rather than an inverted bar.
    const r = applyDelta("end", "2026-03-02", "2026-03-06", -40);
    expect(r.due).toBe("2026-03-02");
    expect(r.start).toBe("2026-03-02");
  });

  // @verifies TML-36
  it("TML-36: a start-edge drag stops at a one-day bar too", () => {
    const r = applyDelta("start", "2026-03-02", "2026-03-06", 40);
    expect(r.start).toBe("2026-03-06");
    expect(r.due).toBe("2026-03-06");
  });

  // @verifies TML-22
  it("TML-22: a drag onto a leap day writes 02-29, not 03-01", () => {
    // 2028 is a leap year. An implementation that stepped by months or
    // assumed 28-day Februaries lands on 03-01 here.
    const r = applyDelta("end", "2028-02-20", "2028-02-25", 4);
    expect(r.due).toBe("2028-02-29");
  });

  // @verifies TML-22
  it("TML-22: a body drag across a leap day keeps its span", () => {
    const r = applyDelta("body", "2028-02-27", "2028-03-02", 1);
    expect(r.start).toBe("2028-02-28");
    expect(r.due).toBe("2028-03-03");
  });

  // @verifies TML-23
  it("TML-23: a drag across a DST transition shifts by whole calendar days", () => {
    // 2026-03-08 is the US spring-forward. Local-time arithmetic makes
    // that day 23 hours long, so a delta of 7 lands on the 14th
    // instead of the 15th. These are civil dates and must not care.
    const r = applyDelta("body", "2026-03-05", "2026-03-11", 7);
    expect(r.start).toBe("2026-03-12");
    expect(r.due).toBe("2026-03-18");

    // And the November fall-back, where the extra hour pushes the
    // other way.
    const back = applyDelta("body", "2026-10-30", "2026-11-05", 7);
    expect(back.start).toBe("2026-11-06");
    expect(back.due).toBe("2026-11-12");
  });

  // @verifies TML-39
  it("TML-39: a zero delta returns the dates unchanged, so the caller can see a no-op", () => {
    const r = applyDelta("body", "2026-03-02", "2026-03-06", 0);
    expect(r.start).toBe("2026-03-02");
    expect(r.due).toBe("2026-03-06");
  });

  // @verifies TML-39
  it("TML-39: a clamped edge drag that lands where it started is a no-op by value", () => {
    // The hook compares resulting *dates*, not the delta, precisely so
    // this counts as a no-op: the gesture travelled, the dates did not.
    const already = applyDelta("end", "2026-03-02", "2026-03-02", -5);
    expect(already.due).toBe("2026-03-02");
    expect(already.start).toBe("2026-03-02");
  });
});
