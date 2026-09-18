import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkflowConfig } from "../config/workflow.js";
import { saveWorkflowConfig } from "../config/workflow-write.js";
import { initLoctt } from "../init/index.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { readHistory } from "../task/history.js";
import { writeTask } from "../task/io.js";
import { lookupByKey } from "../task/lookup.js";
import { setField } from "../task/update.js";
import { boardMove } from "./board-move.js";
import { INITIAL, REBALANCE_LENGTH_THRESHOLD } from "./lexorank.js";
import { ReorderError } from "./reorder.js";

let root: string;
let locttDir: string;
let taskProjectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-boardmove-"));
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

async function setStatus(key: string, status: string): Promise<void> {
  const task = await lookupByKey(locttDir, key);
  await setField({ locttDir, taskId: task.frontmatter.id, field: "status", value: status });
}

async function forceRank(key: string, rank: string): Promise<void> {
  const task = await lookupByKey(locttDir, key);
  await writeTask(locttDir, task.frontmatter.id, {
    ...task,
    frontmatter: { ...task.frontmatter, board_rank: rank },
  });
}

/** A `boards` block collapsing `in_progress` + `blocked` into one column. */
async function configureBoard(): Promise<void> {
  const wf = await loadWorkflowConfig(locttDir);
  await saveWorkflowConfig(locttDir, {
    ...wf,
    statuses: [...wf.statuses, { key: "blocked", label: "Blocked", category: "active" }],
    boards: {
      columns: [
        { key: "todo", label: "To do", statuses: ["backlog"] },
        { key: "in_flight", label: "In flight", statuses: ["in_progress", "blocked"] },
        { key: "shipped", label: "Shipped", statuses: ["done", "wont_do"] },
      ],
    },
  });
}

/**
 * @verifies BRD-41, XS-9
 *
 * A cross-column drop writes `status` and `board_rank` in one change
 * set. Two sequential writes leave a window in which the card's column
 * and its stored status disagree — the half-landed state BRD-41 says
 * must never reach disk.
 */
describe("boardMove — atomic status + rank", () => {
  it("writes both fields in one history batch", async () => {
    const [k1] = await makeTasks(1) as [string];
    await setStatus(k1, "backlog");
    const seeded = await lookupByKey(locttDir, k1);
    const seededHistory = await readHistory(locttDir, seeded.frontmatter.id);

    const result = await boardMove({ locttDir, taskRef: k1, status: "in_progress" });

    const t1 = await lookupByKey(locttDir, k1);
    // Read off disk, not off the result.
    expect(t1.frontmatter.status).toBe("in_progress");
    expect(t1.frontmatter.board_rank).toBe(result.rank);
    expect(t1.frontmatter.board_rank).toBeDefined();

    // One batch: both field changes carry the same timestamp, which is
    // what "one write" looks like in the audit trail.
    const history = await readHistory(locttDir, t1.frontmatter.id);
    const added = history.slice(seededHistory.length);
    expect(added.some(e => e.field === "status")).toBe(true);
    expect(added.some(e => e.field === "board_rank")).toBe(true);
    // One batch: every entry this move added carries the same
    // timestamp, which is what an atomic write looks like in the audit
    // trail. Two sequential writes would stamp two.
    expect(new Set(added.map(e => e.timestamp)).size).toBe(1);
  });

  it("does not resend status on an intra-column reorder", async () => {
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "backlog");
    await setStatus(k2, "backlog");
    await boardMove({ locttDir, taskRef: k2 });

    const before = await lookupByKey(locttDir, k1);
    const beforeHistory = await readHistory(locttDir, before.frontmatter.id);

    await boardMove({ locttDir, taskRef: k1, after: k2 });

    const after = await lookupByKey(locttDir, k1);
    const afterHistory = await readHistory(locttDir, after.frontmatter.id);
    // XS-9: `status` is absent from the payload, not resent with its
    // current value — so no status history entry appears.
    const added = afterHistory.slice(beforeHistory.length);
    expect(added.some(e => e.field === "status")).toBe(false);
    expect(added.some(e => e.field === "board_rank")).toBe(true);
  });

  it("validates anchors against the destination column, not the origin", async () => {
    await configureBoard();
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "backlog");
    await setStatus(k2, "in_progress");
    await boardMove({ locttDir, taskRef: k2 });

    // k1 moves from `To do` into `In flight`, anchored on a card that
    // lives in the destination. `reorderBoardRank` would refuse this
    // outright — its anchor check is against the card's *current*
    // column.
    await boardMove({ locttDir, taskRef: k1, status: "blocked", after: k2 });

    const t1 = await lookupByKey(locttDir, k1);
    const t2 = await lookupByKey(locttDir, k2);
    expect(t1.frontmatter.status).toBe("blocked");
    expect(t2.frontmatter.board_rank! < t1.frontmatter.board_rank!).toBe(true);
  });
});

