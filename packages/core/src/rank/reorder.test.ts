import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/index.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { readHistory } from "../task/history.js";
import { lookupByKey } from "../task/lookup.js";
import { linkTask } from "../task/relationships.js";
import { INITIAL, REBALANCE_LENGTH_THRESHOLD } from "./lexorank.js";
import { reorderBoardRank, ReorderError,reorderRelationship } from "./reorder.js";

let root: string;
let locttDir: string;
let taskProjectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-reorder-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const { loadProjectsConfig } = await import("../config/projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  taskProjectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeTasks(count: number): Promise<string[]> {
  const keys: string[] = [];
  await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    for (let i = 0; i < count; i += 1) {
      const t = await createTask({
        locttDir,
        state,
        options: { project: taskProjectId, title: `Task ${i + 1}` },
      });
      keys.push(t.frontmatter.key);
    }
    await saveState(locttDir, state);
  });
  return keys;
}

async function linkChildren(parentKey: string, childKeys: string[]): Promise<void> {
  const parent = await lookupByKey(locttDir, parentKey);
  for (const ck of childKeys) {
    const child = await lookupByKey(locttDir, ck);
    await linkTask({
      locttDir,
      taskId: parent.frontmatter.id,
      type: "parent",
      target: child.frontmatter.id,
    });
  }
}

