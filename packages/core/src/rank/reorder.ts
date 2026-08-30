import type { Task, TaskRelationship } from "@loctt/contracts";

import { withStateLock } from "../state/index.js";
import { appendHistory } from "../task/history.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";
import { lookupTask } from "../task/lookup.js";
import {
  between,
  evenlySpacedRanks,
  INITIAL,
  MAX,
  MIN,
  REBALANCE_LENGTH_THRESHOLD,
} from "./lexorank.js";

export class ReorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReorderError";
  }
}

export interface ReorderRelationshipOptions {
  readonly locttDir: string;
  /** Source task whose relationships are being reordered. */
  readonly sourceRef: string;
  /** Relationship type whose targets are being reordered. */
  readonly relationshipType: string;
  /** Target task being moved. */
  readonly targetRef: string;
  /** Place the moved target before this target's position, when set. */
  readonly before?: string;
  /** Place the moved target after this target's position, when set. */
  readonly after?: string;
}

export interface ReorderResult {
  readonly rank: string;
  /** True when the operation also rebalanced the surrounding window. */
  readonly rebalanced: boolean;
}

/**
 * Reorders a relationship target within a single source task's
 * relationships of one type. Pass exactly one of `before` / `after`
 * for explicit positioning, or pass neither to move the target to
 * the end.
 *
 * Auto-rebalances all of this source's relationships of the given
 * type when the resulting rank string would exceed
 * `REBALANCE_LENGTH_THRESHOLD`. Rebalance is hidden from callers —
 * the only observable difference is that a previously-long rank
 * shrinks back to a single digit on the next reorder.
 */
export async function reorderRelationship(
  opts: ReorderRelationshipOptions,
): Promise<ReorderResult> {
  if (opts.before !== undefined && opts.after !== undefined) {
    throw new ReorderError("`before` and `after` are mutually exclusive");
  }

  return withStateLock(opts.locttDir, async () => {
    const source = await lookupTask(opts.locttDir, opts.sourceRef);
    const relationships = [...(source.frontmatter.relationships ?? [])];

    // Find the target link.
    // Resolve the target to its UUID via lookupTask so callers can
    // pass either a key (e.g. T-3) or an ID.
    const target = await lookupTask(opts.locttDir, opts.targetRef);
    const targetId = target.frontmatter.id;
    const movedIdx = relationships.findIndex(
      r => r.type === opts.relationshipType && r.target === targetId,
    );
    if (movedIdx === -1) {
      throw new ReorderError(
        `task ${source.frontmatter.key} has no '${opts.relationshipType}' link to ${target.frontmatter.key}`,
      );
    }

    // Same lookup for the anchors. They must already be linked under
    // the same relationship type.
    let beforeRank: string | undefined;
    let afterRank: string | undefined;
    if (opts.before !== undefined) {
      const beforeTarget = await lookupTask(opts.locttDir, opts.before);
      const link = relationships.find(
        r => r.type === opts.relationshipType && r.target === beforeTarget.frontmatter.id,
      );
      if (!link) {
        throw new ReorderError(
          `'before' anchor ${beforeTarget.frontmatter.key} is not linked under '${opts.relationshipType}'`,
        );
      }
      beforeRank = link.rank;
    }
    if (opts.after !== undefined) {
      const afterTarget = await lookupTask(opts.locttDir, opts.after);
      const link = relationships.find(
        r => r.type === opts.relationshipType && r.target === afterTarget.frontmatter.id,
      );
      if (!link) {
        throw new ReorderError(
          `'after' anchor ${afterTarget.frontmatter.key} is not linked under '${opts.relationshipType}'`,
        );
      }
      afterRank = link.rank;
    }

    const peers = relationships.filter(
      r => r.type === opts.relationshipType && r.target !== targetId,
    );
    const newRank = computeNewRank({
      peers,
      mode:
        opts.before !== undefined
          ? { kind: "before", rank: beforeRank ?? null }
          : opts.after !== undefined
            ? { kind: "after", rank: afterRank ?? null }
            : { kind: "end" },
    });

    const movedLink = relationships[movedIdx];
    // Captured before the write, so the history entry can say what the
    // rank was as well as what it became.
    const priorRank = movedLink?.rank;
    if (!movedLink) {
      // Can't happen — movedIdx came from this array — but satisfy TS.
      throw new ReorderError("internal: moved relationship vanished");
    }
    relationships[movedIdx] = { ...movedLink, rank: newRank };

    // Auto-rebalance if the new rank exceeds the length threshold.
    let rebalanced = false;
    if (newRank.length > REBALANCE_LENGTH_THRESHOLD) {
      rebalanced = true;
      const sameType = relationships
        .filter(r => r.type === opts.relationshipType)
        .sort(byRankAsc);
      const fresh = evenlySpacedRanks(sameType.length);
      const idMap = new Map<string, string>();
      sameType.forEach((link, i) => {
        const f = fresh[i];
        if (f !== undefined) idMap.set(link.target, f);
      });
      relationships.forEach((r, i) => {
        if (r.type !== opts.relationshipType) return;
        const next = idMap.get(r.target);
        if (next !== undefined) {
          relationships[i] = { ...r, rank: next };
        }
      });
    }

    const updated: Task = {
      ...source,
      frontmatter: {
        ...source.frontmatter,
        relationships,
        updated_at: new Date().toISOString(),
      },
    };
    await writeTask(opts.locttDir, source.frontmatter.id, updated);
    // Every other mutating path records one; without this a reorder was
    // invisible in the audit trail (CMT-C6).
    await appendHistory(opts.locttDir, source.frontmatter.id, [{
      timestamp: new Date().toISOString(),
      kind: "rank_changed",
      field: opts.relationshipType,
      before: priorRank ?? null,
      after: relationships[movedIdx]?.rank ?? newRank,
      meta: { target: opts.targetRef },
    }]);

    const finalLink = relationships[movedIdx];
    return { rank: finalLink?.rank ?? newRank, rebalanced };
  });
}

