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
