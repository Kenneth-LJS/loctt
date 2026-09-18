import type { Task, WorkflowConfig } from "@loctt/contracts";

import type { ArchivedGuardConfigs } from "../config/index.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { withStateLock } from "../state/index.js";
import { loadAllTasks } from "../task/load-all.js";
import { lookupTask } from "../task/lookup.js";
import { setFieldsLocked } from "../task/update.js";
import { columnStatusesFor, STATUSLESS_COLUMN } from "./column-scope.js";
import { between, evenlySpacedRanks, INITIAL, MAX, MIN, REBALANCE_LENGTH_THRESHOLD } from "./lexorank.js";
import { ReorderError } from "./reorder.js";

/**
 * The one auto-managed field the board-move path may write directly.
 *
 * Scoped to a constant so the grant is greppable and cannot quietly
 * widen: `completed_date`, the other auto-managed field, stays
 * computed on every path including this one.
 */
const BOARD_MOVE_GRANT: ReadonlySet<string> = new Set(["board_rank"]);

export interface BoardMoveOptions {
  readonly locttDir: string;
  /** Task being moved. */
  readonly taskRef: string;
  /**
   * Destination status. Omit for an intra-column reorder, in which
   * case only `board_rank` is written (XS-9: an intra-column reorder
   * must not resend `status`).
   */
  readonly status?: string;
  /** The card the moved card lands *above*. */
  readonly before?: string;
  /** The card the moved card lands *below*. */
  readonly after?: string;
  readonly workflowConfig?: WorkflowConfig;
  readonly archivedGuard?: ArchivedGuardConfigs;
}

export interface BoardMoveResult {
  readonly task: Task;
  readonly rank: string;
  readonly rebalanced: boolean;
}

/**
 * Moves a card on the board: an optional status change and a new
 * `board_rank`, written as **one** change set.
 *
 * ## Why this exists rather than routing through `reorderBoardRank`
 *
 * K8 said to delete the server's duplicate rank interpolation and
 * route both board paths through `reorderBoardRank`. That cannot be
 * done as written, for two independent reasons:
 *
 *  - `reorderBoardRank` throws when given `before` **and** `after`
 *    together, and a board drop passes both deliberately — BRD-32
 *    requires the rank to be computed against the two neighbours the
 *    user actually saw at release time, not against a peer set that a
 *    mid-drag refetch may have reordered.
 *  - it writes only `board_rank`, under its own lock. A cross-column
 *    drop must write `status` and `board_rank` in one change set or
 *    BRD-41 and XS-9 are violated ("no partial write of one field
 *    without the other").
 *
 * So the consolidation target is this new op, not the old one. The
 * duplication still goes: the server's local interpolation is deleted
 * and calls here, which means a cross-column drop finally gets the
 * rebalance that path never had (`grep rebalance server.ts` → 0 hits
 * before this).
 *
 * ## Anchor semantics
 *
 * `before` is the card the dropped card lands *above*, `after` the one
 * it lands *below*, so the new rank sits between the lower bound
 * (`after`) and the upper bound (`before`). Both are re-read from disk
 * rather than trusted from the caller: BRD-44's neighbour may have
 * been deleted mid-drag, and BRD-35's card may have moved. Anchors are
 * validated against the **destination** column — on a cross-column
 * drop the neighbours legitimately belong to the column being moved
 * *to*, which is exactly what `reorderBoardRank`'s check would refuse.
 */
