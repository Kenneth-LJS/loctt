/**
 * The 0.1.0 → 0.3.0 step's per-task rule (K143), on shapes the frozen
 * seed does not have: an unranked kind whose links carry stale ranks
 * (REL-33 kept them when a kind was switched to `ranked: false`), and a
 * rank outside the lexorank alphabet.
 *
 * @verifies ONB-C18
 */
import type { TaskRelationship } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { rankInShownOrder } from "./rank-every-link.js";

/** How 0.3.0 lists one type's links: by rank, ties by stored position. */
function listed(rels: readonly TaskRelationship[], type: string): string[] {
  return rels
    .map((r, index) => ({ ...r, index }))
    .filter(r => r.type === type)
    .sort((a, b) => ((a.rank ?? "") === (b.rank ?? "") ? a.index - b.index : (a.rank ?? "") < (b.rank ?? "") ? -1 : 1))
    .map(r => r.target);
}

describe("rankInShownOrder", () => {
  it("a ranked kind: ranked links keep their rank, unranked ones follow in stored order", () => {
    const rels: TaskRelationship[] = [
      { type: "child", target: "a" },
      { type: "child", target: "b" },
      { type: "child", target: "c", rank: "u" },
    ];
    const out = rankInShownOrder(rels, new Set(["child"]));
    expect(listed(out, "child")).toEqual(["c", "a", "b"]);
    expect(out.find(r => r.target === "c")?.rank).toBe("u");
    // Stored in that order too, so a later run reads the same order
    // whether or not it knows the kind was ranked.
    expect(out.map(r => r.target)).toEqual(["c", "a", "b"]);
  });

  it("an unranked kind with stale ranks is listed in stored order, as 0.1.0 showed it", () => {
    const rels: TaskRelationship[] = [
      { type: "relates_to", target: "a", rank: "y" },
      { type: "relates_to", target: "b", rank: "c" },
      { type: "relates_to", target: "c" },
    ];
    const out = rankInShownOrder(rels, new Set());
    expect(listed(out, "relates_to")).toEqual(["a", "b", "c"]);
    expect(out.every(r => r.rank !== undefined)).toBe(true);
  });

  it("a rank outside the alphabet that sorts where it wasn't shown is replaced", () => {
    const rels: TaskRelationship[] = [
      { type: "child", target: "a", rank: "~~" },
      { type: "child", target: "b" },
    ];
    // 0.1.0: ranked first ("~~"), then b. After: the same.
    const out = rankInShownOrder(rels, new Set(["child"]));
    expect(listed(out, "child")).toEqual(["a", "b"]);
  });

  it("leaves other types' positions alone and returns the same array when nothing changes", () => {
    const rels: TaskRelationship[] = [
      { type: "blocks", target: "x", rank: "u" },
      { type: "child", target: "a", rank: "u" },
      { type: "blocks", target: "y", rank: "x" },
    ];
    expect(rankInShownOrder(rels, new Set(["child", "blocks"]))).toBe(rels);
    expect(rankInShownOrder(rels, new Set())).toBe(rels);
  });
});