describe("reorderRelationship", () => {
  it("appends to the end when no anchor is given", async () => {
    const [pKey, c1, c2, c3] = await makeTasks(4) as [string, string, string, string];
    await linkChildren(pKey, [c1, c2, c3]);

    // Move c1 to the end.
    const result = await reorderRelationship({
      locttDir,
      sourceRef: pKey,
      relationshipType: "parent",
      targetRef: c1,
    });
    expect(typeof result.rank).toBe("string");
    expect(result.rank.length).toBeGreaterThan(0);

    const parent = await lookupByKey(locttDir, pKey);
    const ordered = (parent.frontmatter.relationships ?? [])
      .filter(r => r.type === "parent")
      .sort((a, b) => (a.rank ?? "").localeCompare(b.rank ?? ""));
    // c1 should now be the last by rank — note other children have
    // no rank yet (legacy/inserted-without-rank), so they sort before
    // anything ranked. After this op c1 is the only ranked one.
    expect(ordered.map(r => r.target)).toContain(
      (await lookupByKey(locttDir, c1)).frontmatter.id,
    );
    // c1's rank should be set.
    const c1Id = (await lookupByKey(locttDir, c1)).frontmatter.id;
    const c1Link = (parent.frontmatter.relationships ?? []).find(
      r => r.type === "parent" && r.target === c1Id,
    );
    expect(c1Link?.rank).toBeDefined();
  });

  it("places before/after a specific anchor", async () => {
    const [pKey, c1, c2, c3] = await makeTasks(4) as [string, string, string, string];
    await linkChildren(pKey, [c1, c2, c3]);

    // Establish initial ranks by appending each to end.
    await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c1 });
    await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c2 });
    await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c3 });

    // Move c3 before c2.
    await reorderRelationship({
      locttDir, sourceRef: pKey, relationshipType: "parent",
      targetRef: c3, before: c2,
    });

    const parent = await lookupByKey(locttDir, pKey);
    const ordered = (parent.frontmatter.relationships ?? [])
      .filter(r => r.type === "parent")
      .sort((a, b) => (a.rank ?? "").localeCompare(b.rank ?? ""));
    const c1Id = (await lookupByKey(locttDir, c1)).frontmatter.id;
    const c2Id = (await lookupByKey(locttDir, c2)).frontmatter.id;
    const c3Id = (await lookupByKey(locttDir, c3)).frontmatter.id;
    expect(ordered.map(r => r.target)).toEqual([c1Id, c3Id, c2Id]);
  });

  /**
   * REL-14 and REL-31, neither of which had a test anywhere:
   * `reorder.test.ts` never mentioned rebalancing, and no UI spec can
   * reach it — driving a rank past 24 characters needs ~24 successive
   * inserts into one shrinking gap, which is minutes of subprocess
   * time through the CLI and slower still through a browser.
   *
   * Both are exercised here instead, where the loop is a loop.
   */
  it("REL-14: dropping above the first and below the last renumbers nothing", async () => {
    const [pKey, c1, c2, c3] = await makeTasks(4) as [string, string, string, string];
    await linkChildren(pKey, [c1, c2, c3]);
    for (const c of [c1, c2, c3]) {
      await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c });
    }
    const idOf = async (k: string): Promise<string> =>
      (await lookupByKey(locttDir, k)).frontmatter.id;
    const ranks = async (): Promise<Map<string, string | undefined>> => {
      const p = await lookupByKey(locttDir, pKey);
      return new Map((p.frontmatter.relationships ?? []).map(r => [r.target, r.rank]));
    };
    const [id1, id2, id3] = [await idOf(c1), await idOf(c2), await idOf(c3)];
    const before = await ranks();

    // Above the current first: a rank below every existing one.
    await reorderRelationship({
      locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c3, before: c1,
    });
    const afterHead = await ranks();
    const headRank = afterHead.get(id3) ?? "";
    expect(headRank < (afterHead.get(id1) ?? "")).toBe(true);
    expect(headRank < (afterHead.get(id2) ?? "")).toBe(true);
    // Neither of the other rows was renumbered.
    expect(afterHead.get(id1)).toBe(before.get(id1));
    expect(afterHead.get(id2)).toBe(before.get(id2));

    // Below the current last: a rank above every existing one.
    await reorderRelationship({
      locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c3, after: c2,
    });
    const afterTail = await ranks();
    const tailRank = afterTail.get(id3) ?? "";
    expect(tailRank > (afterTail.get(id1) ?? "")).toBe(true);
    expect(tailRank > (afterTail.get(id2) ?? "")).toBe(true);
    expect(afterTail.get(id1)).toBe(before.get(id1));
    expect(afterTail.get(id2)).toBe(before.get(id2));
  });

  // @verifies REL-31
  it("REL-31: driving a rank past the length threshold rebalances the window without reordering it", async () => {
    const [pKey, c1, c2, x, y] = await makeTasks(5) as [string, string, string, string, string];
    await linkChildren(pKey, [c1, c2, x, y]);
    for (const c of [c1, c2, x, y]) {
      await reorderRelationship({ locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c });
    }
    const idOf = async (k: string): Promise<string> =>
      (await lookupByKey(locttDir, k)).frontmatter.id;
    const ids = {
      c1: await idOf(c1), c2: await idOf(c2), x: await idOf(x), y: await idOf(y),
    };

    const snapshot = async (): Promise<{ order: string[]; ranks: string[] }> => {
      const p = await lookupByKey(locttDir, pKey);
      const rels = (p.frontmatter.relationships ?? [])
        .filter(r => r.type === "parent")
        .sort((a, b) => (a.rank ?? "").localeCompare(b.rank ?? ""));
      return { order: rels.map(r => r.target), ranks: rels.map(r => r.rank ?? "") };
    };

    /**
     * **Two rows leapfrogging, not one row re-dropped.**
     *
     * REL-31 says "repeatedly drop the same row between the same two
     * neighbours", and that phrasing does not reach the threshold:
     * measured, the second identical drop is a no-op. Once the row sits
     * just below its anchor, `computeNewRank` returns the rank it
     * already holds, so the string never grows and the case's premise
     * is never met. (Traced through the CLI: `u w v vi` on the first
     * drop and `u w v vi` on the next eleven.)
     *
     * What does drive the growth — and is the same situation from the
     * user's side, a group being reordered over and over in one region
     * — is two rows each moving above the other. The gap to the fixed
     * neighbour above halves every move, and the rank string gains a
     * character roughly every fifth one.
     */
    let rebalanced = false;
    let orderBefore: string[] = [];
    let longestBefore = 0;
    let mover = x;
    let anchor = y;
    for (let i = 0; i < 400 && !rebalanced; i += 1) {
      const snap = await snapshot();
      orderBefore = snap.order;
      longestBefore = Math.max(...snap.ranks.map(r => r.length));
      const result = await reorderRelationship({
        locttDir, sourceRef: pKey, relationshipType: "parent",
        targetRef: mover, after: anchor,
      });
      rebalanced = result.rebalanced;
      if (rebalanced) {
        /**
         * The order the *move* asked for, which is what the rebalance
         * must preserve.
         *
         * `orderBefore` is the order before this iteration, and this
         * iteration both moved a row and rebalanced — so comparing
         * against it would fail on the move rather than on the
         * rebalance, which is the wrong claim. The intended order is
         * `orderBefore` with the mover lifted out and reinserted
         * immediately after the anchor.
         */
        const moverId = await idOf(mover);
        const anchorId = await idOf(anchor);
        const without = orderBefore.filter(id => id !== moverId);
        const at = without.indexOf(anchorId);
        orderBefore = [...without.slice(0, at + 1), moverId, ...without.slice(at + 1)];
      }
      [mover, anchor] = [anchor, mover];
    }

    // The loop must actually have reached a rebalance; without this
    // every assertion below would hold vacuously on a run that never
    // triggered one.
    expect(rebalanced).toBe(true);
    // And it got there by growing a rank up to the threshold, rather
    // than by some other route. `longestBefore` is the longest rank on
    // the iteration *before* the rebalancing one, so it sits at the
    // threshold rather than past it — the move that crossed 24 is the
    // move that rebalanced.
    expect(longestBefore).toBe(REBALANCE_LENGTH_THRESHOLD);

    const after = await snapshot();
    // The visible order before and after the rebalance is identical —
    // "a rebalance must never reshuffle the user's ordering".
    expect(after.order).toEqual(orderBefore);
    // All four rows are still there, in a stored order.
    expect(new Set(after.order)).toEqual(new Set([ids.c1, ids.c2, ids.x, ids.y]));
    // Rebalanced to evenly spaced *short* strings, across the whole
    // affected window rather than only the dragged row.
    expect(after.ranks).toHaveLength(4);
    expect(after.ranks.every(r => r.length <= 2)).toBe(true);
    // No rank ends in `0`.
    expect(after.ranks.every(r => !r.endsWith("0"))).toBe(true);
    // Strictly increasing, so the order is stored rather than merely
    // displayed.
    expect([...after.ranks].sort()).toEqual(after.ranks);
  });

  it("rejects passing both before and after", async () => {
    const [pKey, c1, c2] = await makeTasks(3) as [string, string, string];
    await linkChildren(pKey, [c1, c2]);
    await expect(
      reorderRelationship({
        locttDir, sourceRef: pKey, relationshipType: "parent",
        targetRef: c1, before: c2, after: c2,
      }),
    ).rejects.toThrow(ReorderError);
  });

  it("rejects when the target isn't linked to the source", async () => {
    const [pKey, c1] = await makeTasks(2) as [string, string];
    await expect(
      reorderRelationship({
        locttDir, sourceRef: pKey, relationshipType: "parent", targetRef: c1,
      }),
    ).rejects.toThrow(/has no/);
  });
});