/**
 * @verifies BRD-44, BRD-35
 */
describe("boardMove — stale anchors", () => {
  it("names the operation when a neighbour was deleted mid-drag", async () => {
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "backlog");
    await setStatus(k2, "backlog");
    const t2 = await lookupByKey(locttDir, k2);
    const { deleteTask } = await import("../task/lifecycle.js");
    await deleteTask(locttDir, t2.frontmatter.id, { force: true });

    const err = await boardMove({ locttDir, taskRef: k1, after: k2 })
      .catch((e: unknown) => e) as Error;

    expect(err).toBeInstanceOf(ReorderError);
    expect(err.message).toContain(k1);
    expect(err.message).toContain("no longer");
    expect(err.message).toContain("Reload");
  });

  it("refuses an anchor that left the destination column mid-drag", async () => {
    await configureBoard();
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "in_progress");
    await setStatus(k2, "in_progress");
    await boardMove({ locttDir, taskRef: k2 });
    // BRD-35: another surface moves the anchor to a third column while
    // the drag is held.
    await setStatus(k2, "done");

    const err = await boardMove({ locttDir, taskRef: k1, after: k2 })
      .catch((e: unknown) => e) as Error;

    expect(err).toBeInstanceOf(ReorderError);
  });
});

/**
 * @verifies BRD-31
 */
describe("boardMove — no-op guard", () => {
  it("writes nothing when neither status nor rank changes", async () => {
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "backlog");
    await setStatus(k2, "backlog");
    await boardMove({ locttDir, taskRef: k2 });
    await boardMove({ locttDir, taskRef: k1, after: k2 });

    const before = await lookupByKey(locttDir, k1);
    const beforeHistory = await readHistory(locttDir, before.frontmatter.id);

    await boardMove({ locttDir, taskRef: k1, after: k2 });

    const after = await lookupByKey(locttDir, k1);
    expect(after.frontmatter.board_rank).toBe(before.frontmatter.board_rank);
    expect(after.frontmatter.updated_at).toBe(before.frontmatter.updated_at);
    const afterHistory = await readHistory(locttDir, after.frontmatter.id);
    expect(afterHistory).toHaveLength(beforeHistory.length);
  });

  it("still writes the status when only the rank is unchanged", async () => {
    await configureBoard();
    const [k1] = await makeTasks(1) as [string];
    await setStatus(k1, "in_progress");
    await boardMove({ locttDir, taskRef: k1 });
    const settled = await lookupByKey(locttDir, k1);
    const rank = settled.frontmatter.board_rank!;

    // Same column (in_flight collapses both), so the rank it would get
    // is the one it already has — but the status still has to land.
    await boardMove({ locttDir, taskRef: k1, status: "blocked" });

    const after = await lookupByKey(locttDir, k1);
    expect(after.frontmatter.status).toBe("blocked");
    expect(after.frontmatter.board_rank).toBe(rank);
  });
});

