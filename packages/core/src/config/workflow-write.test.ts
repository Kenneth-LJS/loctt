import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkflowConfig } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import { loadWorkflowConfig } from "./workflow.js";
import { applyWorkflowEdit } from "./workflow-write.js";

let root: string;
let locttDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-wf-write-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeTaskWithStatus(status: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    await createTask({
      locttDir, state,
      options: { project: "task", title: "T", status },
    });
    await saveState(locttDir, state);
  });
}

describe("applyWorkflowEdit", () => {
  it("rewrites tasks when a status is removed and remap supplied", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    const result = await applyWorkflowEdit(locttDir, next, {
      statuses: { not_started: "in_progress" },
    });
    expect(result.rewrittenTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.status).toBe("in_progress");
  });

  it("clears the field when remap target is null", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    await applyWorkflowEdit(locttDir, next, { statuses: { not_started: null } });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.status).toBeUndefined();
  });

  it("rejects deletion of in-use status without remap", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {})).rejects.toThrow(/in use/);
  });

  it("rejects remap targeting a key not in the new config", async () => {
    await makeTaskWithStatus("not_started");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "not_started"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {
      statuses: { not_started: "nonexistent" },
    })).rejects.toThrow(/not present in the new config/);
  });

  it("permits silent deletion of unused statuses", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.filter(s => s.key !== "blocked"),
    };
    const result = await applyWorkflowEdit(locttDir, next);
    expect(result.rewrittenTaskCount).toBe(0);
  });
});

describe("applyWorkflowEdit — relationships", () => {
  async function makeLinkedPair(relType: string): Promise<void> {
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: "task", title: "A" } });
      const target = await createTask({
        locttDir, state, options: { project: "task", title: "B" },
      });
      await saveState(locttDir, state);
      // Link A → relType → B directly via writeTask round-trip.
      const tasks = await loadAllTasks(locttDir);
      const a = tasks.find(t => t.frontmatter.key === "T-1");
      if (!a) throw new Error("test setup: T-1 missing");
      const { writeTask } = await import("../task/io.js");
      await writeTask(locttDir, a.frontmatter.id, {
        ...a,
        frontmatter: {
          ...a.frontmatter,
          relationships: [{ type: relType, target: target.frontmatter.id }],
        },
      });
    });
  }

  it("rewrites task relationships when a relationship key is removed with remap target", async () => {
    await makeLinkedPair("blocks");
    const wf = await loadWorkflowConfig(locttDir);
    // Add a new relationship type to remap onto.
    const next: WorkflowConfig = {
      ...wf,
      relationships: [
        ...wf.relationships.filter(r => r.key !== "blocks"),
        { key: "depends_on", label: "Depends on", inverse: "required_by", inverse_label: "Required by" },
      ],
    };
    const result = await applyWorkflowEdit(locttDir, next, {
      relationships: { blocks: "depends_on" },
    });
    expect(result.rewrittenTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    const a = tasks.find(t => t.frontmatter.key === "T-1");
    expect(a?.frontmatter.relationships?.[0]?.type).toBe("depends_on");
  });

  it("drops task relationships when remap target is null", async () => {
    await makeLinkedPair("blocks");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      relationships: wf.relationships.filter(r => r.key !== "blocks"),
    };
    await applyWorkflowEdit(locttDir, next, { relationships: { blocks: null } });
    const tasks = await loadAllTasks(locttDir);
    const a = tasks.find(t => t.frontmatter.key === "T-1");
    expect(a?.frontmatter.relationships ?? []).toEqual([]);
  });

  it("rejects deletion of an in-use relationship without remap", async () => {
    await makeLinkedPair("blocks");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      relationships: wf.relationships.filter(r => r.key !== "blocks"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {})).rejects.toThrow(/in use/);
  });

  it("rejects a relationship remap targeting a key not in the new config", async () => {
    await makeLinkedPair("blocks");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      relationships: wf.relationships.filter(r => r.key !== "blocks"),
    };
    await expect(
      applyWorkflowEdit(locttDir, next, { relationships: { blocks: "nonexistent" } }),
    ).rejects.toThrow(/not present in the new config/);
  });

  it("permits silent deletion of an unused relationship type", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      relationships: wf.relationships.filter(r => r.key !== "blocks"),
    };
    const result = await applyWorkflowEdit(locttDir, next);
    expect(result.rewrittenTaskCount).toBe(0);
  });

  it("preserves surviving edges and rewrites only the deleted type on the same task", async () => {
    // Single task with two outbound edges of different types. Delete
    // one type; the other must round-trip untouched.
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: "task", title: "A" } });
      const b = await createTask({ locttDir, state, options: { project: "task", title: "B" } });
      const c = await createTask({ locttDir, state, options: { project: "task", title: "C" } });
      await saveState(locttDir, state);
      const tasks = await loadAllTasks(locttDir);
      const a = tasks.find(t => t.frontmatter.key === "T-1");
      if (!a) throw new Error("test setup: T-1 missing");
      const { writeTask } = await import("../task/io.js");
      await writeTask(locttDir, a.frontmatter.id, {
        ...a,
        frontmatter: {
          ...a.frontmatter,
          relationships: [
            { type: "blocks", target: b.frontmatter.id },
            { type: "relates_to", target: c.frontmatter.id },
          ],
        },
      });
    });

    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      relationships: wf.relationships.filter(r => r.key !== "blocks"),
    };
    const result = await applyWorkflowEdit(locttDir, next, { relationships: { blocks: null } });
    expect(result.rewrittenTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    const a = tasks.find(t => t.frontmatter.key === "T-1");
    const rels = a?.frontmatter.relationships ?? [];
    expect(rels.length).toBe(1);
    expect(rels[0]?.type).toBe("relates_to");
  });

  it("bumps updated_at on tasks affected by a relationship-only rewrite", async () => {
    await makeLinkedPair("blocks");
    const before = await loadAllTasks(locttDir);
    const a = before.find(t => t.frontmatter.key === "T-1");
    const updatedBefore = a?.frontmatter.updated_at;
    expect(updatedBefore).toBeDefined();

    // Sleep one millisecond so the timestamp can advance.
    await new Promise(r => setTimeout(r, 5));

    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      relationships: wf.relationships.filter(r => r.key !== "blocks"),
    };
    await applyWorkflowEdit(locttDir, next, { relationships: { blocks: null } });
    const after = await loadAllTasks(locttDir);
    const a2 = after.find(t => t.frontmatter.key === "T-1");
    expect(a2?.frontmatter.updated_at).not.toBe(updatedBefore);
  });

  it("saves the new workflow.yaml on relationship-only edits", async () => {
    await makeLinkedPair("blocks");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      relationships: wf.relationships.filter(r => r.key !== "blocks"),
    };
    await applyWorkflowEdit(locttDir, next, { relationships: { blocks: null } });
    const reloaded = await loadWorkflowConfig(locttDir);
    expect(reloaded.relationships.some(r => r.key === "blocks")).toBe(false);
  });
});

