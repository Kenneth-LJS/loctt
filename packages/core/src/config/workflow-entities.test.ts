import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState, withStateLock } from "../state/index.js";
import { createTask } from "../task/create.js";
import { loadAllTasks } from "../task/load-all.js";
import { linkTask } from "../task/relationships.js";
import { setField } from "../task/update.js";
import { loadWorkflowConfig } from "./workflow.js";
import {
  addFieldValue,
  createBoardColumn,
  createCustomField,
  createPriority,
  createRelationship,
  createStatus,
  createTaskType,
  deleteCustomField,
  deleteFieldValue,
  deletePriority,
  deleteRelationship,
  deleteStatus,
  deleteTaskType,
  editCustomField,
  editEstimationConfig,
  editFieldValue,
  editPriority,
  editStatus,
  editTimelineConfig,
  reorderPriorities,
  WorkflowEntityError,
} from "./workflow-entities.js";

let root: string;
let locttDir: string;
let projectId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loctt-wf-ent-"));
  await initLoctt(root, { docs: false });
  locttDir = resolveLocttDir(root);
  const { loadProjectsConfig } = await import("./projects.js");
  const cfg = await loadProjectsConfig(locttDir);
  projectId = cfg.projects[0]?.id as string;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Creates a task, returning its id. */
async function makeTask(
  opts: { status?: string; priority?: string; task_type?: string } = {},
): Promise<string> {
  return withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const task = await createTask({
      locttDir, state,
      options: { project: projectId, title: "T", ...opts },
    });
    await saveState(locttDir, state);
    return task.frontmatter.id;
  });
}

async function taskById(id: string) {
  const tasks = await loadAllTasks(locttDir);
  const t = tasks.find(t => t.frontmatter.id === id);
  if (!t) throw new Error(`task ${id} not found`);
  return t;
}

// ---------------------------------------------------------------------------
// Happy create / edit
// ---------------------------------------------------------------------------

describe("create/edit happy paths", () => {
  it("createStatus appends a status with icon/color and persists them", async () => {
    await createStatus(locttDir, {
      key: "in_review", label: "In review", category: "active",
      icon: "eye", color: "#00ff00",
    });
    const cfg = await loadWorkflowConfig(locttDir);
    const added = cfg.statuses.find(s => s.key === "in_review");
    expect(added).toMatchObject({ key: "in_review", label: "In review", category: "active", icon: "eye", color: "#00ff00" });
  });

  it("editStatus changes the label but leaves the key untouched", async () => {
    await editStatus(locttDir, "backlog", { label: "Icebox" });
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.find(s => s.key === "backlog")?.label).toBe("Icebox");
  });

  it("createStatus with default clears the prior default (exactly-one invariant)", async () => {
    await createStatus(locttDir, { key: "triage", label: "Triage", category: "pending", default: true });
    const cfg = await loadWorkflowConfig(locttDir);
    const defaults = cfg.statuses.filter(s => s.default === true);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.key).toBe("triage");
  });
});

// ---------------------------------------------------------------------------
// Key immutability — edit has NO path to change the key
// ---------------------------------------------------------------------------

describe("key immutability", () => {
  it("editStatus type has no `key` field, and a stray key is ignored", async () => {
    // The interface offers no `key`; passing one through an `as any` must
    // not rename anything — the function keys off the arg, not the change.
    await editStatus(locttDir, "backlog", { key: "renamed", label: "X" } as never);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.some(s => s.key === "backlog")).toBe(true);
    expect(cfg.statuses.some(s => s.key === "renamed")).toBe(false);
  });

  it("editCustomField cannot change type or multi (SET-16)", async () => {
    await createCustomField(locttDir, {
      key: "size", label: "Size", type: "string", multi: false, searchable: true,
    });
    // Even if a caller smuggles type/multi in, the field keeps its shape.
    await editCustomField(locttDir, "size", { type: "number", multi: true, label: "Sz" } as never);
    const cfg = await loadWorkflowConfig(locttDir);
    const f = cfg.custom_fields.find(f => f.key === "size");
    expect(f?.type).toBe("string");
    expect(f?.multi).toBe(false);
    expect(f?.label).toBe("Sz");
  });
});

