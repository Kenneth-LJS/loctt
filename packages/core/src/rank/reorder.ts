import type { Task, TaskRelationship } from "@loctt/contracts";

import { loadWorkflowConfig } from "../config/workflow.js";
import { withStateLock } from "../state/index.js";
import { appendHistory } from "../task/history.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";
import { lookupTask } from "../task/lookup.js";
import { columnStatusesFor, STATUSLESS_COLUMN } from "./column-scope.js";
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
    const workflow = await loadWorkflowConfig(opts.locttDir);
    // K8: a board column is a *group of tickets*, not a status. Ranks
    // are only ever compared within one column, and inside a column
    // cards of different statuses interleave freely — the ordering
    // knows nothing about status.
    //
    // This line used to read `const column = moved.frontmatter.status`.
    // The variable was named `column` and held a status; when a column
    // was one status those meant the same thing, and `workflow.boards`
    // made them different. The result was that dragging a `blocked`
    // card above an `in_progress` card in the same rendered column was
    // refused, while the optimistic UI had already moved it — the user
    // saw the card move and the write never landed (BRD-12).
    //
    // With no `boards` block `columnStatuses` is the single status, so
    // behaviour is byte-for-byte what it was.
    const columnStatuses = columnStatusesFor(workflow, allTasks, moved.frontmatter.status);
    const inColumn = (status: string | undefined): boolean =>
      status === undefined
        ? columnStatuses === STATUSLESS_COLUMN
        : columnStatuses !== STATUSLESS_COLUMN && columnStatuses.has(status);

    const peers = allTasks.flatMap(t => {
      if (t.frontmatter.id === moved.frontmatter.id) return [];
      if (!inColumn(t.frontmatter.status)) return [];
      const rank = t.frontmatter.board_rank;
      if (rank === undefined) return [];
      return [{ id: t.frontmatter.id, rank }];
    });

    /**
     * Reads an anchor's rank, refusing one from another column.
     *
     * Silently accepting it produced a rank derived from tasks the user
     * cannot see next to the one they moved — the drag looked like it
     * worked and the card landed somewhere arbitrary (SPR-C2). The
     * check is by *column* rather than status under K8, so an anchor
     * that shares the moved card's column is accepted whatever its
     * status.
     */
    const anchorRank = async (ref: string, label: string): Promise<string | undefined> => {
      const t = await lookupTask(opts.locttDir, ref);
      if (!inColumn(t.frontmatter.status)) {
        throw new ReorderError(
          `cannot rank ${label} '${ref}': it is in status `
          + `'${t.frontmatter.status ?? "(none)"}', a different board column from `
          + `${opts.taskRef} in '${moved.frontmatter.status ?? "(none)"}'. Board rank `
          + `is per-column — pick an anchor from the same column, or move the task `
          + `to that column first.`,
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
    // `indexOf` finds the *first* copy, which is what "before" wants:
    // the new rank goes below every card sharing the anchor's rank.
    const anchorIdx = ranked.indexOf(anchor);
    if (anchorIdx === -1) {
      // Anchor isn't in the peer list (e.g. anchor itself is the
      // moved item — impossible by callers, but guard anyway).
      return between(MIN, anchor);
    }
    // No duplicate-widening is needed on this branch: `indexOf`
    // returns the *first* copy of the anchor's rank, so the element
    // below it is strictly smaller by construction. (The "after"
    // branch does need it — `lastIndexOf` alone would leave the upper
    // bound equal to the anchor when duplicates run to the end.)
    const lower = anchorIdx === 0 ? MIN : ranked[anchorIdx - 1] ?? MIN;
    return between(lower, anchor);
  }

  // mode.kind === "after"
  const anchor = opts.mode.rank ?? null;
  if (anchor === null) {
    if (last === undefined) return INITIAL;
    return between(last, MAX);
  }
  // `lastIndexOf` for "after": the new rank goes above every card
  // sharing the anchor's rank, mirroring the "before" case.
  const anchorIdx = ranked.lastIndexOf(anchor);
  if (anchorIdx === -1) {
    return between(anchor, MAX);
  }
  // `lastIndexOf` is what makes the upper bound safe when ranks
  // duplicate: it lands on the final copy, so `ranked[anchorIdx + 1]`
  // is strictly greater than the anchor by construction and `between`
  // cannot throw. Under K8 duplicates are a normal condition — every
  // column's first card gets INITIAL, so a config change merging two
  // columns puts two "u"s in one sequence — and the throw is a plain
  // Error that escapes the server's `instanceof ReorderError` catch as
  // a 500.
  const upperIdx = anchorIdx + 1;
  const upper = upperIdx >= ranked.length ? MAX : ranked[upperIdx] ?? MAX;
  return between(anchor, upper);
}

function byRankAsc(a: TaskRelationship, b: TaskRelationship): number {
  const ra = a.rank ?? "";
  const rb = b.rank ?? "";
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return 0;
}