/**
 * @verifies BRD-28
 *
 * The rebalance is scoped to the column being written. Re-spacing
 * every ranked task in the tracker would rewrite cards in columns the
 * user never touched — and under per-column sequences those ranks are
 * not even comparable, so "corrupt" here means another column's
 * relative order silently changing.
 */
describe("boardMove — rebalance is scoped to one column", () => {
  it("does not touch another column's ranks or their order", async () => {
    await configureBoard();
    const [a1, a2, b1, b2, b3] = await makeTasks(5) as [string, string, string, string, string];
    // Column `To do`: two cards whose order must survive untouched.
    await setStatus(a1, "backlog");
    await setStatus(a2, "backlog");
    await forceRank(a1, "c");
    await forceRank(a2, "e");
    // Column `In flight`: two cards a hair apart, so the next insert
    // between them produces a very long rank.
    await setStatus(b1, "in_progress");
    await setStatus(b2, "blocked");
    await setStatus(b3, "in_progress");
    const tight = "u" + "z".repeat(REBALANCE_LENGTH_THRESHOLD);
    await forceRank(b1, tight);
    await forceRank(b2, tight + "z");

    const result = await boardMove({ locttDir, taskRef: b3, after: b1, before: b2 });

    expect(result.rebalanced).toBe(true);

    // The other column is byte-for-byte untouched.
    const t1 = await lookupByKey(locttDir, a1);
    const t2 = await lookupByKey(locttDir, a2);
    expect(t1.frontmatter.board_rank).toBe("c");
    expect(t2.frontmatter.board_rank).toBe("e");

    // The rebalanced column kept its order and has no duplicates.
    const rebalanced = await Promise.all(
      [b1, b3, b2].map(async k => (await lookupByKey(locttDir, k)).frontmatter.board_rank!),
    );
    expect(rebalanced[0]! < rebalanced[1]!).toBe(true);
    expect(rebalanced[1]! < rebalanced[2]!).toBe(true);
    expect(new Set(rebalanced).size).toBe(3);
    // And they are short again.
    for (const r of rebalanced) expect(r.length).toBeLessThanOrEqual(4);
  });
});

/**
 * @verifies BRD-26
 *
 * K8: "new tickets added just gets put at the bottom of the column."
 */
describe("boardMove — end of the column", () => {
  it("appends to the column's end, not the tracker's", async () => {
    await configureBoard();
    const [k1, k2] = await makeTasks(2) as [string, string];
    await setStatus(k1, "backlog");
    await setStatus(k2, "blocked");
    await forceRank(k1, "y");

    await boardMove({ locttDir, taskRef: k2 });

    const t2 = await lookupByKey(locttDir, k2);
    // The other column's high rank must not push this one past it —
    // an empty column's first card lands on INITIAL.
    expect(t2.frontmatter.board_rank).toBe(INITIAL);
  });
});

/**
 * @verifies BRD-29
 *
 * The cross-column path has its own interpolation, so it needs its own
 * duplicate-rank cover. Both anchors landing on the same rank is what
 * a merged column looks like: `between(x, x)` throws a plain Error,
 * which the server's `instanceof ReorderError` catch misses, so it
 * would escape as a 500.
 */
describe("boardMove — duplicate anchor ranks", () => {
  it("does not throw when both anchors carry the same rank", async () => {
    await configureBoard();
    const [k1, k2, k3] = await makeTasks(3) as [string, string, string];
    await setStatus(k1, "backlog");
    await setStatus(k2, "in_progress");
    await setStatus(k3, "blocked");
    // Two cards in the destination column sharing a rank, and the drop
    // lands between them — so lower and upper bounds are equal.
    await forceRank(k2, INITIAL);
    await forceRank(k3, INITIAL);

    const result = await boardMove({
      locttDir,
      taskRef: k1,
      status: "in_progress",
      after: k2,
      before: k3,
    });

    expect(result.rank).toBeDefined();
    const t1 = await lookupByKey(locttDir, k1);
    expect(t1.frontmatter.status).toBe("in_progress");
    expect(t1.frontmatter.board_rank).toBe(result.rank);
  });
});
