import { describe, expect, it } from "vitest";

import {
  between,
  compare,
  evenlySpacedRanks,
  INITIAL,
  MAX,
  MIN,
} from "./lexorank.js";

describe("compare", () => {
  it("orders short strings lexicographically", () => {
    expect(compare("a", "b")).toBe(-1);
    expect(compare("b", "a")).toBe(1);
    expect(compare("a", "a")).toBe(0);
  });

  it("orders longer strings as expected", () => {
    expect(compare("a", "aa")).toBe(-1);
    expect(compare("ab", "ac")).toBe(-1);
  });
});

describe("between", () => {
  it("returns a midpoint when the gap is wide", () => {
    const m = between("a", "c");
    expect(m).toBe("b");
  });

  it("descends one digit when ranks are adjacent", () => {
    const m = between("a", "b");
    expect(m > "a" && m < "b").toBe(true);
    expect(m.length).toBe(2);
  });

  it("handles MIN as lower bound", () => {
    const m = between(MIN, "a");
    expect(m > MIN && m < "a").toBe(true);
  });

  it("handles MAX as upper bound", () => {
    const m = between("y", MAX);
    expect(m > "y" && m < MAX).toBe(true);
  });

  it("throws when bounds are out of order", () => {
    expect(() => between("c", "a")).toThrow();
    expect(() => between("a", "a")).toThrow();
  });

  it("handles MIN..MAX (initial-into-empty insert)", () => {
    const m = between(MIN, MAX);
    expect(m > MIN && m < MAX).toBe(true);
  });

  it("repeated inserts at the same end keep ranks ordered", () => {
    // Repeatedly insert "between MIN and current first" — each new
    // item becomes the new lowest rank.
    let lowest = INITIAL;
    for (let i = 0; i < 100; i += 1) {
      const next = between(MIN, lowest);
      expect(compare(next, lowest)).toBe(-1);
      expect(compare(MIN, next)).toBe(-1);
      lowest = next;
    }
    // Length grows but stays bounded for these many inserts.
    expect(lowest.length).toBeLessThan(120);
  });

  it("repeated inserts between two adjacent ranks stay strictly ordered", () => {
    let lo = "a";
    let hi = "b";
    for (let i = 0; i < 50; i += 1) {
      const mid = between(lo, hi);
      expect(compare(lo, mid)).toBe(-1);
      expect(compare(mid, hi)).toBe(-1);
      // Alternate which side we narrow into so the test exercises
      // both descent paths.
      if (i % 2 === 0) hi = mid;
      else lo = mid;
    }
  });
});

describe("evenlySpacedRanks", () => {
  it("returns an empty array for count 0", () => {
    expect(evenlySpacedRanks(0)).toEqual([]);
  });

  it("returns a single rank for count 1 that matches INITIAL", () => {
    expect(evenlySpacedRanks(1)).toEqual([INITIAL]);
  });

  it("never produces a rank ending in '0'", () => {
    for (const count of [2, 5, 34, 100, 500]) {
      const r = evenlySpacedRanks(count);
      for (const v of r) {
        expect(v.endsWith("0")).toBe(false);
      }
    }
  });

  it("stays unique and strictly increasing at every count it accepts", () => {
    // `stride` floors to 1 once count passes 648 (BASE*BASE/2), so
    // `Math.floor(stride / 2)` became 0 and the `lo === 0 -> 1` clamp
    // collapsed adjacent slots onto the same rank. reorderBoardRank
    // rebalances with one rank per ranked task in the tracker, so a
    // large board wrote duplicate board_rank to disk, and the next
    // before/after drag resolved its anchor by indexOf and positioned
    // against the wrong card.
    for (const count of [648, 649, 700, 1000, 1259, 1260, 1261, 5000, 46656]) {
      const r = evenlySpacedRanks(count);
      expect(r).toHaveLength(count);
      expect(new Set(r).size).toBe(count);
      for (let i = 1; i < r.length; i += 1) {
        expect(compare(r[i - 1]!, r[i]!)).toBe(-1);
      }
      for (const v of r) expect(v.endsWith("0")).toBe(false);
    }
  });

  it("leaves insert room before the first rank and after the last", () => {
    // Ranks are centred in the slot space so a later insert at either
    // end has somewhere to go. Without the centring offset the first
    // rank sits at the very bottom, and `between(MIN, first)` has to
    // grow a longer rank immediately on the next head insert.
    for (const count of [5, 100, 700]) {
      const r = evenlySpacedRanks(count);
      expect(compare(MIN, r[0]!)).toBe(-1);
      expect(compare(r[r.length - 1]!, MAX)).toBe(-1);
      // There is at least one representable rank below the first.
      expect(between(MIN, r[0]!).length).toBeLessThanOrEqual(r[0]!.length);
    }
  });

  it("widens the rank instead of failing once two digits run out", () => {
    // Two digits hold BASE*(BASE-1) = 1260 usable ranks. The old code
    // claimed 1296 and met it by silently repeating ranks. Both callers
    // pass a live collection size, so refusing would turn a drag on a
    // large board into a thrown error — width grows instead.
    // Widening happens at half capacity, not at the brim, so the ranks
    // keep a centred band with insert room at both ends: two digits hold
    // 1260 usable ranks and are used up to 630.
    expect(evenlySpacedRanks(630).every(r => r.length === 2)).toBe(true);
    expect(evenlySpacedRanks(631).every(r => r.length === 3)).toBe(true);
    const big = evenlySpacedRanks(5000);
    expect(new Set(big).size).toBe(5000);
    expect(big.every(r => r.length === 3)).toBe(true);
  });

  it("returns the requested number of strictly increasing ranks", () => {
    const r = evenlySpacedRanks(10);
    expect(r).toHaveLength(10);
    for (let i = 1; i < r.length; i += 1) {
      expect(compare(r[i - 1]!, r[i]!)).toBe(-1);
    }
  });

  it("supports counts beyond a single digit", () => {
    const r = evenlySpacedRanks(100);
    expect(r).toHaveLength(100);
    for (let i = 1; i < r.length; i += 1) {
      expect(compare(r[i - 1]!, r[i]!)).toBe(-1);
    }
  });
});
