import type {
  MilestoneDef,
  SprintDef,
  TaskFrontmatterPublic,
  TimelineGrouping,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { RowLookups } from "./rows.ts";
import { buildRows, isScheduled, totalRows } from "./rows.ts";

/**
 * Row grouping (TML-5 through TML-8).
 *
 * The load-bearing assertion in this file is the one that runs every
 * grouping over the same task set and demands an identical row count
 * (TML-7's last bullet). A grouping that quietly drops tasks with no
 * milestone passes every other test here.
 */

function task(over: Partial<TaskFrontmatterPublic> & { id: string }): TaskFrontmatterPublic {
  return {
    key: `T-${over.id}`,
    title: `Task ${over.id}`,
    status: "backlog",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as TaskFrontmatterPublic;
}

const milestones: MilestoneDef[] = [
  { id: "m1", name: "Alpha Release" },
  { id: "m2", name: "Beta Release" },
];

const sprints: SprintDef[] = [
  // Deliberately out of start-date order: TML-7 wants them ordered by
  // start date, and trusting the file's order would pass only by luck.
  { id: "s2", name: "Sprint 2", start_date: "2026-03-15", end_date: "2026-03-28", state: "future" },
  { id: "s1", name: "Sprint 1", start_date: "2026-03-01", end_date: "2026-03-14", state: "active" },
];

const users: UserProfile[] = [
  { id: "u1", name: "Ada Lovelace", timezone: "UTC" },
  { id: "u2", name: "Grace Hopper", timezone: "UTC", archived: true },
];

const workflow = {
  statuses: [
    { key: "backlog", label: "Backlog", category: "pending" },
    { key: "in_progress", label: "In Progress", category: "active" },
    { key: "done", label: "Done", category: "done" },
  ],
  relationships: [],
} as unknown as WorkflowConfig;

const lookups: RowLookups = { workflow, milestones, sprints, users };

/** A mixed set: every grouping dimension present and absent. */
const tasks: TaskFrontmatterPublic[] = [
  task({ id: "1", start_date: "2026-03-02", due_date: "2026-03-06", milestone: "m1", sprint: "s1", assignee: "u1", status: "in_progress" }),
  task({ id: "2", start_date: "2026-03-03", due_date: "2026-03-04", milestone: "m2", sprint: "s2", assignee: "u2", status: "done" }),
  task({ id: "3", start_date: "2026-03-05", due_date: "2026-03-09", status: "backlog" }),
  // Unscheduled: neither date, only start, only due.
  task({ id: "4" }),
  task({ id: "5", start_date: "2026-03-01" }),
  task({ id: "6", due_date: "2026-03-08" }),
];

describe("isScheduled", () => {
  // @verifies TML-5
  it("requires BOTH dates — only-start and only-due are unscheduled", () => {
    expect(isScheduled(task({ id: "a", start_date: "2026-03-01", due_date: "2026-03-02" }))).toBe(true);
    expect(isScheduled(task({ id: "b" }))).toBe(false);
    expect(isScheduled(task({ id: "c", start_date: "2026-03-01" }))).toBe(false);
    expect(isScheduled(task({ id: "d", due_date: "2026-03-02" }))).toBe(false);
  });

  // @verifies TML-5
  it("treats an unparseable date as no date rather than as scheduled", () => {
    // A bar drawn from a NaN offset renders at `left: NaNpx`.
    expect(isScheduled(task({ id: "e", start_date: "2026-03-01", due_date: "rubbish" }))).toBe(false);
  });
});

describe("buildRows — the Unscheduled lane", () => {
  // @verifies TML-5
  it("collects all three undated shapes into the lane with an honest count", () => {
    const model = buildRows(tasks, "none", lookups);
    expect(model.unscheduled).toHaveLength(3);
    expect(model.unscheduled.map(r => r.task.id).sort()).toEqual(["4", "5", "6"]);
    // No bar is drawn for them.
    expect(model.unscheduled.every(r => !r.scheduled)).toBe(true);
  });

  // @verifies TML-5
  it("is empty, not a blank row, when every task has both dates", () => {
    const model = buildRows(tasks.slice(0, 3), "none", lookups);
    expect(model.unscheduled).toHaveLength(0);
  });
});

describe("buildRows — grouping", () => {
  // @verifies TML-8
  it("puts every task in one flat lane when grouping is none", () => {
    const model = buildRows(tasks, "none", lookups);
    expect(model.bands).toHaveLength(1);
    expect(model.bands[0]?.rows).toHaveLength(3);
  });

  // @verifies TML-6
  it("bands by milestone using display names, not slugs, with an explicit No milestone band", () => {
    const model = buildRows(tasks, "milestone", lookups);
    expect(model.bands.map(b => b.label)).toEqual(["Alpha Release", "Beta Release", "No milestone"]);
    // Never the id.
    expect(model.bands.map(b => b.label)).not.toContain("m1");
  });

  // @verifies TML-6
  it("emits no band for a milestone with no tasks in scope", () => {
    // TML-6: "one band per milestone THAT HAS TASKS IN SCOPE".
    const model = buildRows([tasks[0] as TaskFrontmatterPublic], "milestone", lookups);
    expect(model.bands.map(b => b.label)).toEqual(["Alpha Release"]);
  });

  // @verifies TML-6
  it("counts rows per band to match the rows inside it", () => {
    const model = buildRows(tasks, "milestone", lookups);
    for (const band of model.bands) {
      expect(band.rows.length).toBeGreaterThan(0);
    }
    expect(model.bands.reduce((n, b) => n + b.rows.length, 0)).toBe(3);
  });

  // @verifies TML-7
  it("bands by assignee with display names, an (archived) suffix, and an Unassigned band", () => {
    const model = buildRows(tasks, "assignee", lookups);
    expect(model.bands.map(b => b.label)).toEqual([
      "Ada Lovelace",
      "Grace Hopper (archived)",
      "Unassigned",
    ]);
  });

  // @verifies TML-7
  it("bands by status using labels in declaration order, never keys", () => {
    const model = buildRows(tasks, "status", lookups);
    // Declaration order is backlog, in_progress, done — NOT the order
    // the tasks happen to appear in, and not alphabetical.
    expect(model.bands.map(b => b.label)).toEqual(["Backlog", "In Progress", "Done"]);
    expect(model.bands.map(b => b.id)).toEqual(["backlog", "in_progress", "done"]);
  });

  // @verifies TML-7
  it("orders sprint bands by start date, not by file order", () => {
    const model = buildRows(tasks, "sprint", lookups);
    // sprints.yaml lists Sprint 2 first; start_date order is 1 then 2.
    expect(model.bands.map(b => b.label)).toEqual(["Sprint 1", "Sprint 2", "No sprint"]);
  });

  // @verifies TML-7
  it("shows the same tasks under every grouping — identical total row count", () => {
    // TML-7's last bullet, and the reason the fallback bands exist.
    const groupings: TimelineGrouping[] = ["none", "milestone", "assignee", "status", "sprint"];
    const totals = groupings.map(g => totalRows(buildRows(tasks, g, lookups)));
    expect(new Set(totals).size).toBe(1);
    expect(totals[0]).toBe(tasks.length);
  });

  // @verifies TML-7
  it("keeps a task whose group value names something the config dropped", () => {
    // A milestone id that milestones.yaml no longer defines. Dropping
    // the row would hide a task from the user and break the count.
    const orphan = task({ id: "9", start_date: "2026-03-02", due_date: "2026-03-03", milestone: "gone" });
    const model = buildRows([orphan], "milestone", lookups);
    expect(totalRows(model)).toBe(1);
    expect(model.bands.map(b => b.id)).toContain("gone");
  });

  it("puts the absent-value band last, after the named ones", () => {
    const model = buildRows(tasks, "milestone", lookups);
    expect(model.bands[model.bands.length - 1]?.id).toBe("__none__");
  });
});