export interface ReorderBoardRankOptions {
  readonly locttDir: string;
  readonly taskRef: string;
  readonly before?: string;
  readonly after?: string;
}

/**
 * Reorders a task's `board_rank`. When called without `before` /
 * `after`, the task moves to the end of the rank ordering.
 *
 * Auto-rebalances the entire board-rank space when the resulting
 * rank would exceed the length threshold. The rebalance walks all
 * tasks (loadAllTasks) and re-spaces those with a `board_rank`.
 */
export async function reorderBoardRank(
  opts: ReorderBoardRankOptions,
): Promise<ReorderResult> {
  if (opts.before !== undefined && opts.after !== undefined) {
    throw new ReorderError("`before` and `after` are mutually exclusive");
  }

  return withStateLock(opts.locttDir, async () => {
    const moved = await lookupTask(opts.locttDir, opts.taskRef);
    const priorBoardRank = moved.frontmatter.board_rank;
    const allTasks = await loadAllTasks(opts.locttDir);
    // A board column is a status, and a rank is only meaningful within
    // one. Peers used to be *every* ranked task in the tracker, so a
    // `todo` task could be handed a rank interpolated between two
    // `doing` tasks — a position that means nothing in the column it
    // actually renders in (SPR-C2). The docstring said "within its
    // column" in three places; the code never did it.
    const column = moved.frontmatter.status;
    const peers = allTasks.flatMap(t => {
      if (t.frontmatter.id === moved.frontmatter.id) return [];
      if (t.frontmatter.status !== column) return [];
      const rank = t.frontmatter.board_rank;
      if (rank === undefined) return [];
      return [{ id: t.frontmatter.id, rank }];
    });

    /**
     * Reads an anchor's rank, refusing one from another column.
     *
     * Silently accepting it produced a rank derived from tasks the user
     * cannot see next to the one they moved — the drag looked like it
     * worked and the card landed somewhere arbitrary.
     */
    const anchorRank = async (ref: string, label: string): Promise<string | undefined> => {
      const t = await lookupTask(opts.locttDir, ref);
      if (t.frontmatter.status !== column) {
        throw new ReorderError(
          `cannot rank ${label} '${ref}': it is in status `
          + `'${t.frontmatter.status ?? "(none)"}' but ${opts.taskRef} is in `
          + `'${column ?? "(none)"}'. Board rank is per-column — move the task `
          + `to that status first, or pick an anchor in its own column.`,
        );
      }
      return t.frontmatter.board_rank;
    };

    let beforeRank: string | undefined;
    let afterRank: string | undefined;
    if (opts.before !== undefined) {
      beforeRank = await anchorRank(opts.before, "before");
    }
    if (opts.after !== undefined) {
      afterRank = await anchorRank(opts.after, "after");
    }

    const newRank = computeNewRank({
      peers: peers.map(p => ({ rank: p.rank })) as readonly { rank?: string | undefined }[],
      mode:
        opts.before !== undefined
          ? { kind: "before", rank: beforeRank ?? null }
          : opts.after !== undefined
            ? { kind: "after", rank: afterRank ?? null }
            : { kind: "end" },
    });

    // A drop into the position the card already occupies changes
    // nothing, so nothing is written (BRD-31).
    //
    // Without this, re-dropping a card between the same two neighbours
    // rewrote `task.md` with an identical `board_rank`, advanced
    // `updated_at`, and appended a `rank_changed` history entry whose
    // `before` and `after` were the same string — an audit trail
    // claiming a move that did not happen. Measured before this
    // existed: `board-rerank T1 --after T2` twice left rank `u`
    // unchanged but grew history from 2 entries to 3.
    //
    // The field path has always behaved this way — `buildSetFieldHistory`
    // returns no entries when `before === value` — so this closes an
    // inconsistency inside core rather than introducing a new rule.
    // It is placed before the rebalance check deliberately: a rank that
    // is unchanged is by definition not longer than it was, so it
    // cannot be the thing that triggers a rebalance.
    if (priorBoardRank !== undefined && newRank === priorBoardRank) {
      return { rank: priorBoardRank, rebalanced: false };
    }

    let rebalanced = false;
    let updates: { id: string; rank: string }[] = [
      { id: moved.frontmatter.id, rank: newRank },
    ];

    if (newRank.length > REBALANCE_LENGTH_THRESHOLD) {
      rebalanced = true;
      const ranked = [...peers, { id: moved.frontmatter.id, rank: newRank }].sort(
        (a, b) => a.rank.localeCompare(b.rank),
      );
      const fresh = evenlySpacedRanks(ranked.length);
      updates = ranked.flatMap((p, i) => {
        const f = fresh[i];
        return f !== undefined ? [{ id: p.id, rank: f }] : [];
      });
    }

    // Persist updates.
    const updateMap = new Map(updates.map(u => [u.id, u.rank]));
    for (const t of allTasks) {
      const next = updateMap.get(t.frontmatter.id);
      if (next === undefined) continue;
      const updated: Task = {
        ...t,
        frontmatter: {
          ...t.frontmatter,
          board_rank: next,
          updated_at: new Date().toISOString(),
        },
      };
      await writeTask(opts.locttDir, t.frontmatter.id, updated);
    }

    // Only the moved task gets an entry. A rebalance rewrites its peers
    // as a side effect of making room, and recording a "move" on each
    // would claim the user touched tasks they never saw.
    await appendHistory(opts.locttDir, moved.frontmatter.id, [{
      timestamp: new Date().toISOString(),
      kind: "rank_changed",
      field: "board_rank",
      before: priorBoardRank ?? null,
      after: updateMap.get(moved.frontmatter.id) ?? newRank,
      ...(rebalanced ? { meta: { rebalanced: true } } : {}),
    }]);

    const finalRank = updateMap.get(moved.frontmatter.id) ?? newRank;
    return { rank: finalRank, rebalanced };
  });
}

