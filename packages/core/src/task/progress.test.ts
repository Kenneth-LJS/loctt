import type { Task, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { computeProgress, computeProgressFromStatuses } from "./progress.js";

/**
 * The load-bearing rules, per flow-milestones-labels.md:
 *
 *  - progress is computed from status CATEGORY, never a status key
 *  - discarded tasks are EXCLUDED from the denominator
 */
const workflow = {
  key: { prefix: "T" },
  statuses: [
    { key: "backlog", label: "Backlog", category: "pending", default: true },
    { key: "doing", label: "Doing", category: "active" },
    { key: "shipped", label: "Shipped", category: "completed" },
    { key: "verified", label: "Verified", category: "completed" },
    { key: "abandoned", label: "Abandoned", category: "discarded" },
  ],
  priorities: [], task_types: [], relationships: [], custom_fields: [],
} as unknown as WorkflowConfig;

function t(status?: string): Task {
  return {
    frontmatter: {
      id: `id-${Math.random()}`, key: "T-1", title: "x",
      created_at: "2026-01-01", updated_at: "2026-01-01",
      ...(status !== undefined ? { status } : {}),
    } as Task["frontmatter"],
    body: "",
  };
}

describe("computeProgress", () => {
  it("counts by category, not by the key `done`", () => {
    // This workflow has no status called `done` at all, and two
    // different completed-category statuses. A rule written against
    // `status = done` would report 0.
    const p = computeProgress([t("shipped"), t("verified"), t("doing")], workflow);
    expect(p.done).toBe(2);
    expect(p.total).toBe(3);
  });

  it("excludes discarded from the denominator", () => {
    // The worked example from MSL-3: 4 done, 2 abandoned, 4 outstanding
    // reads 4 / 8, not 4 / 10.
    const tasks = [
      ...Array.from({ length: 4 }, () => t("shipped")),
      ...Array.from({ length: 2 }, () => t("abandoned")),
      ...Array.from({ length: 4 }, () => t("backlog")),
    ];
    const p = computeProgress(tasks, workflow);
    expect(p.done).toBe(4);
    expect(p.total).toBe(8);
    expect(p.discarded).toBe(2);
  });

  it("reads 100% when all remaining work is discarded", () => {
    // Otherwise a milestone stalls below 100% forever because of work
    // nobody intends to do.
    const p = computeProgress([t("shipped"), t("abandoned")], workflow);
    expect(p.done).toBe(1);
    expect(p.total).toBe(1);
    expect(p.fraction).toBe(1);
  });

  it("reports discarded separately so a surface can explain the number", () => {
    // Silently shrinking a denominator is as confusing as leaving dead
    // work in it.
    expect(computeProgress([t("abandoned")], workflow).discarded).toBe(1);
  });

  it("is 0% for an empty milestone, not 100%", () => {
    // "Nothing to do" and "everything done" are different states;
    // rendering an empty milestone as a full bar would be a lie.
    const p = computeProgress([], workflow);
    expect(p).toEqual({ done: 0, active: 0, total: 0, discarded: 0, fraction: 0 });
  });

  it("is 0% when every task is discarded", () => {
    const p = computeProgress([t("abandoned"), t("abandoned")], workflow);
    expect(p.total).toBe(0);
    expect(p.fraction).toBe(0);
  });

  it("counts a status-less task toward total but not done", () => {
    // Unrecognised is not finished.
    const p = computeProgress([t(), t("shipped")], workflow);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
  });

  it("counts a status unknown to the config toward total but not done", () => {
    const p = computeProgress([t("from_an_older_config"), t("shipped")], workflow);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
  });

  it("computes the fraction the bar renders", () => {
    const p = computeProgress([t("shipped"), t("backlog"), t("doing"), t("verified")], workflow);
    expect(p.done).toBe(2);
    expect(p.total).toBe(4);
    expect(p.fraction).toBe(0.5);
  });

  it("counts active-category tasks separately from done and the rest (L4)", () => {
    // The three-segment bar needs done / active / rest. `active` is the
    // count of active-category statuses — not a status key, so a renamed
    // `doing` still lands in the bucket. This asserts the middle segment:
    // deleting the `active` branch in `tallyStatusCategories` folds these
    // into neither done nor active and turns this red.
    const p = computeProgress(
      [t("shipped"), t("doing"), t("doing"), t("backlog")],
      workflow,
    );
    expect(p.done).toBe(1);
    expect(p.active).toBe(2);
    expect(p.total).toBe(4);
    // The un-started remainder the third segment fills.
    expect(p.total - p.done - p.active).toBe(1);
  });

  it("excludes discarded tasks from active as well as from total", () => {
    // `active` is a subset of `total`, which already excludes discarded —
    // an abandoned task is never in flight.
    const p = computeProgress([t("doing"), t("abandoned")], workflow);
    expect(p.active).toBe(1);
    expect(p.total).toBe(1);
    expect(p.discarded).toBe(1);
  });

  it("reports zero active when nothing is in flight", () => {
    const p = computeProgress([t("shipped"), t("backlog")], workflow);
    expect(p.active).toBe(0);
  });

  it("survives a renamed active-category status", () => {
    // Category, never the key `doing`.
    const renamed = {
      ...workflow,
      statuses: [
        { key: "icebox", label: "Icebox", category: "pending", default: true },
        { key: "cooking", label: "Cooking", category: "active" },
        { key: "landed", label: "Landed", category: "completed" },
      ],
    } as unknown as WorkflowConfig;
    const p = computeProgress([t("cooking"), t("landed"), t("icebox")], renamed);
    expect(p.active).toBe(1);
    expect(p.done).toBe(1);
    expect(p.total).toBe(3);
  });
});

describe("computeProgressFromStatuses", () => {
  it("computes the same numbers as computeProgress from bare status keys", () => {
    // The surface helper (CLI/MCP/web child meter) resolves status keys,
    // not Task objects, and must land on the identical categorisation and
    // discarded-exclusion. Red-proof: swapping the `completed`/`active`
    // branches, or dropping the discarded exclusion, breaks this.
    const statuses = ["shipped", "doing", "doing", "abandoned", "backlog", undefined];
    const p = computeProgressFromStatuses(statuses, workflow);
    expect(p.done).toBe(1);
    expect(p.active).toBe(2);
    expect(p.total).toBe(5); // 6 minus the one discarded
    expect(p.discarded).toBe(1);
    expect(p.fraction).toBeCloseTo(1 / 5);
  });

  it("agrees with computeProgress task-for-task", () => {
    const tasks = [t("shipped"), t("doing"), t("abandoned"), t("backlog"), t()];
    const fromTasks = computeProgress(tasks, workflow);
    const fromStatuses = computeProgressFromStatuses(
      tasks.map(x => x.frontmatter.status),
      workflow,
    );
    expect(fromStatuses).toEqual(fromTasks);
  });

  it("is empty (not complete) for no statuses", () => {
    expect(computeProgressFromStatuses([], workflow)).toEqual({
      done: 0, active: 0, total: 0, discarded: 0, fraction: 0,
    });
  });

  it("survives a workflow that renamed every status", () => {
    // A tracker may rename or delete `done` entirely; only categories
    // are stable.
    const renamed = {
      ...workflow,
      statuses: [
        { key: "icebox", label: "Icebox", category: "pending", default: true },
        { key: "landed", label: "Landed", category: "completed" },
      ],
    } as unknown as WorkflowConfig;
    const p = computeProgressFromStatuses(["landed", "icebox"], renamed);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
  });
});