describe("saveWorkflowConfig auto-clear", () => {
  it("drops timeline.dependency_relationship when the referenced key is gone", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    // First write a workflow that references `blocks` from timeline.
    const withTimeline: WorkflowConfig = {
      ...wf,
      timeline: { dependency_relationship: "blocks" },
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withTimeline);
    const reloaded = await loadWorkflowConfig(locttDir);
    expect(reloaded.timeline?.dependency_relationship).toBe("blocks");

    // Now save a workflow that removes `blocks`. The save should
    // auto-clear the dangling timeline ref in the same write.
    const withoutBlocks: WorkflowConfig = {
      ...withTimeline,
      relationships: withTimeline.relationships.filter(r => r.key !== "blocks"),
    };
    await saveWorkflowConfig(locttDir, withoutBlocks);
    const final = await loadWorkflowConfig(locttDir);
    // Field should be absent — the timeline block has nothing else, so
    // the writer drops the block entirely.
    expect(final.timeline).toBeUndefined();
  });

  it("preserves timeline.dependency_relationship when the referenced key still exists", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const withTimeline: WorkflowConfig = {
      ...wf,
      timeline: { dependency_relationship: "blocks" },
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withTimeline);
    const reloaded = await loadWorkflowConfig(locttDir);
    expect(reloaded.timeline?.dependency_relationship).toBe("blocks");
  });

  it("preserves an explicit null (arrows disabled) without auto-clear interference", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const withTimeline: WorkflowConfig = {
      ...wf,
      timeline: { dependency_relationship: null },
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withTimeline);
    const reloaded = await loadWorkflowConfig(locttDir);
    expect(reloaded.timeline?.dependency_relationship).toBeNull();
  });
});

describe("workflow serializer — icon/color/weights/boards round-trip", () => {
  it("persists icon and color on status/priority/task_type/relationship", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      statuses: wf.statuses.map((s, i) =>
        i === 0 ? { ...s, icon: "circle", color: "#1e6fcb" } : s,
      ),
      priorities: wf.priorities.map((p, i) =>
        i === 0 ? { ...p, icon: "🔥", color: "#cc0000" } : p,
      ),
      task_types: wf.task_types.map((t, i) =>
        i === 0 ? { ...t, icon: "bug" } : t,
      ),
      relationships: wf.relationships.map((r, i) =>
        i === 0 ? { ...r, color: "#ffa500" } : r,
      ),
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, next);
    const reloaded = await loadWorkflowConfig(locttDir);
    expect(reloaded.statuses[0]?.icon).toBe("circle");
    expect(reloaded.statuses[0]?.color).toBe("#1e6fcb");
    expect(reloaded.priorities[0]?.icon).toBe("🔥");
    expect(reloaded.priorities[0]?.color).toBe("#cc0000");
    expect(reloaded.task_types[0]?.icon).toBe("bug");
    expect(reloaded.task_types[0]?.color).toBeUndefined();
    expect(reloaded.relationships[0]?.color).toBe("#ffa500");
    expect(reloaded.relationships[0]?.icon).toBeUndefined();
  });

  it("persists estimation weights for custom_enum units", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      estimation: {
        enabled: true,
        unit: "custom_enum",
        unit_label: "size",
        preset_values: ["S", "M", "L"],
        weights: { S: 1, M: 3, L: 5 },
      },
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, next);
    const reloaded = await loadWorkflowConfig(locttDir);
    expect(reloaded.estimation?.weights).toEqual({ S: 1, M: 3, L: 5 });
  });

  it("persists boards config (columns with statuses and wip)", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      boards: {
        columns: [
          { key: "todo", label: "To Do", statuses: ["not_started"] },
          { key: "doing", label: "Doing", statuses: ["in_progress"], wip: 3 },
          { key: "done", label: "Done", statuses: ["done"] },
        ],
      },
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, next);
    const reloaded = await loadWorkflowConfig(locttDir);
    expect(reloaded.boards?.columns).toHaveLength(3);
    expect(reloaded.boards?.columns[1]?.wip).toBe(3);
    expect(reloaded.boards?.columns[0]?.statuses).toEqual(["not_started"]);
  });
});
