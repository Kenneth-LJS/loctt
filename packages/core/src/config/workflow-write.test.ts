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

describe("saveWorkflowConfig — symmetric round-trip", () => {
  it("round-trips a symmetric relationship through save + load", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    // Replace `relates_to` (already symmetric in the seeded default) with
    // a different symmetric rel to exercise the writer.
    const withSym: WorkflowConfig = {
      ...wf,
      relationships: [
        ...wf.relationships.filter(r => r.key !== "relates_to"),
        { key: "siblings", label: "Siblings", kind: "symmetric", structural: true },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withSym);
    const reloaded = await loadWorkflowConfig(locttDir);
    const sym = reloaded.relationships.find(r => r.key === "siblings");
    expect(sym).toBeDefined();
    expect(sym?.kind).toBe("symmetric");
    expect(sym?.inverse).toBeUndefined();
    expect(sym?.inverse_label).toBeUndefined();
    expect(sym?.structural).toBe(true);
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

describe("applyWorkflowEdit — list-view pruning", () => {
  it("prunes list-view.yaml entries that reference a deleted custom field", async () => {
    // Start with a custom field declared and a list-view.yaml that
    // references it.
    const wf = await loadWorkflowConfig(locttDir);
    const withField: WorkflowConfig = {
      ...wf,
      custom_fields: [
        ...wf.custom_fields,
        { key: "severity", label: "Severity", type: "string", multi: false, searchable: false },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withField);
    const { saveListViewConfig, loadListViewConfig } = await import("./list-view.js");
    await saveListViewConfig(locttDir, {
      filters: { visible: ["status", "severity"], hidden: ["type"] },
    });

    // Now drop the custom field via applyWorkflowEdit.
    const next: WorkflowConfig = {
      ...withField,
      custom_fields: withField.custom_fields.filter(f => f.key !== "severity"),
    };
    await applyWorkflowEdit(locttDir, next);

    // The list-view config should have lost its `severity` entry but
    // retained the built-in ones.
    const lv = await loadListViewConfig(locttDir);
    expect(lv.filters?.visible).toEqual(["status"]);
    expect(lv.filters?.hidden).toEqual(["type"]);
  });

  it("leaves list-view.yaml unchanged when no custom fields are deleted", async () => {
    const { saveListViewConfig, loadListViewConfig } = await import("./list-view.js");
    await saveListViewConfig(locttDir, {
      filters: { visible: ["status", "priority"] },
    });
    const before = await loadListViewConfig(locttDir);
    const wf = await loadWorkflowConfig(locttDir);
    // No-op edit: rewrite the same config.
    await applyWorkflowEdit(locttDir, wf);
    const after = await loadListViewConfig(locttDir);
    expect(after).toEqual(before);
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

/**
 * Helper: seed a single task whose frontmatter has the given field set
 * to the given value, bypassing setField so we can inject values
 * regardless of current workflow validation. Used to stage tasks that
 * will exercise the remap path.
 */
async function seedTaskWithField(
  field: "priority" | "task_type",
  value: string,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const created = await createTask({
      locttDir, state,
      options: { project: "task", title: "T" },
    });
    await saveState(locttDir, state);
    const { writeTask } = await import("../task/io.js");
    await writeTask(locttDir, created.frontmatter.id, {
      ...created,
      frontmatter: { ...created.frontmatter, [field]: value },
    });
  });
}

describe("applyWorkflowEdit — priorities", () => {
  // Mirrors the status-mutation suite. The implementation routes
  // status/priority/task_type through one shared helper
  // (applyScalarRemap), so a regression in any of them surfaces here.

  it("rewrites tasks when a priority is removed and remap supplied", async () => {
    await seedTaskWithField("priority", "high");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      priorities: wf.priorities.filter(p => p.key !== "high"),
    };
    const result = await applyWorkflowEdit(locttDir, next, {
      priorities: { high: "medium" },
    });
    expect(result.rewrittenTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.priority).toBe("medium");
  });

  it("clears priority when remap target is null", async () => {
    await seedTaskWithField("priority", "high");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      priorities: wf.priorities.filter(p => p.key !== "high"),
    };
    await applyWorkflowEdit(locttDir, next, { priorities: { high: null } });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.priority).toBeUndefined();
  });

  it("rejects deletion of in-use priority without remap", async () => {
    await seedTaskWithField("priority", "high");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      priorities: wf.priorities.filter(p => p.key !== "high"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {})).rejects.toThrow(/in use/);
  });

  it("rejects priority remap targeting a key not in the new config", async () => {
    await seedTaskWithField("priority", "high");
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      priorities: wf.priorities.filter(p => p.key !== "high"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {
      priorities: { high: "nonexistent" },
    })).rejects.toThrow(/not present in the new config/);
  });

  it("permits silent deletion of unused priorities", async () => {
    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      priorities: wf.priorities.filter(p => p.key !== "low"),
    };
    const result = await applyWorkflowEdit(locttDir, next);
    expect(result.rewrittenTaskCount).toBe(0);
  });
});

describe("applyWorkflowEdit — task_types", () => {
  it("rewrites tasks when a task_type is removed and remap supplied", async () => {
    // The default workflow has only one task_type (`task`), so we
    // first add a second type to delete it later.
    const wf0 = await loadWorkflowConfig(locttDir);
    const withBug: WorkflowConfig = {
      ...wf0,
      task_types: [...wf0.task_types, { key: "bug", label: "Bug" }],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withBug);

    await seedTaskWithField("task_type", "bug");

    const next: WorkflowConfig = {
      ...withBug,
      task_types: withBug.task_types.filter(t => t.key !== "bug"),
    };
    const result = await applyWorkflowEdit(locttDir, next, {
      task_types: { bug: "task" },
    });
    expect(result.rewrittenTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.task_type).toBe("task");
  });

  it("clears task_type when remap target is null", async () => {
    const wf0 = await loadWorkflowConfig(locttDir);
    const withBug: WorkflowConfig = {
      ...wf0,
      task_types: [...wf0.task_types, { key: "bug", label: "Bug" }],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withBug);
    await seedTaskWithField("task_type", "bug");

    const next: WorkflowConfig = {
      ...withBug,
      task_types: withBug.task_types.filter(t => t.key !== "bug"),
    };
    await applyWorkflowEdit(locttDir, next, { task_types: { bug: null } });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.task_type).toBeUndefined();
  });

  it("rejects deletion of in-use task_type without remap", async () => {
    const wf0 = await loadWorkflowConfig(locttDir);
    const withBug: WorkflowConfig = {
      ...wf0,
      task_types: [...wf0.task_types, { key: "bug", label: "Bug" }],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withBug);
    await seedTaskWithField("task_type", "bug");

    const next: WorkflowConfig = {
      ...withBug,
      task_types: withBug.task_types.filter(t => t.key !== "bug"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {})).rejects.toThrow(/in use/);
  });

  it("rejects task_type remap targeting a key not in the new config", async () => {
    const wf0 = await loadWorkflowConfig(locttDir);
    const withBug: WorkflowConfig = {
      ...wf0,
      task_types: [...wf0.task_types, { key: "bug", label: "Bug" }],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withBug);
    await seedTaskWithField("task_type", "bug");

    const next: WorkflowConfig = {
      ...withBug,
      task_types: withBug.task_types.filter(t => t.key !== "bug"),
    };
    await expect(applyWorkflowEdit(locttDir, next, {
      task_types: { bug: "nonexistent" },
    })).rejects.toThrow(/not present in the new config/);
  });
});

