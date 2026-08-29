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
   * A board column is a status, and a rank only means anything within
   * one. `peers` was built from every ranked task in the tracker with no
   * status filter, so a `backlog` task could be handed a rank
   * interpolated between two `in_progress` tasks — a position that means
   * nothing in the column it actually renders in. The docstring claimed
   * "within its column" in three places; the code never did it.
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