// ---------------------------------------------------------------------------
// Priority value: never settable, recomputed on reorder (D20)
// ---------------------------------------------------------------------------

describe("priority value is derived, never set", () => {
  it("createPriority ignores any value and lands renumbered 1..N in list order", async () => {
    // The input type has no `value`. New priority lands at the bottom, and
    // renumberPriorities recomputes value = index+1 across the whole list.
    await createPriority(locttDir, { key: "trivial", label: "Trivial" });
    const cfg = await loadWorkflowConfig(locttDir);
    const values = cfg.priorities.map(p => p.value);
    expect(values).toEqual([1, 2, 3, 4, 5]);
    expect(cfg.priorities.at(-1)?.key).toBe("trivial");
  });

  it("reorderPriorities recomputes value by the new order (value = list index+1, D20)", async () => {
    const before = await loadWorkflowConfig(locttDir);
    const keys = before.priorities.map(p => p.key); // critical, high, medium, low
    // Reverse the order.
    await reorderPriorities(locttDir, [...keys].reverse());
    const after = await loadWorkflowConfig(locttDir);
    expect(after.priorities.map(p => p.key)).toEqual([...keys].reverse());
    // Renumbered in the new list order.
    expect(after.priorities.map(p => p.value)).toEqual([1, 2, 3, 4]);
    // 'low' is now first → value 1; 'critical' now last → value 4.
    expect(after.priorities.find(p => p.key === "low")?.value).toBe(1);
    expect(after.priorities.find(p => p.key === "critical")?.value).toBe(4);
  });

  it("editPriority does not reorder — value follows list position, unchanged by a label edit", async () => {
    // After the first write, values are renumbered 1..N by list order.
    const before = await loadWorkflowConfig(locttDir);
    const criticalIdx = before.priorities.findIndex(p => p.key === "critical");
    await editPriority(locttDir, "critical", { label: "Sev-1" });
    const after = await loadWorkflowConfig(locttDir);
    // critical stayed in its list slot, so its value is still index+1.
    expect(after.priorities.findIndex(p => p.key === "critical")).toBe(criticalIdx);
    expect(after.priorities.find(p => p.key === "critical")?.value).toBe(criticalIdx + 1);
    expect(after.priorities.find(p => p.key === "critical")?.label).toBe("Sev-1");
  });
});

// ---------------------------------------------------------------------------
// Delete-in-use: refuses without remapTo, remaps with it
// ---------------------------------------------------------------------------

describe("delete-in-use remap-or-refuse", () => {
  it("deleteStatus refuses when in use and no remapTo is given", async () => {
    await makeTask({ status: "in_progress" });
    await expect(deleteStatus(locttDir, "in_progress")).rejects.toBeInstanceOf(WorkflowEntityError);
    // And the status is still there — refusal left the config untouched.
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.some(s => s.key === "in_progress")).toBe(true);
  });

  it("deleteStatus with remapTo moves the task and removes the status", async () => {
    const id = await makeTask({ status: "in_progress" });
    await deleteStatus(locttDir, "in_progress", "backlog");
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.some(s => s.key === "in_progress")).toBe(false);
    expect((await taskById(id)).frontmatter.status).toBe("backlog");
  });

  it("deleteStatus of an UNUSED status needs no remapTo", async () => {
    // 'wont_do' unused → deletes cleanly with no target.
    await deleteStatus(locttDir, "wont_do");
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.some(s => s.key === "wont_do")).toBe(false);
  });

  it("deletePriority in use refuses without remapTo, remaps with it", async () => {
    const id = await makeTask({ priority: "critical" });
    await expect(deletePriority(locttDir, "critical")).rejects.toBeInstanceOf(WorkflowEntityError);
    await deletePriority(locttDir, "critical", "high");
    expect((await taskById(id)).frontmatter.priority).toBe("high");
  });

  it("deleteTaskType in use refuses without remapTo, remaps with it", async () => {
    const id = await makeTask({ task_type: "bug" });
    await expect(deleteTaskType(locttDir, "bug")).rejects.toBeInstanceOf(WorkflowEntityError);
    await deleteTaskType(locttDir, "bug", "task");
    expect((await taskById(id)).frontmatter.task_type).toBe("task");
  });

  it("deleteRelationship in use refuses without remapTo, clears with null", async () => {
    const a = await makeTask();
    const b = await makeTask();
    await linkTask({ locttDir, taskId: a, type: "blocks", target: b });
    await expect(deleteRelationship(locttDir, "blocks")).rejects.toBeInstanceOf(WorkflowEntityError);
    // Clear (null) drops the edges.
    await deleteRelationship(locttDir, "blocks", null);
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.relationships.some(r => r.key === "blocks")).toBe(false);
    const fm = (await taskById(a)).frontmatter;
    expect(fm.relationships?.some(r => r.type === "blocks")).not.toBe(true);
  });

  it("a remap target that must differ from the deleted key is refused", async () => {
    await makeTask({ status: "in_progress" });
    await expect(deleteStatus(locttDir, "in_progress", "in_progress"))
      .rejects.toThrow(/must differ/);
  });
});