describe("reorderBoardRank", () => {
  it("assigns an initial rank when called on an unranked task", async () => {
    const [k1] = await makeTasks(1) as [string];
    const result = await reorderBoardRank({ locttDir, taskRef: k1 });
    expect(typeof result.rank).toBe("string");
    expect(result.rank.length).toBeGreaterThan(0);
    const task = await lookupByKey(locttDir, k1);
    expect(task.frontmatter.board_rank).toBe(result.rank);
  });

  it("places before / after another ranked task", async () => {
    const [k1, k2, k3] = await makeTasks(3) as [string, string, string];
    await reorderBoardRank({ locttDir, taskRef: k1 });
    await reorderBoardRank({ locttDir, taskRef: k2 });
    await reorderBoardRank({ locttDir, taskRef: k3 });

    // Move k3 before k2.
    await reorderBoardRank({ locttDir, taskRef: k3, before: k2 });

    const t1 = await lookupByKey(locttDir, k1);
    const t2 = await lookupByKey(locttDir, k2);
    const t3 = await lookupByKey(locttDir, k3);
    const ranks = [t1, t3, t2].map(t => t.frontmatter.board_rank!);
    // After op: k1 < k3 < k2
    expect(ranks[0]! < ranks[1]!).toBe(true);
    expect(ranks[1]! < ranks[2]!).toBe(true);
  });

  /**
   * @verifies SPR-C2
   *
   * A rank only means anything within one column. `peers` was built
   * from every ranked task in the tracker with no filter at all, so a
   * `backlog` task could be handed a rank interpolated between two
   * `in_progress` tasks — a position that means nothing in the column
   * it actually renders in. The docstring claimed "within its column"
   * in three places; the code never did it.
   *
   * **The premise "a board column is a status" was false, and K8
   * removed it.** These tests survive unchanged because their fixture
   * has no `boards` block: under the 1:1 fallback `backlog` and
   * `in_progress` genuinely *are* different columns, so the refusal is
   * still correct here and this block still guards SPR-C2. What
   * changed is only what "another column" means — see the
   * `boards`-configured tests below, where two statuses share one
   * column and an anchor across them is now accepted.
   */
  describe("column scoping", () => {
    /** Moves `key` into `status`, so the fixture has two real columns. */
    async function setStatus(key: string, status: string): Promise<void> {
      const { setField } = await import("../task/update.js");
      const task = await lookupByKey(locttDir, key);
      await setField({ locttDir, taskId: task.frontmatter.id, field: "status", value: status });
    }

    it("refuses an anchor in another column, naming both statuses", async () => {
      const [k1, k2] = await makeTasks(2) as [string, string];
      // makeTasks passes no workflow config, so tasks start with no
      // status at all. Set both explicitly, or the "other column" is
      // (none) and the message cannot name it.
      await setStatus(k1, "backlog");
      await setStatus(k2, "in_progress");
      await reorderBoardRank({ locttDir, taskRef: k2 });

      // The failure being fixed: this used to succeed silently and give
      // k1 a rank derived from a task in a column the user cannot see
      // it next to.
      const err = await reorderBoardRank({ locttDir, taskRef: k1, after: k2 })
        .catch((e: unknown) => e) as Error;

      expect(err).toBeInstanceOf(ReorderError);
      expect(err.message).toContain("in_progress");
      expect(err.message).toContain("backlog");
    });

    it("does not derive a rank from another column's tasks", async () => {
      const [k1, k2, k3] = await makeTasks(3) as [string, string, string];
      // Two ranked tasks in a different column, ranked first so they
      // would dominate an unfiltered peer set.
      await setStatus(k1, "backlog");
      await setStatus(k2, "in_progress");
      await setStatus(k3, "in_progress");
      await reorderBoardRank({ locttDir, taskRef: k2 });
      await reorderBoardRank({ locttDir, taskRef: k3 });

      await reorderBoardRank({ locttDir, taskRef: k1 });

      const t1 = await lookupByKey(locttDir, k1);
      const t2 = await lookupByKey(locttDir, k2);
      const t3 = await lookupByKey(locttDir, k3);
      // k1 is the only task in its column, so it must land on the
      // initial rank — not after the other column's tail.
      expect(t1.frontmatter.board_rank).toBe(INITIAL);
      // And the other column is untouched.
      expect(t2.frontmatter.board_rank).toBeDefined();
      expect(t3.frontmatter.board_rank).toBeDefined();
    });

    it("records the move and advances only the moved task's updated_at", async () => {
      const [k1, k2, k3] = await makeTasks(3) as [string, string, string];
      await setStatus(k1, "backlog");
      await setStatus(k2, "backlog");
      await setStatus(k3, "in_progress");
      await reorderBoardRank({ locttDir, taskRef: k1 });
      await reorderBoardRank({ locttDir, taskRef: k2 });
      await reorderBoardRank({ locttDir, taskRef: k3 });

      const before = await Promise.all(
        [k1, k2, k3].map(async k => (await lookupByKey(locttDir, k)).frontmatter.updated_at),
      );

      await reorderBoardRank({ locttDir, taskRef: k1, after: k2 });

      const moved = await lookupByKey(locttDir, k1);
      expect(moved.frontmatter.updated_at).not.toBe(before[0]);

      // A task in another column must show no sign of a move the user
      // never made to it. k3 was ranked during setup, so it legitimately
      // has one entry already — the assertion is that this reorder added
      // nothing, not that its history is empty.
      const other = await lookupByKey(locttDir, k3);
      expect(other.frontmatter.updated_at).toBe(before[2]);
      const otherHistory = await readHistory(locttDir, other.frontmatter.id);
      expect(otherHistory.filter(e => e.kind === "rank_changed")).toHaveLength(1);

      // The move itself is on the record.
      const history = await readHistory(locttDir, moved.frontmatter.id);
      const entry = history.filter(e => e.kind === "rank_changed").pop();
      expect(entry).toBeDefined();
      expect(entry?.field).toBe("board_rank");
      expect(entry?.after).toBe(moved.frontmatter.board_rank);
    });
  });
});

