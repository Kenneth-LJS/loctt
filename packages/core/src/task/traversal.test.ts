import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task, WorkflowConfig } from "@loctt/contracts";
import { writeTask } from "./io.js";
import { validateRelationships, getRelatedTasks, buildTree, getChildren, getParent } from "./traversal.js";

const config: WorkflowConfig = {
  key: { prefix: "T-" },
  statuses: [{ key: "open", label: "Open", category: "pending" }],
  priorities: [],
  task_types: [{ key: "task", label: "Task" }],
  relationships: [
    { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", structural: true },
    { key: "blocks", label: "Blocks", inverse: "is_blocked_by", inverse_label: "Is blocked by" },
  ],
  custom_fields: [],
};

function makeTask(id: string, key: string, rels?: Task["frontmatter"]["relationships"]): Task {
  return {
    frontmatter: {
      id,
      key,
      title: `Task ${key}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...(rels ? { relationships: rels } : {}),
    },
    body: "",
  };
}

describe("validateRelationships", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-trav-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  it("returns no errors for valid relationships", async () => {
    const t1 = makeTask("aaa", "T-1", [{ type: "parent", target: "bbb" }]);
    const t2 = makeTask("bbb", "T-2");
    await writeTask(locttDir, "aaa", t1);
    await writeTask(locttDir, "bbb", t2);

    const errors = await validateRelationships(locttDir, config);
    expect(errors).toEqual([]);
  });

  it("reports unknown relationship type", async () => {
    const t1 = makeTask("aaa", "T-1", [{ type: "depends_on", target: "bbb" }]);
    const t2 = makeTask("bbb", "T-2");
    await writeTask(locttDir, "aaa", t1);
    await writeTask(locttDir, "bbb", t2);

    const errors = await validateRelationships(locttDir, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("unknown relationship type");
  });

  it("reports missing target", async () => {
    const t1 = makeTask("aaa", "T-1", [{ type: "parent", target: "nonexistent" }]);
    await writeTask(locttDir, "aaa", t1);

    const errors = await validateRelationships(locttDir, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("does not exist");
  });
});

describe("getRelatedTasks", () => {
  it("returns targets for a given relationship type", () => {
    const task = makeTask("aaa", "T-1", [
      { type: "parent", target: "bbb" },
      { type: "blocks", target: "ccc" },
      { type: "parent", target: "ddd" },
    ]);
    expect(getRelatedTasks(task, "parent")).toEqual(["bbb", "ddd"]);
    expect(getRelatedTasks(task, "blocks")).toEqual(["ccc"]);
  });

  it("returns empty for no matching relationships", () => {
    const task = makeTask("aaa", "T-1");
    expect(getRelatedTasks(task, "parent")).toEqual([]);
  });
});

describe("buildTree", () => {
  it("builds parent-child tree", () => {
    const tasks = [
      makeTask("root", "T-1"),
      makeTask("child1", "T-2", [{ type: "parent", target: "root" }]),
      makeTask("child2", "T-3", [{ type: "parent", target: "root" }]),
    ];

    const tree = buildTree(tasks);
    expect(tree.get("")).toEqual(["root"]);
    expect(tree.get("root")?.sort()).toEqual(["child1", "child2"]);
  });
});

describe("getChildren / getParent", () => {
  const tasks = [
    makeTask("root", "T-1"),
    makeTask("child1", "T-2", [{ type: "parent", target: "root" }]),
    makeTask("child2", "T-3", [{ type: "parent", target: "root" }]),
  ];

  it("getChildren returns child tasks", () => {
    const children = getChildren(tasks, "root", config);
    const ids = children.map(c => c.frontmatter.id).sort();
    expect(ids).toEqual(["child1", "child2"]);
  });

  it("getParent returns the parent task", () => {
    const parent = getParent(tasks, "child1", config);
    expect(parent?.frontmatter.id).toBe("root");
  });

  it("getParent returns undefined for root tasks", () => {
    const parent = getParent(tasks, "root", config);
    expect(parent).toBeUndefined();
  });
});