// ---------------------------------------------------------------------------
// Custom-field enum values
// ---------------------------------------------------------------------------

describe("custom-field enum values", () => {
  async function makeEnumField(): Promise<void> {
    await createCustomField(locttDir, {
      key: "sev", label: "Severity", type: "enum", multi: false, searchable: true,
      values: [{ key: "low", label: "Low" }, { key: "high", label: "High" }],
    });
  }

  it("addFieldValue appends a value with icon/color", async () => {
    await makeEnumField();
    await addFieldValue(locttDir, "sev", { key: "crit", label: "Critical", color: "#ff0000" });
    const cfg = await loadWorkflowConfig(locttDir);
    const f = cfg.custom_fields.find(f => f.key === "sev");
    expect(f?.values?.find(v => v.key === "crit")).toMatchObject({ label: "Critical", color: "#ff0000" });
  });

  it("editFieldValue changes the label, keeps the key", async () => {
    await makeEnumField();
    await editFieldValue(locttDir, "sev", "low", { label: "Minor" });
    const cfg = await loadWorkflowConfig(locttDir);
    const f = cfg.custom_fields.find(f => f.key === "sev");
    expect(f?.values?.find(v => v.key === "low")?.label).toBe("Minor");
  });

  it("deleteFieldValue in use refuses without remapTo, remaps with it", async () => {
    await makeEnumField();
    const id = await makeTask();
    await setField({ locttDir, taskId: id, field: "sev", value: "low" });
    await expect(deleteFieldValue(locttDir, "sev", "low")).rejects.toBeInstanceOf(WorkflowEntityError);
    await deleteFieldValue(locttDir, "sev", "low", "high");
    const fm = (await taskById(id)).frontmatter;
    expect(fm.fields?.["sev"]).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Whole custom-field delete is clear-only
// ---------------------------------------------------------------------------

describe("custom-field whole delete is clear-only", () => {
  it("deleteCustomField clears the field from tasks with no remap arg", async () => {
    await createCustomField(locttDir, {
      key: "team", label: "Team", type: "string", multi: false, searchable: true,
    });
    const id = await makeTask();
    await setField({ locttDir, taskId: id, field: "team", value: "platform" });
    await deleteCustomField(locttDir, "team");
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.custom_fields.some(f => f.key === "team")).toBe(false);
    expect((await taskById(id)).frontmatter.fields?.["team"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Board columns + singletons (icon/color, scale/weights persist)
// ---------------------------------------------------------------------------

describe("board columns and singletons", () => {
  it("createBoardColumn adds a column grouping statuses", async () => {
    await createBoardColumn(locttDir, {
      key: "doing", label: "Doing", statuses: ["in_progress"], wip: 3,
    });
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.boards?.columns.find(c => c.key === "doing")).toMatchObject({ label: "Doing", statuses: ["in_progress"], wip: 3 });
  });

  it("editEstimationConfig persists scale and weights", async () => {
    await editEstimationConfig(locttDir, {
      enabled: true, unit: "custom_enum", unit_label: "T-shirt",
      preset_values: ["S", "M", "L"],
      scale: "fibonacci",
      weights: { S: 1, M: 2, L: 3 },
    });
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.estimation?.scale).toBe("fibonacci");
    expect(cfg.estimation?.weights).toEqual({ S: 1, M: 2, L: 3 });
  });

  it("editTimelineConfig writes dependency_relationship through", async () => {
    await editTimelineConfig(locttDir, { dependency_relationship: "parent", default_zoom: "month" });
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.timeline?.dependency_relationship).toBe("parent");
    expect(cfg.timeline?.default_zoom).toBe("month");
  });

  it("editTimelineConfig preserves dependency_relationship: null as explicit disable", async () => {
    await editTimelineConfig(locttDir, { dependency_relationship: null });
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.timeline?.dependency_relationship).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Atomicity: a refused edit leaves workflow.yaml unchanged
// ---------------------------------------------------------------------------

describe("atomicity of refusals", () => {
  it("a create that duplicates a key leaves the config unchanged", async () => {
    const before = await loadWorkflowConfig(locttDir);
    await expect(createStatus(locttDir, { key: "backlog", label: "Dup", category: "pending" }))
      .rejects.toBeInstanceOf(WorkflowEntityError);
    const after = await loadWorkflowConfig(locttDir);
    expect(after.statuses.length).toBe(before.statuses.length);
  });
});

// ---------------------------------------------------------------------------
// Entity-key charset (security: a malformed key writes cleanly but the
// read-side regexes reject it, producing a self-inflicted corrupt config).
// ---------------------------------------------------------------------------

describe("entity key charset validation", () => {
  it("every seeded/default key satisfies the rule", async () => {
    const cfg = await loadWorkflowConfig(locttDir);
    const rule = /^[a-z][a-z0-9_-]*$/;
    for (const s of cfg.statuses) expect(rule.test(s.key)).toBe(true);
    for (const p of cfg.priorities) expect(rule.test(p.key)).toBe(true);
    for (const t of cfg.task_types) expect(rule.test(t.key)).toBe(true);
    for (const r of cfg.relationships) {
      expect(rule.test(r.key)).toBe(true);
      if (r.inverse) expect(rule.test(r.inverse)).toBe(true);
    }
  });

  it("rejects a key with a space", async () => {
    await expect(createStatus(locttDir, { key: "in progress", label: "X", category: "active" }))
      .rejects.toThrow(/not valid/i);
  });

  it("rejects a key with a dot", async () => {
    await expect(createTaskType(locttDir, { key: "my.type", label: "X" }))
      .rejects.toThrow(/not valid/i);
  });

  it("rejects a key with a newline", async () => {
    await expect(createPriority(locttDir, { key: "bad\nkey", label: "X" }))
      .rejects.toThrow(/not valid/i);
  });

  it("rejects an uppercase key", async () => {
    await expect(createStatus(locttDir, { key: "Blocked", label: "X", category: "active" }))
      .rejects.toThrow(/not valid/i);
  });

  it("rejects a key that starts with a digit", async () => {
    await expect(createStatus(locttDir, { key: "1st", label: "X", category: "active" }))
      .rejects.toThrow(/not valid/i);
  });

  it("accepts a valid key (lowercase, digits, underscore, hyphen)", async () => {
    await createStatus(locttDir, { key: "in_review-2", label: "In review", category: "active" });
    const cfg = await loadWorkflowConfig(locttDir);
    expect(cfg.statuses.some(s => s.key === "in_review-2")).toBe(true);
  });

  it("rejects a malformed enum field value key", async () => {
    await createCustomField(locttDir, {
      key: "sev", label: "Severity", type: "enum", multi: false, searchable: false,
      values: [{ key: "low", label: "Low" }],
    });
    await expect(addFieldValue(locttDir, "sev", { key: "very high", label: "Very high" }))
      .rejects.toThrow(/not valid/i);
  });

  it("rejects a malformed board column key", async () => {
    await expect(createBoardColumn(locttDir, { key: "To Do", label: "To Do", statuses: [] }))
      .rejects.toThrow(/not valid/i);
  });

  it("rejects a malformed relationship inverse key", async () => {
    await expect(createRelationship(locttDir, {
      key: "mirrors", label: "Mirrors", inverse: "is mirrored by", inverse_label: "Is mirrored by",
    })).rejects.toThrow(/not valid/i);
  });

  it("anchors the charset error on 'key'", async () => {
    try {
      await createStatus(locttDir, { key: "bad key", label: "X", category: "active" });
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowEntityError);
      expect((err as WorkflowEntityError).toEnvelope().field).toBe("key");
    }
  });
});