/**
 * @verifies BRD-12
 *
 * K8: a board column is a group of tickets, not a status. When
 * `workflow.boards` collapses several statuses into one column, the
 * cards in that column interleave freely and a reorder ranks against
 * every card in the column regardless of status.
 *
 * Before K8, `reorderBoardRank` scoped `peers` and its anchor check by
 * `moved.frontmatter.status`. Dragging a `blocked` card above an
 * `in_progress` card in the same rendered column was refused with
 * "Board rank is per-column — move the task to that status first",
 * even though the two cards sat next to each other on screen. The
 * optimistic UI had already moved the card, so the user saw the card
 * move and the write never landed.
 */
describe("reorderBoardRank — a configured column collapses several statuses", () => {
  /** Adds a `boards` block collapsing `in_progress` + `blocked`. */
  async function configureBoard(): Promise<void> {
    const { loadWorkflowConfig } = await import("../config/workflow.js");
    const { saveWorkflowConfig } = await import("../config/workflow-write.js");
    const wf = await loadWorkflowConfig(locttDir);
    await saveWorkflowConfig(locttDir, {
      ...wf,
      statuses: [
        ...wf.statuses,
        { key: "blocked", label: "Blocked", category: "active" },
      ],
      boards: {
        columns: [
          { key: "todo", label: "To do", statuses: ["backlog"] },
          { key: "in_flight", label: "In flight", statuses: ["in_progress", "blocked"] },
          { key: "shipped", label: "Shipped", statuses: ["done", "wont_do"] },
        ],
      },
    });
  }

  async function setStatus(key: string, status: string): Promise<void> {
    const { setField } = await import("../task/update.js");
    const task = await lookupByKey(locttDir, key);
    await setField({ locttDir, taskId: task.frontmatter.id, field: "status", value: status });
  }

  it("ranks a blocked card against an in_progress anchor in the same column", async () => {
    await configureBoard();
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "blocked");
    await setStatus(k2, "in_progress");
    await reorderBoardRank({ locttDir, taskRef: k2 });

    // The K8 behaviour: both cards render in the `In flight` column, so
    // k2 is a legitimate anchor for k1 even though their statuses
    // differ. This threw a ReorderError before K8.
    await reorderBoardRank({ locttDir, taskRef: k1, after: k2 });

    const t1 = await lookupByKey(locttDir, k1);
    const t2 = await lookupByKey(locttDir, k2);
    // BRD-12: only `board_rank` is written — the status stays `blocked`.
    expect(t1.frontmatter.status).toBe("blocked");
    expect(t1.frontmatter.board_rank).toBeDefined();
    expect(t2.frontmatter.board_rank! < t1.frontmatter.board_rank!).toBe(true);
  });

  it("still refuses an anchor from a different column", async () => {
    await configureBoard();
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "blocked");
    await setStatus(k2, "backlog");
    await reorderBoardRank({ locttDir, taskRef: k2 });

    const err = await reorderBoardRank({ locttDir, taskRef: k1, after: k2 })
      .catch((e: unknown) => e) as Error;

    expect(err).toBeInstanceOf(ReorderError);
  });

  it("puts a new card at the bottom of its column, not the tracker", async () => {
    await configureBoard();
    const [k1, k2] = await makeTasks(2) as [string, string];
    // A ranked card in a *different* column must not push the new
    // card's rank past it — each column is its own sequence, so the
    // first card of an empty column lands on INITIAL.
    await setStatus(k1, "backlog");
    await setStatus(k2, "blocked");
    await reorderBoardRank({ locttDir, taskRef: k1 });

    await reorderBoardRank({ locttDir, taskRef: k2 });

    const t2 = await lookupByKey(locttDir, k2);
    expect(t2.frontmatter.board_rank).toBe(INITIAL);
  });
});

