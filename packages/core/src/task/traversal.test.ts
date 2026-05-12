import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Task, WorkflowConfig } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { writeTask } from "./io.js";
import { buildTree, findStructuralCycles, getChildren, getParents,getRelatedTasks, validateRelationships } from "./traversal.js";

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

describe("getChildren / getParents", () => {
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

  it("getParents returns parent tasks", () => {
    const parents = getParents(tasks, "child1", config);
    expect(parents.map(p => p.frontmatter.id)).toEqual(["root"]);
  });

  it("getParents returns empty for root tasks", () => {
    const parents = getParents(tasks, "root", config);
    expect(parents).toEqual([]);
  });

  it("getParents returns multiple parents for multi-parent tasks", () => {
    const multiParentTasks = [
      makeTask("p1", "T-1"),
      makeTask("p2", "T-2"),
      makeTask("child", "T-3", [
        { type: "parent", target: "p1" },
        { type: "parent", target: "p2" },
      ]),
    ];
    const parents = getParents(multiParentTasks, "child", config);
    expect(parents.map(p => p.frontmatter.id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("buildTree multi-parent (DAG)", () => {
  it("places a task under each parent", () => {
    const tasks = [
      makeTask("p1", "T-1"),
      makeTask("p2", "T-2"),
      makeTask("child", "T-3", [
        { type: "parent", target: "p1" },
        { type: "parent", target: "p2" },
      ]),
    ];
    const tree = buildTree(tasks);
    expect(tree.get("")).toEqual(["p1", "p2"]);
    expect(tree.get("p1")).toEqual(["child"]);
    expect(tree.get("p2")).toEqual(["child"]);
  });
});

describe("findStructuralCycles", () => {
  it("returns no cycles for an acyclic graph", () => {
    const tasks = [
      makeTask("a", "T-1"),
      makeTask("b", "T-2", [{ type: "parent", target: "a" }]),
      makeTask("c", "T-3", [{ type: "parent", target: "a" }]),
    ];
    expect(findStructuralCycles(tasks, config)).toEqual([]);
  });

  it("detects a direct two-node cycle", () => {
    const tasks = [
      makeTask("a", "T-1", [{ type: "parent", target: "b" }]),
      makeTask("b", "T-2", [{ type: "parent", target: "a" }]),
    ];
    const cycles = findStructuralCycles(tasks, config);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.relationshipKey).toBe("parent");
    expect(cycles[0]?.path).toEqual(["a", "b", "a"]);
  });

  it("detects an indirect cycle and rotates to lowest-id start", () => {
    const tasks = [
      makeTask("c", "T-3", [{ type: "parent", target: "a" }]),
      makeTask("a", "T-1", [{ type: "parent", target: "b" }]),
      makeTask("b", "T-2", [{ type: "parent", target: "c" }]),
    ];
    const cycles = findStructuralCycles(tasks, config);
    expect(cycles).toHaveLength(1);
    // Rotation normalizes the starting id to the lowest in the ring.
    expect(cycles[0]?.path[0]).toBe("a");
    expect(cycles[0]?.path).toEqual(["a", "b", "c", "a"]);
  });

  it("ignores cycles on non-structural relationships", () => {
    const tasks = [
      makeTask("a", "T-1", [{ type: "blocks", target: "b" }]),
      makeTask("b", "T-2", [{ type: "blocks", target: "a" }]),
    ];
    expect(findStructuralCycles(tasks, config)).toEqual([]);
  });

  it("does not crash on a dangling target", () => {
    const tasks = [
      makeTask("a", "T-1", [{ type: "parent", target: "ghost" }]),
    ];
    expect(findStructuralCycles(tasks, config)).toEqual([]);
  });
});
