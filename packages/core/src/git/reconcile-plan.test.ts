import type { Task, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { computeTaskConflicts } from "./reconcile-plan.js";

/**
 * The classification heart (GIT-5, GIT-11, GIT-13, GIT-14, GIT-17):
 * different-key → union (auto-merged, no row); same-key-different-value →
 * conflict row; identical-both-sides → converged (auto, no row). Each is a
 * distinct assertion so a regression in one does not hide behind another.
 */

const WEB3 = "01TASKWEB30000000000000000";
const WEB2 = "01TASKWEB20000000000000000";
const WEB7 = "01TASKWEB70000000000000000";

function task(id: string, key: string, fm: Partial<Task["frontmatter"]>): Task {
  return {
    frontmatter: {
      id, key, project: "01PROJECTWEB0000000000000",
      title: `Task ${key}`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
      ...fm,
    } as Task["frontmatter"],
    body: "",
  };
}

const config: WorkflowConfig = {
  key: { prefix: "WEB-" },
  statuses: [
    { key: "todo", label: "To Do", category: "pending", default: true },
    { key: "in_progress", label: "In Progress", category: "active" },
  ],
  priorities: [],
  task_types: [],
  relationships: [
    { key: "parent", label: "Parent of", inverse: "child", inverse_label: "Child of" },
    { key: "blocks", label: "Blocks", inverse: "blocked_by", inverse_label: "Blocked by" },
  ],
  custom_fields: [
    { key: "team", label: "Team", type: "string", multi: false, searchable: false },
    { key: "story_points", label: "Points", type: "number", multi: false, searchable: false },
    {
      key: "tier", label: "Tier", type: "enum", multi: false, searchable: false,
      values: [
        { key: "gold", label: "Gold" },
        { key: "silver", label: "Silver" },
      ],
    },
  ],
} as WorkflowConfig;

const taskById = new Map<string, { key: string; title: string }>([
  [WEB2, { key: "WEB-2", title: "Parent A" }],
  [WEB7, { key: "WEB-7", title: "Parent B" }],
  [WEB3, { key: "WEB-3", title: "Task WEB-3" }],
]);

describe("computeTaskConflicts", () => {
  it("unions different custom-field keys with no conflict (GIT-5)", () => {
    // @verifies GIT-5
    const local = task(WEB3, "WEB-3", { fields: { team: "platform" } });
    const remote = task(WEB3, "WEB-3", { fields: { story_points: 5 } });
    const { conflicts, autoMerged } = computeTaskConflicts(local, remote, config, taskById);
    expect(conflicts).toHaveLength(0);
    const union = autoMerged.find(a => a.kind === "union");
    expect(union?.fields).toEqual(expect.arrayContaining(["Team", "Points"]));
  });

  it("unions different relationship edges with no conflict (GIT-5)", () => {
    // @verifies GIT-5
    const local = task(WEB3, "WEB-3", { relationships: [{ type: "blocks", target: "01T9" }] });
    const remote = task(WEB3, "WEB-3", { relationships: [{ type: "blocks", target: "01T12" }] });
    const { conflicts, autoMerged } = computeTaskConflicts(local, remote, config, taskById);
    expect(conflicts).toHaveLength(0);
    expect(autoMerged.some(a => a.kind === "union" && a.fields.includes("Relationships"))).toBe(true);
  });

  it("reports a conflict when the same custom-field key differs (GIT-11)", () => {
    // @verifies GIT-11
    const local = task(WEB3, "WEB-3", { fields: { team: "platform" } });
    const remote = task(WEB3, "WEB-3", { fields: { team: "infra" } });
    const { conflicts } = computeTaskConflicts(local, remote, config, taskById);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      field: "fields.team", fieldLabel: "Team", kind: "scalar",
      local: { display: "platform" }, remote: { display: "infra" },
    });
  });

  it("renders an enum custom field by label and offers the enum (GIT-11)", () => {
    // @verifies GIT-11
    const local = task(WEB3, "WEB-3", { fields: { tier: "gold" } });
    const remote = task(WEB3, "WEB-3", { fields: { tier: "silver" } });
    const { conflicts } = computeTaskConflicts(local, remote, config, taskById);
    expect(conflicts[0]).toMatchObject({
      field: "fields.tier", kind: "enum",
      local: { raw: "gold", display: "Gold" },
      remote: { raw: "silver", display: "Silver" },
    });
    expect(conflicts[0]?.options).toEqual([
      { key: "gold", label: "Gold" }, { key: "silver", label: "Silver" },
    ]);
  });

  it("renders a built-in status conflict by label with enum options (GIT-6)", () => {
    // @verifies GIT-6
    const local = task(WEB3, "WEB-3", { status: "todo" });
    const remote = task(WEB3, "WEB-3", { status: "in_progress" });
    const { conflicts } = computeTaskConflicts(local, remote, config, taskById);
    const status = conflicts.find(c => c.field === "status");
    expect(status).toMatchObject({
      kind: "enum", local: { display: "To Do" }, remote: { display: "In Progress" },
    });
    expect(status?.options).toEqual([
      { key: "todo", label: "To Do" }, { key: "in_progress", label: "In Progress" },
    ]);
  });

  it("does NOT report a conflict when both sides converged to the same value (GIT-17)", () => {
    // @verifies GIT-17
    const local = task(WEB3, "WEB-3", { title: "Shared new title" });
    const remote = task(WEB3, "WEB-3", { title: "Shared new title" });
    const { conflicts, autoMerged } = computeTaskConflicts(local, remote, config, taskById);
    expect(conflicts).toHaveLength(0);
    // Named so the result can still mention the task converged.
    expect(autoMerged.some(a => a.kind === "converged" && a.fields.includes("Title"))).toBe(true);
  });

  it("marks a remote status absent from local config as drift, keeping it out of options (GIT-14)", () => {
    // @verifies GIT-14
    const local = task(WEB3, "WEB-3", { status: "todo" });
    const remote = task(WEB3, "WEB-3", { status: "in_review" }); // not in config
    const { conflicts } = computeTaskConflicts(local, remote, config, taskById);
    const status = conflicts.find(c => c.field === "status");
    expect(status?.remote).toMatchObject({ raw: "in_review", display: "in_review" });
    expect(status?.remote.drift?.reason).toMatch(/in_review.*not in the local/);
    // pick-value offers only existing statuses — in_review is not among them.
    expect(status?.options?.map(o => o.key)).not.toContain("in_review");
    expect(status?.options?.map(o => o.key)).toEqual(["todo", "in_progress"]);
  });

  it("shows a parent conflict as tasks with a picker, not raw ULIDs (GIT-13)", () => {
    // @verifies GIT-13
    const local = task(WEB3, "WEB-3", { relationships: [{ type: "parent", target: WEB2 }] });
    const remote = task(WEB3, "WEB-3", { relationships: [{ type: "parent", target: WEB7 }] });
    const { conflicts } = computeTaskConflicts(local, remote, config, taskById);
    const parent = conflicts.find(c => c.field === "parent");
    expect(parent).toMatchObject({
      kind: "relationship_parent",
      local: { raw: WEB2, display: "WEB-2 · Parent A" },
      remote: { raw: WEB7, display: "WEB-7 · Parent B" },
    });
    // Picker lists tasks as key · title, and never the task itself.
    expect(parent?.options?.some(o => o.key === WEB2 && o.label === "WEB-2 · Parent A")).toBe(true);
    expect(parent?.options?.some(o => o.key === WEB3)).toBe(false);
  });
});