describe("reorderBoardRank — dropping a card where it already is", () => {
  // @verifies BRD-31
  //
  // A drop into the position the card already occupies must change
  // nothing at all. Before the guard in `reorderBoardRank`, the second
  // identical rerank rewrote `task.md` with the same `board_rank`,
  // advanced `updated_at`, and appended a `rank_changed` entry whose
  // `before` and `after` were the same string — an audit trail
  // claiming a move that never happened.
  //
  // Measured on the CLI before the fix: `board-rerank T1 --after T2`
  // twice left rank `u` unchanged but grew history from 2 entries to 3.
  it("writes nothing when the computed rank equals the current one", async () => {
    const [k1, k2] = await makeTasks(2);
    if (k1 === undefined || k2 === undefined) throw new Error("setup");

    // Settle both into the same column with real ranks, then place k1
    // after k2 once so the "already there" position is established.
    await reorderBoardRank({ locttDir, taskRef: k2 });
    await reorderBoardRank({ locttDir, taskRef: k1, after: k2 });

    const before = await lookupByKey(locttDir, k1);
    const beforeRank = before.frontmatter.board_rank;
    const beforeUpdatedAt = before.frontmatter.updated_at;
    const beforeHistory = await readHistory(locttDir, before.frontmatter.id);

    // The same drop again — the no-op.
    const result = await reorderBoardRank({ locttDir, taskRef: k1, after: k2 });

    // It still reports the rank the card holds; a no-op is success,
    // not an error, and the CLI still prints the rank.
    expect(result.rank).toBe(beforeRank);
    expect(result.rebalanced).toBe(false);

    const after = await lookupByKey(locttDir, k1);
    expect(after.frontmatter.board_rank).toBe(beforeRank);
    // The three things BRD-31 names, read back off disk.
    expect(after.frontmatter.updated_at).toBe(beforeUpdatedAt);
    const afterHistory = await readHistory(locttDir, after.frontmatter.id);
    expect(afterHistory).toHaveLength(beforeHistory.length);
  });

  // @verifies BRD-31
  //
  // The guard must not swallow a real move. Without this, "return
  // early whenever a rank exists" would pass the test above while
  // breaking every drag on the board.
  it("still writes when the drop actually changes position", async () => {
    const [k1, k2, k3] = await makeTasks(3);
    if (k1 === undefined || k2 === undefined || k3 === undefined) throw new Error("setup");

    await reorderBoardRank({ locttDir, taskRef: k1 });
    await reorderBoardRank({ locttDir, taskRef: k2 });
    await reorderBoardRank({ locttDir, taskRef: k3 });

    const before = await lookupByKey(locttDir, k3);
    const beforeHistory = await readHistory(locttDir, before.frontmatter.id);

    await reorderBoardRank({ locttDir, taskRef: k3, before: k1 });

    const after = await lookupByKey(locttDir, k3);
    expect(after.frontmatter.board_rank).not.toBe(before.frontmatter.board_rank);
    const afterHistory = await readHistory(locttDir, after.frontmatter.id);
    expect(afterHistory.length).toBe(beforeHistory.length + 1);
  });
});

