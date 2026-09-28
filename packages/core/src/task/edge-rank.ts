import type { TaskRelationship } from "@loctt/contracts";

import { between, compare, INITIAL, MAX } from "../rank/lexorank.js";

/**
 * Every link carries a rank (K143).
 *
 * A task's links of one type are listed by `rank` (see
 * `relationship-order.ts`). Since format 0.3.0 every write that creates a
 * link gives it a rank at the end of that type's group on that task:
 * `link`, `create --parent`, the relationship repair and restore all go
 * through these helpers, so "append at the end" means the same thing
 * everywhere. An edge without a rank is still readable (a hand-edit, a
 * merge from an old branch); it sorts after the ranked ones, doctor
 * reports it, and the relationship repair ranks it.
 */

/** A rank `between` can take as a bound: base-36 lowercase, below `MAX`, no trailing `0`. */
export function isUsableRank(rank: string): boolean {
  return /^[0-9a-z]*[1-9a-z]$/.test(rank) && compare(rank, MAX) < 0;
}

/**
 * The rank that sorts after every ranked edge in `ranks`. Ranks compare
 * as strings, so a hand-edited rank outside the alphabet still sorts
 * somewhere; the result sorts after it too.
 */
export function rankAfter(ranks: readonly string[]): string {
  let max: string | undefined;
  for (const r of ranks) if (max === undefined || compare(r, max) > 0) max = r;
  if (max === undefined) return INITIAL;
  if (isUsableRank(max)) return between(max, MAX);
  // Not a lexorank (hand-edited): any extension of a string sorts after it.
  return `${max}u`;
}

/** The rank a new `type` edge takes at the end of its group. */
export function nextEdgeRank(existing: readonly TaskRelationship[], type: string): string {
  return rankAfter(existing.filter(r => r.type === type && r.rank !== undefined).map(r => r.rank as string));
}

/** `existing` plus a `type` edge to `target`, ranked at the end of its group. */
export function appendRankedEdge(
  existing: readonly TaskRelationship[],
  type: string,
  target: string,
): TaskRelationship[] {
  return [...existing, { type, target, rank: nextEdgeRank(existing, type) }];
}

/**
 * Gives every unranked edge a rank at the end of its type's group, in
 * stored order, which is where the listing already shows them (ranked
 * first, then unranked in stored order). Ranked edges keep their rank;
 * positions in the array are unchanged. Returns the same array object
 * when nothing was missing.
 */
export function fillMissingRanks(edges: readonly TaskRelationship[]): readonly TaskRelationship[] {
  if (edges.every(e => e.rank !== undefined)) return edges;
  const out = [...edges];
  const lastByType = new Map<string, string[]>();
  for (const e of edges) {
    if (e.rank === undefined) continue;
    const list = lastByType.get(e.type);
    if (list === undefined) lastByType.set(e.type, [e.rank]);
    else list.push(e.rank);
  }
  out.forEach((e, i) => {
    if (e.rank !== undefined) return;
    const ranks = lastByType.get(e.type) ?? [];
    const rank = rankAfter(ranks);
    out[i] = { ...e, rank };
    lastByType.set(e.type, [...ranks, rank]);
  });
  return out;
}

/** How many edges have no rank. */
export function countUnranked(edges: readonly TaskRelationship[]): number {
  return edges.filter(e => e.rank === undefined).length;
}