describe("applyWorkflowEdit — custom field enum values", () => {
  // The most complex remap path: an enum value (not the whole field)
  // is deleted from `custom_fields[].values`, and tasks referencing
  // that value must be remapped or cleared.

  async function setupSeverityField(): Promise<void> {
    const wf = await loadWorkflowConfig(locttDir);
    const withField: WorkflowConfig = {
      ...wf,
      custom_fields: [
        ...wf.custom_fields,
        {
          key: "severity",
          label: "Severity",
          type: "enum",
          multi: false,
          searchable: false,
          values: [
            { key: "low", label: "Low" },
            { key: "medium", label: "Medium" },
            { key: "high", label: "High" },
          ],
        },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withField);
  }

  async function seedTaskWithCustomField(
    fieldKey: string,
    value: string | string[],
  ): Promise<void> {
    await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const created = await createTask({
        locttDir, state,
        options: { project: "task", title: "T" },
      });
      await saveState(locttDir, state);
      const { writeTask } = await import("../task/io.js");
      await writeTask(locttDir, created.frontmatter.id, {
        ...created,
        frontmatter: {
          ...created.frontmatter,
          fields: { [fieldKey]: value },
        },
      });
    });
  }

  it("remaps a single-valued enum field when a value is removed with target", async () => {
    await setupSeverityField();
    await seedTaskWithCustomField("severity", "high");

    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      custom_fields: wf.custom_fields.map(f =>
        f.key === "severity"
          ? { ...f, values: f.values?.filter(v => v.key !== "high") }
          : f,
      ),
    };
    const result = await applyWorkflowEdit(locttDir, next, {
      custom_fields: { severity: { high: "medium" } },
    });
    expect(result.rewrittenTaskCount).toBe(1);
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.fields?.["severity"]).toBe("medium");
  });

  it("clears a single-valued enum field when remap target is null", async () => {
    await setupSeverityField();
    await seedTaskWithCustomField("severity", "high");

    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      custom_fields: wf.custom_fields.map(f =>
        f.key === "severity"
          ? { ...f, values: f.values?.filter(v => v.key !== "high") }
          : f,
      ),
    };
    await applyWorkflowEdit(locttDir, next, {
      custom_fields: { severity: { high: null } },
    });
    const tasks = await loadAllTasks(locttDir);
    // Field is fully dropped when the only value clears.
    expect(tasks[0]?.frontmatter.fields?.["severity"]).toBeUndefined();
  });

  it("rejects deletion of an in-use enum value without remap", async () => {
    await setupSeverityField();
    await seedTaskWithCustomField("severity", "high");

    const wf = await loadWorkflowConfig(locttDir);
    const next: WorkflowConfig = {
      ...wf,
      custom_fields: wf.custom_fields.map(f =>
        f.key === "severity"
          ? { ...f, values: f.values?.filter(v => v.key !== "high") }
          : f,
      ),
    };
    await expect(applyWorkflowEdit(locttDir, next, {})).rejects.toThrow(/in use/);
  });

  it("remaps individual values inside a multi-enum field", async () => {
    // Configure severity as multi, then put two values on the task,
    // remap one of them, verify the array survives with the new value.
    const wf0 = await loadWorkflowConfig(locttDir);
    const withMulti: WorkflowConfig = {
      ...wf0,
      custom_fields: [
        ...wf0.custom_fields,
        {
          key: "tags",
          label: "Tags",
          type: "enum",
          multi: true,
          searchable: false,
          values: [
            { key: "a", label: "A" },
            { key: "b", label: "B" },
            { key: "c", label: "C" },
          ],
        },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withMulti);
    await seedTaskWithCustomField("tags", ["a", "b"]);

    const next: WorkflowConfig = {
      ...withMulti,
      custom_fields: withMulti.custom_fields.map(f =>
        f.key === "tags"
          ? { ...f, values: f.values?.filter(v => v.key !== "a") }
          : f,
      ),
    };
    await applyWorkflowEdit(locttDir, next, {
      custom_fields: { tags: { a: "c" } },
    });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.fields?.["tags"]).toEqual(["c", "b"]);
  });

  it("drops individual values inside a multi-enum field when remap is null", async () => {
    const wf0 = await loadWorkflowConfig(locttDir);
    const withMulti: WorkflowConfig = {
      ...wf0,
      custom_fields: [
        ...wf0.custom_fields,
        {
          key: "tags",
          label: "Tags",
          type: "enum",
          multi: true,
          searchable: false,
          values: [
            { key: "a", label: "A" },
            { key: "b", label: "B" },
          ],
        },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withMulti);
    await seedTaskWithCustomField("tags", ["a", "b"]);

    const next: WorkflowConfig = {
      ...withMulti,
      custom_fields: withMulti.custom_fields.map(f =>
        f.key === "tags"
          ? { ...f, values: f.values?.filter(v => v.key !== "a") }
          : f,
      ),
    };
    await applyWorkflowEdit(locttDir, next, {
      custom_fields: { tags: { a: null } },
    });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.fields?.["tags"]).toEqual(["b"]);
  });

  it("rejects a type change from number to string when existing data is incompatible", async () => {
    // Add a number field, put 42 on a task, then try to change the
    // type to string. The existing 42 isn't a string, so the edit
    // must reject with a pointer to the task that's blocking it.
    const wf0 = await loadWorkflowConfig(locttDir);
    const withScore: WorkflowConfig = {
      ...wf0,
      custom_fields: [
        ...wf0.custom_fields,
        { key: "score", label: "Score", type: "number", multi: false, searchable: false },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withScore);
    await seedTaskWithCustomField("score", 42 as unknown as string);

    const next: WorkflowConfig = {
      ...withScore,
      custom_fields: withScore.custom_fields.map(f =>
        f.key === "score" ? { ...f, type: "string" as const } : f,
      ),
    };
    await expect(applyWorkflowEdit(locttDir, next)).rejects.toThrow(
      /custom_fields\.score type change to string is incompatible/,
    );
  });

  it("allows a type change from number to string when no task carries data", async () => {
    // Empty trackers should be able to evolve schemas freely.
    const wf0 = await loadWorkflowConfig(locttDir);
    const withScore: WorkflowConfig = {
      ...wf0,
      custom_fields: [
        ...wf0.custom_fields,
        { key: "score", label: "Score", type: "number", multi: false, searchable: false },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withScore);

    const next: WorkflowConfig = {
      ...withScore,
      custom_fields: withScore.custom_fields.map(f =>
        f.key === "score" ? { ...f, type: "string" as const } : f,
      ),
    };
    await expect(applyWorkflowEdit(locttDir, next)).resolves.toBeDefined();
  });

  it("rejects flipping multi:false to multi:true when existing data isn't an array", async () => {
    const wf0 = await loadWorkflowConfig(locttDir);
    const withTags: WorkflowConfig = {
      ...wf0,
      custom_fields: [
        ...wf0.custom_fields,
        { key: "tag", label: "Tag", type: "string", multi: false, searchable: false },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withTags);
    await seedTaskWithCustomField("tag", "hello");

    const next: WorkflowConfig = {
      ...withTags,
      custom_fields: withTags.custom_fields.map(f =>
        f.key === "tag" ? { ...f, multi: true } : f,
      ),
    };
    await expect(applyWorkflowEdit(locttDir, next)).rejects.toThrow(/incompatible/);
  });

  it("allows flipping multi:false to multi:true when the existing scalar happens to satisfy the predicate as a length-1 wrap (still rejected — no auto-wrap)", async () => {
    // Pin the policy: we DO NOT auto-wrap scalars into single-element
    // arrays when the multi flag flips. The user has to decide. If
    // this changes, update the test alongside the behavior.
    const wf0 = await loadWorkflowConfig(locttDir);
    const withTags: WorkflowConfig = {
      ...wf0,
      custom_fields: [
        ...wf0.custom_fields,
        { key: "tag", label: "Tag", type: "string", multi: false, searchable: false },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withTags);
    await seedTaskWithCustomField("tag", "hello");

    const next: WorkflowConfig = {
      ...withTags,
      custom_fields: withTags.custom_fields.map(f =>
        f.key === "tag" ? { ...f, multi: true } : f,
      ),
    };
    await expect(applyWorkflowEdit(locttDir, next)).rejects.toThrow();
  });

  it("drops the whole field when the only remaining multi value is dropped", async () => {
    // Edge case: a multi-enum with one value, that value gets remapped
    // to null. The field should disappear entirely (not be left as []).
    const wf0 = await loadWorkflowConfig(locttDir);
    const withMulti: WorkflowConfig = {
      ...wf0,
      custom_fields: [
        ...wf0.custom_fields,
        {
          key: "tags",
          label: "Tags",
          type: "enum",
          multi: true,
          searchable: false,
          values: [{ key: "a", label: "A" }],
        },
      ],
    };
    const { saveWorkflowConfig } = await import("./workflow-write.js");
    await saveWorkflowConfig(locttDir, withMulti);
    await seedTaskWithCustomField("tags", ["a"]);

    const next: WorkflowConfig = {
      ...withMulti,
      custom_fields: withMulti.custom_fields.map(f =>
        f.key === "tags" ? { ...f, values: [] } : f,
      ),
    };
    await applyWorkflowEdit(locttDir, next, {
      custom_fields: { tags: { a: null } },
    });
    const tasks = await loadAllTasks(locttDir);
    expect(tasks[0]?.frontmatter.fields?.["tags"]).toBeUndefined();
  });
});