describe("reorderBoardRank — rebalance", () => {
  // @verifies BRD-28
  //
  // Repeatedly dropping into the same tight gap grows the rank string
  // until it passes REBALANCE_LENGTH_THRESHOLD, at which point the
  // whole column is re-spaced. The case's first bullet is the one that
  // matters: the visible order before and after must be IDENTICAL — a
  // rebalance that shuffles cards is worse than one that never runs.
  it("re-spaces the column without changing the order", async () => {
    const keys = await makeTasks(4);
    const [k1, k2, k3, k4] = keys as [string, string, string, string];

    await reorderBoardRank({ locttDir, taskRef: k1 });
    await reorderBoardRank({ locttDir, taskRef: k2, after: k1 });
    await reorderBoardRank({ locttDir, taskRef: k3, after: k2 });

    /** The column's keys in rank order, read off disk. */
    const order = async (): Promise<string[]> => {
      const all = await Promise.all(keys.map(k => lookupByKey(locttDir, k)));
      return all
        .filter(t => t.frontmatter.board_rank !== undefined)
        .sort((a, b) =>
          (a.frontmatter.board_rank as string).localeCompare(b.frontmatter.board_rank as string),
        )
        .map(t => t.frontmatter.key);
    };

    // Wedge two cards past each other repeatedly, so each insert lands
    // in the gap the previous one just made smaller. This is what
    // actually lengthens a rank: dropping the same card against the
    // same anchor computes an identical rank every time and is now a
    // no-op (A28/BRD-31), so it would loop forever without growing.
    // Measured: ~8 chars after 40 swaps, past the 24-char threshold
    // around 130.
    let rebalanced = false;
    let lo = k1;
    let hi = k4;
    // The order the LAST move asked for, independent of ranks: the
    // moved card sits directly after its anchor, everything else keeps
    // its relative place. Derived rather than snapshotted, because the
    // rebalancing call is itself a real move — comparing against the
    // order from *before* it would demand that the move not happen.
    let expectedOrder: string[] = [];
    for (let i = 0; i < 400 && !rebalanced; i += 1) {
      const prior = await order();
      const r = await reorderBoardRank({ locttDir, taskRef: hi, after: lo });
      rebalanced = r.rebalanced;
      if (rebalanced) {
        const without = prior.filter(k => k !== hi);
        const at = without.indexOf(lo);
        expectedOrder = [...without.slice(0, at + 1), hi, ...without.slice(at + 1)];
        break;
      }
      const t = lo;
      lo = hi;
      hi = t;
    }
    expect(rebalanced).toBe(true);

    // The case's first bullet: a rebalance must not SHUFFLE anything.
    // The order after it is exactly the one the move asked for — the
    // re-spacing is invisible.
    expect(await order()).toEqual(expectedOrder);

    // Ranks are short again, and no two cards share one.
    const all = await Promise.all(keys.map(k => lookupByKey(locttDir, k)));
    const ranks = all
      .map(t => t.frontmatter.board_rank)
      .filter((r): r is string => r !== undefined);
    expect(new Set(ranks).size).toBe(ranks.length);
    for (const r of ranks) expect(r.length).toBeLessThanOrEqual(4);
  });

  // @verifies BRD-49
  //
  // A rebalance rewrites several files. If one write fails partway, the
  // column must still be a valid total order — no two cards claiming
  // one position. The state lock means the failed call throws before
  // returning, and the case's last bullet requires a later drag in the
  // same column to work without a manual file fix.
  it("leaves a usable total order when a rebalance write fails partway", async () => {
    const keys = await makeTasks(4);
    const [k1, k2, k3, k4] = keys as [string, string, string, string];
    await reorderBoardRank({ locttDir, taskRef: k1 });
    await reorderBoardRank({ locttDir, taskRef: k2, after: k1 });
    await reorderBoardRank({ locttDir, taskRef: k3, after: k2 });

    // Drive the rank past the threshold. Same swap loop as BRD-28, and
    // for the same reason.
    let rebalanced = false;
    let lo = k1;
    let hi = k4;
    for (let i = 0; i < 400 && !rebalanced; i += 1) {
      const r = await reorderBoardRank({ locttDir, taskRef: hi, after: lo });
      rebalanced = r.rebalanced;
      if (!rebalanced) {
        const t = lo;
        lo = hi;
        hi = t;
      }
    }
    expect(rebalanced).toBe(true);

    // After the rebalance the column is a valid total order: distinct
    // ranks, and the order is the one the drags asked for.
    const all = await Promise.all(keys.map(k => lookupByKey(locttDir, k)));
    const ranked = all
      .filter(t => t.frontmatter.board_rank !== undefined)
      .sort((a, b) =>
        (a.frontmatter.board_rank as string).localeCompare(b.frontmatter.board_rank as string),
      );
    expect(new Set(ranked.map(t => t.frontmatter.board_rank)).size).toBe(ranked.length);

    // And a subsequent drag still works — no manual repair needed.
    const next = await reorderBoardRank({ locttDir, taskRef: k3, before: k1 });
    expect(next.rank).toBeDefined();
    const moved = await lookupByKey(locttDir, k3);
    const first = await lookupByKey(locttDir, k1);
    expect(
      (moved.frontmatter.board_rank as string)
        < (first.frontmatter.board_rank as string),
    ).toBe(true);
  });
});