export async function boardMove(opts: BoardMoveOptions): Promise<BoardMoveResult> {
  return withStateLock(opts.locttDir, async () => {
    const moved = await lookupTask(opts.locttDir, opts.taskRef);
    const priorRank = moved.frontmatter.board_rank;
    const priorStatus = moved.frontmatter.status;
    const workflow = opts.workflowConfig ?? await loadWorkflowConfig(opts.locttDir);
    const allTasks = await loadAllTasks(opts.locttDir);

    // The column the card is landing in. On a cross-column drop this
    // is the destination's column, not the card's current one.
    const destStatus = opts.status ?? priorStatus;
    const columnStatuses = columnStatusesFor(workflow, allTasks, destStatus);
    const inColumn = (status: string | undefined): boolean =>
      status === undefined
        ? columnStatuses === STATUSLESS_COLUMN
        : columnStatuses !== STATUSLESS_COLUMN && columnStatuses.has(status);

    /**
     * Reads an anchor's rank off disk.
     *
     * A neighbour deleted mid-drag (BRD-44) surfaces here as a lookup
     * failure naming the operation, rather than as a rank silently
     * interpolated against a ghost.
     */
    const anchorRank = async (ref: string | undefined): Promise<string | undefined> => {
      if (ref === undefined || ref.length === 0) return undefined;
      let anchor;
      try {
        anchor = await lookupTask(opts.locttDir, ref);
      } catch {
        throw new ReorderError(
          `Couldn't reorder ${opts.taskRef}: the neighbouring task "${ref}" no longer `
          + `exists, so this board is out of date. Reload and try the move again.`,
        );
      }
      // BRD-35: the anchor may have been moved to another column by
      // another surface while the drag was held. Ranking against it
      // would place the card by a neighbour it no longer sits next to.
      if (!inColumn(anchor.frontmatter.status)) {
        throw new ReorderError(
          `Couldn't reorder ${opts.taskRef}: the neighbouring task "${ref}" is no `
          + `longer in that column, so this board is out of date. Reload and try `
          + `the move again.`,
        );
      }
      return anchor.frontmatter.board_rank;
    };

    const beforeRank = await anchorRank(opts.before);
    const afterRank = await anchorRank(opts.after);

    // Peers are the destination column's other ranked cards. Needed for
    // an unanchored drop (append to the column's end, K8's "new tickets
    // go to the bottom of the column") and to scope the rebalance.
    const peers = allTasks.flatMap(t => {
      if (t.frontmatter.id === moved.frontmatter.id) return [];
      if (!inColumn(t.frontmatter.status)) return [];
      const rank = t.frontmatter.board_rank;
      if (rank === undefined) return [];
      return [{ id: t.frontmatter.id, rank }];
    });

    let newRank: string;
    if (beforeRank === undefined && afterRank === undefined) {
      // No anchors: the end of *this column's* sequence.
      const last = peers.map(p => p.rank).sort().pop();
      newRank = last === undefined ? INITIAL : between(last, MAX);
    } else {
      // Duplicate ranks are normal under K8 — every column's first card
      // gets INITIAL, so a config change merging two columns puts two
      // "u"s in one sequence. `between(x, x)` throws a plain Error that
      // would escape a `ReorderError` catch as a 500, so the bounds are
      // widened past any peer equal to them before interpolating.
      const lower = afterRank ?? MIN;
      const upper = beforeRank ?? MAX;
      newRank = interpolate(lower, upper, peers.map(p => p.rank));
    }

    const statusChanges = opts.status !== undefined && opts.status !== priorStatus
      ? [{ field: "status", value: opts.status as unknown }]
      : [];

    // BRD-31: a drop that changes neither status nor rank writes
    // nothing at all — no `updated_at` bump, no history entry. The
    // guard covers *both* fields deliberately: a cross-column drop that
    // happens to land on an identical rank string still has a status to
    // write.
    if (statusChanges.length === 0 && priorRank !== undefined && newRank === priorRank) {
      return { task: moved, rank: priorRank, rebalanced: false };
    }

    // A rank that has grown past the threshold re-spaces this column.
    // Scoped to the column: re-spacing every ranked task in the tracker
    // would rewrite cards in columns the user never touched, and under
    // per-column sequences their ranks are not even comparable.
    let rebalanced = false;
    const extraWrites: { id: string; rank: string }[] = [];
    let finalRank = newRank;
    if (newRank.length > REBALANCE_LENGTH_THRESHOLD) {
      rebalanced = true;
      const ranked = [...peers, { id: moved.frontmatter.id, rank: newRank }]
        .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
      const fresh = evenlySpacedRanks(ranked.length);
      ranked.forEach((p, i) => {
        const f = fresh[i];
        if (f === undefined) return;
        if (p.id === moved.frontmatter.id) finalRank = f;
        else extraWrites.push({ id: p.id, rank: f });
      });
    }

    const task = await setFieldsLocked({
      locttDir: opts.locttDir,
      taskId: moved.frontmatter.id,
      // One change set, one write: both fields land or neither does
      // (BRD-41, XS-9). Nothing else is included, so a concurrent CLI
      // edit to another field on this card survives the drag.
      changes: [...statusChanges, { field: "board_rank", value: finalRank }],
      // Always present: loaded above if the caller did not supply it,
      // so `setFieldsLocked` validates the status against the same
      // config this op derived the column from.
      workflowConfig: workflow,
      ...(opts.archivedGuard !== undefined ? { archivedGuard: opts.archivedGuard } : {}),
      // `board_rank` is auto-managed, so `setFields` refuses it by
      // default — that guard is what stops a user hand-writing a rank
      // through `loctt set`. This path is the rank's owner.
      allowAutoManaged: BOARD_MOVE_GRANT,
    });

    // Peers re-spaced by the rebalance. They get no history entry: a
    // rebalance rewrites them as a side effect of making room, and
    // recording a "move" on each would claim the user touched cards
    // they never saw.
    if (extraWrites.length > 0) {
      const { writeTask } = await import("../task/io.js");
      const byId = new Map(allTasks.map(t => [t.frontmatter.id, t]));
      for (const w of extraWrites) {
        const t = byId.get(w.id);
        if (t === undefined) continue;
        await writeTask(opts.locttDir, w.id, {
          ...t,
          frontmatter: { ...t.frontmatter, board_rank: w.rank },
        });
      }
    }

    return { task, rank: finalRank, rebalanced };
  });
}

/**
 * A rank strictly between `lower` and `upper`, widening the bounds
 * past any peer that equals them.
 *
 * Duplicate ranks are a normal condition under K8's per-column
 * sequences, and `between` throws on equal bounds.
 */
function interpolate(lower: string, upper: string, peerRanks: readonly string[]): string {
  if (lower < upper) return between(lower, upper);
  // Bounds collide (the two anchors share a rank, or a stale anchor
  // pair inverted). Fall back to inserting above the whole run of peers
  // that share the lower bound.
  const sorted = [...peerRanks].sort();
  const aboveRun = sorted.find(r => r > lower);
  return between(lower, aboveRun ?? MAX);
}
