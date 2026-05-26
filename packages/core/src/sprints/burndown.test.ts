import type {
  HistoryEntry,
  SprintDef,
  Task,
  WorkflowConfig,
} from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { computeBurndown } from "./burndown.js";

function mkWorkflow(estimation?: WorkflowConfig["estimation"]): WorkflowConfig {
  return {
    key: { prefix: "T-" },
    statuses: [
      { key: "todo", label: "To Do", category: "pending" },
      { key: "doing", label: "Doing", category: "active" },
      { key: "done", label: "Done", category: "completed" },
      { key: "dropped", label: "Dropped", category: "discarded" },
    ],
    priorities: [{ key: "p1", label: "P1" }],
    task_types: [{ key: "t", label: "Task" }],
    relationships: [],
    custom_fields: [],
    ...(estimation !== undefined ? { estimation } : {}),
  };
}

function mkSprint(overrides: Partial<SprintDef> = {}): SprintDef {
  return {
    id: "01HXSPRINT0000000000000001",
    name: "Sprint 1",
    start_date: "2026-05-04",
    end_date: "2026-05-08",
    state: "active",
    ...overrides,
  };
}

function mkTask(
  id: string,
  frontmatter: Partial<Task["frontmatter"]> & { created_at: string },
): Task {
  const { created_at, ...rest } = frontmatter;
  return {
    frontmatter: {
      id,
      key: id,
      title: id,
      created_at,
      updated_at: created_at,
      ...rest,
    },
    body: "",
  };
}

describe("computeBurndown — unit: tasks (estimation disabled)", () => {
  it("returns one sample per day across the sprint window inclusive", () => {
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [],
      historiesByTaskId: new Map(),
      workflow: mkWorkflow(),
    });
    expect(out.series.map(p => p.date)).toEqual([
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
    ]);
    expect(out.initialTotal).toBe(0);
  });

  it("counts a task that starts in the sprint and never completes as remaining on every day", () => {
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", []]]),
      workflow: mkWorkflow(),
    });
    expect(out.series.every(p => p.remaining === 1)).toBe(true);
    expect(out.series.every(p => p.incompleteTaskCount === 1)).toBe(true);
    expect(out.initialTotal).toBe(1);
  });

  it("excludes a task whose final status is completed (replay sees the entire trajectory)", () => {
    // Task starts in "todo" on May 3, moves to "done" on May 6.
    // Expected: count of 1 on days 1–2 (May 4, 5), 0 on days 3–5
    // (May 6, 7, 8). The replay walks BACK from the final frontmatter
    // to derive the initial state, so the frontmatter here reflects
    // the post-done state and the history records the transition.
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "done",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      {
        timestamp: "2026-05-06T12:00:00.000Z",
        kind: "field_change",
        field: "status",
        before: "todo",
        after: "done",
      },
    ];
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", history]]),
      workflow: mkWorkflow(),
    });
    // Day-by-day remaining: May 4 = 1 (todo), May 5 = 1 (todo),
    // May 6 = 0 (transitioned to done before end-of-day), May 7 = 0,
    // May 8 = 0.
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, 0, 0, 0]);
    expect(out.initialTotal).toBe(1);
  });

  it("shows a scope step when a task joins the sprint mid-run", () => {
    // Task added to sprint s1 on May 6. Before that the task was
    // outside the sprint, so it should not be counted on May 4 or 5.
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      {
        timestamp: "2026-05-06T08:00:00.000Z",
        kind: "field_change",
        field: "sprint",
        before: null,
        after: "01HXSPRINT0000000000000001",
      },
    ];
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", history]]),
      workflow: mkWorkflow(),
    });
    expect(out.series.map(p => p.remaining)).toEqual([0, 0, 1, 1, 1]);
  });

  it("shows a scope step DOWN when a task leaves the sprint mid-run", () => {
    // Task starts in sprint s1, removed on May 6.
    const task = mkTask("t1", {
      sprint: undefined,
      status: "todo",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      {
        timestamp: "2026-05-06T08:00:00.000Z",
        kind: "field_change",
        field: "sprint",
        before: "01HXSPRINT0000000000000001",
        after: null,
      },
    ];
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", history]]),
      workflow: mkWorkflow(),
    });
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, 0, 0, 0]);
  });

  it("does not count a task created after the sprint window ends", () => {
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      created_at: "2026-05-10T10:00:00.000Z",
    });
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", []]]),
      workflow: mkWorkflow(),
    });
    expect(out.series.every(p => p.remaining === 0)).toBe(true);
    expect(out.initialTotal).toBe(0);
  });

  it("does not count a task already completed before the sprint window starts", () => {
    // Task created Apr 30, completed May 1, sprint runs May 4-8.
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "done",
      created_at: "2026-04-30T10:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      {
        timestamp: "2026-05-01T12:00:00.000Z",
        kind: "field_change",
        field: "status",
        before: "todo",
        after: "done",
      },
    ];
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", history]]),
      workflow: mkWorkflow(),
    });
    expect(out.series.every(p => p.remaining === 0)).toBe(true);
  });

  it("rolls up multiple status changes in the same day to the final end-of-day state", () => {
    // todo → doing at 09:00, doing → done at 17:00 on May 5.
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "done",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      { timestamp: "2026-05-05T09:00:00.000Z", kind: "field_change", field: "status", before: "todo", after: "doing" },
      { timestamp: "2026-05-05T17:00:00.000Z", kind: "field_change", field: "status", before: "doing", after: "done" },
    ];
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", history]]),
      workflow: mkWorkflow(),
    });
    // May 4 = 1 (todo); May 5 end-of-day = 0 (final state is done);
    // May 6-8 = 0.
    expect(out.series.map(p => p.remaining)).toEqual([1, 0, 0, 0, 0]);
  });

  it("treats a `discarded`-category status the same as completed (not remaining)", () => {
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "dropped",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      {
        timestamp: "2026-05-05T12:00:00.000Z",
        kind: "field_change",
        field: "status",
        before: "todo",
        after: "dropped",
      },
    ];
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", history]]),
      workflow: mkWorkflow(),
    });
    expect(out.series.map(p => p.remaining)).toEqual([1, 0, 0, 0, 0]);
  });
});