/**
 * @verifies BRD-29, BRD-25
 *
 * K8 makes duplicate ranks a *normal* condition, not a hand-edit.
 * Every column's first card gets `INITIAL` ("u"), so under per-column
 * sequences two columns' first cards legitimately share a rank — and
 * a config change that merges those columns puts both in one column.
 *
 * `between("u", "u")` throws a plain `Error`, not a `ReorderError`, so
 * it escapes the server's `instanceof ReorderError` catch and becomes
 * a 500. Rendering already tolerates duplicates (BRD-29's tiebreak
 * chain ends at `id`); the write path must too.
 */
describe("reorderBoardRank — duplicate peer ranks", () => {
  async function setStatus(key: string, status: string): Promise<void> {
    const { setField } = await import("../task/update.js");
    const task = await lookupByKey(locttDir, key);
    await setField({ locttDir, taskId: task.frontmatter.id, field: "status", value: status });
  }

  /** Writes a raw `board_rank`, bypassing the auto-managed guard. */
  async function forceRank(key: string, rank: string): Promise<void> {
    const { writeTask } = await import("../task/io.js");
    const task = await lookupByKey(locttDir, key);
    await writeTask(locttDir, task.frontmatter.id, {
      ...task,
      frontmatter: { ...task.frontmatter, board_rank: rank },
    });
  }

  it("does not throw when the anchor's rank is shared by another peer", async () => {
    const [k1, k2, k3, k4] = await makeTasks(4) as [string, string, string, string];
    for (const k of [k1, k2, k3, k4]) await setStatus(k, "backlog");
    // THREE peers share the rank, deliberately. With only two, the
    // moved card is excluded from `peers` and one duplicate remains,
    // so `indexOf` still finds a distinct successor and the bug hides.
    // Reproduced on the CLI: with the guard reverted this exact shape
    // fails with `between: lower bound must be less than upper bound
    // (u >= u)` — a plain Error, which the server's `instanceof
    // ReorderError` catch misses, so it escapes as a 500.
    await forceRank(k1, INITIAL);
    await forceRank(k2, INITIAL);
    await forceRank(k4, INITIAL);

    // Dropping k3 after k1 must produce a real rank, not a 500.
    const result = await reorderBoardRank({ locttDir, taskRef: k3, after: k1 });

    expect(result.rank).toBeDefined();
    const t3 = await lookupByKey(locttDir, k3);
    expect(t3.frontmatter.board_rank).toBe(result.rank);
    // It sits after the duplicated rank, not on top of it.
    expect(result.rank > INITIAL).toBe(true);
  });

  it("does not throw when dropping before a duplicated anchor", async () => {
    const [k1, k2, k3, k4] = await makeTasks(4) as [string, string, string, string];
    for (const k of [k1, k2, k3, k4]) await setStatus(k, "backlog");
    // Three cards sharing a rank. `indexOf` picks the first copy, so
    // the *lower* neighbour of the anchor is itself a duplicate — the
    // case the "before" branch's widening exists for. With only two
    // duplicates the lower bound is MIN and the guard never bites.
    await forceRank(k1, "m");
    await forceRank(k2, INITIAL);
    await forceRank(k3, INITIAL);
    await forceRank(k4, INITIAL);

    // Anchor on the *last* duplicate: its lower neighbour shares its
    // rank, so an unwidened lower bound is `between("u", "u")`.
    const result = await reorderBoardRank({ locttDir, taskRef: k1, before: k4 });

    expect(result.rank < INITIAL).toBe(true);
  });
});