interface ComputeNewRankOptions {
  readonly peers: readonly { rank?: string | undefined }[];
  readonly mode:
    | { kind: "before"; rank: string | null }
    | { kind: "after"; rank: string | null }
    | { kind: "end" };
}

/**
 * Picks the new rank string for a moved item based on its anchors
 * and the existing peer ranks. Anchors with no rank fall back to
 * picking up MIN/MAX as bounds.
 */
function computeNewRank(opts: ComputeNewRankOptions): string {
  const ranked = opts.peers
    .filter((p): p is { rank: string } => typeof p.rank === "string")
    .map(p => p.rank)
    .sort();

  const last = ranked[ranked.length - 1];
  const first = ranked[0];

  if (opts.mode.kind === "end") {
    if (last === undefined) return INITIAL;
    return between(last, MAX);
  }

  if (opts.mode.kind === "before") {
    const anchor = opts.mode.rank ?? null;
    if (anchor === null) {
      // Anchor has no rank — fall back to inserting at the start.
      if (first === undefined) return INITIAL;
      return between(MIN, first);
    }
    const anchorIdx = ranked.indexOf(anchor);
    if (anchorIdx === -1) {
      // Anchor isn't in the peer list (e.g. anchor itself is the
      // moved item — impossible by callers, but guard anyway).
      return between(MIN, anchor);
    }
    const lower = anchorIdx === 0 ? MIN : ranked[anchorIdx - 1] ?? MIN;
    return between(lower, anchor);
  }

  // mode.kind === "after"
  const anchor = opts.mode.rank ?? null;
  if (anchor === null) {
    if (last === undefined) return INITIAL;
    return between(last, MAX);
  }
  const anchorIdx = ranked.indexOf(anchor);
  if (anchorIdx === -1) {
    return between(anchor, MAX);
  }
  const upper = anchorIdx === ranked.length - 1 ? MAX : ranked[anchorIdx + 1] ?? MAX;
  return between(anchor, upper);
}

function byRankAsc(a: TaskRelationship, b: TaskRelationship): number {
  const ra = a.rank ?? "";
  const rb = b.rank ?? "";
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return 0;
}