describe("computeBurndown — unit: points (numeric)", () => {
  it("sums the `estimate` field across incomplete tasks", () => {
    const t1 = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      estimate: "3",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const t2 = mkTask("t2", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      estimate: "5",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [t1, t2],
      historiesByTaskId: new Map([["t1", []], ["t2", []]]),
      workflow: mkWorkflow({ enabled: true, unit: "points" }),
    });
    expect(out.unit).toBe("points");
    expect(out.initialTotal).toBe(8);
    expect(out.series.every(p => p.remaining === 8)).toBe(true);
    expect(out.series.every(p => p.incompleteTaskCount === 2)).toBe(true);
  });

  it("reflects an estimate change mid-sprint as a step in the remaining total", () => {
    // Task starts with estimate 3, jumps to 8 on May 6.
    const task = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      estimate: "8",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      {
        timestamp: "2026-05-06T12:00:00.000Z",
        kind: "field_change",
        field: "estimate",
        before: "3",
        after: "8",
      },
    ];
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [task],
      historiesByTaskId: new Map([["t1", history]]),
      workflow: mkWorkflow({ enabled: true, unit: "points" }),
    });
    // May 4 = 3, May 5 = 3, May 6 end-of-day = 8 (after change),
    // May 7-8 = 8. Pinning the step is the point.
    expect(out.series.map(p => p.remaining)).toEqual([3, 3, 8, 8, 8]);
  });

  it("contributes 0 for a task without an estimate but still counts it as 1 incomplete", () => {
    const t1 = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      estimate: "3",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const t2 = mkTask("t2", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [t1, t2],
      historiesByTaskId: new Map([["t1", []], ["t2", []]]),
      workflow: mkWorkflow({ enabled: true, unit: "points" }),
    });
    expect(out.initialTotal).toBe(3);
    expect(out.series[0]?.incompleteTaskCount).toBe(2);
  });
});

describe("computeBurndown — unit: weighted_enum", () => {
  const enumWf = mkWorkflow({
    enabled: true,
    unit: "custom_enum",
    unit_label: "size",
    preset_values: ["S", "M", "L"],
    weights: { S: 1, M: 3, L: 5 },
  });

  it("sums weights for custom_enum tasks with `weights`", () => {
    const t1 = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      estimate: "S",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const t2 = mkTask("t2", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      estimate: "L",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [t1, t2],
      historiesByTaskId: new Map([["t1", []], ["t2", []]]),
      workflow: enumWf,
    });
    expect(out.unit).toBe("weighted_enum");
    expect(out.initialTotal).toBe(6);
  });

  it("falls back to task-count when weights are absent for custom_enum", () => {
    const noWeightsWf = mkWorkflow({
      enabled: true,
      unit: "custom_enum",
      unit_label: "size",
      preset_values: ["S", "M", "L"],
    });
    const t1 = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      estimate: "S",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [t1],
      historiesByTaskId: new Map([["t1", []]]),
      workflow: noWeightsWf,
    });
    expect(out.unit).toBe("tasks");
    expect(out.initialTotal).toBe(1);
  });
});

describe("computeBurndown — ideal line", () => {
  it("is a straight line from initialTotal to 0", () => {
    const t1 = mkTask("t1", {
      sprint: "01HXSPRINT0000000000000001",
      status: "todo",
      created_at: "2026-05-03T10:00:00.000Z",
    });
    const out = computeBurndown({
      sprint: mkSprint(),
      tasks: [t1],
      historiesByTaskId: new Map([["t1", []]]),
      workflow: mkWorkflow(),
    });
    expect(out.ideal[0]?.remaining).toBe(1);
    expect(out.ideal[out.ideal.length - 1]?.remaining).toBe(0);
    // Mid-window value should be linear: with 5 days, day 2 (index
    // 2) should be 1 * (1 - 2/4) = 0.5.
    expect(out.ideal[2]?.remaining).toBeCloseTo(0.5, 5);
  });
});
