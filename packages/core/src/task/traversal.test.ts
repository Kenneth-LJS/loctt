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
    // `blocks` is declared FIRST and is also cycle-constrained,
    // mirroring the shipped default. The old `find(r => r.structural)`
    // lookup took the first match, so this ordering is what made
    // getChildren walk blocking edges. With the axis passed explicitly
    // the ordering no longer decides anything — which is the point.
    { key: "blocks", label: "Blocks", inverse: "is_blocked_by", inverse_label: "Is blocked by", graph: "acyclic" },
    { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", graph: "tree" },
    // No graph constraint — a loop here is legitimate.
    { key: "relates_to", label: "Relates to", kind: "symmetric" },
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
    // Both sides, as `linkTask` writes them. The fixture used to carry
    // only the forward edge — a state the product never produces, and
    // one P-12 now reports, so it was asserting that a one-sided edge
    // is fine.
    const t1 = makeTask("aaa", "T-1", [{ type: "parent", target: "bbb" }]);
    const t2 = makeTask("bbb", "T-2", [{ type: "child", target: "aaa" }]);
    await writeTask(locttDir, "aaa", t1);
    await writeTask(locttDir, "bbb", t2);

    const errors = await validateRelationships(locttDir, config);
    expect(errors).toEqual([]);
  });

  it("reports a relationship whose inverse is missing on the target (P-12)", async () => {
    // A hand-edit or a `git pull` can leave one side behind. The edge
    // is then invisible from the target: the task that blocks something
    // shows it, the task being blocked does not, so nobody working on
    // it can see why it is stuck.
    const t1 = makeTask("aaa", "T-1", [{ type: "parent", target: "bbb" }]);
    const t2 = makeTask("bbb", "T-2");
    await writeTask(locttDir, "aaa", t1);
    await writeTask(locttDir, "bbb", t2);

    const errors = await validateRelationships(locttDir, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.taskId).toBe("aaa");
    expect(errors[0]?.message).toMatch(/no matching "child"/);
  });

  it("accepts a symmetric relationship with the same type on both sides", async () => {
    // `relates_to` is its own inverse, so requiring a *different* type
    // back would make every symmetric link report as broken.
    const t1 = makeTask("aaa", "T-1", [{ type: "relates_to", target: "bbb" }]);
    const t2 = makeTask("bbb", "T-2", [{ type: "relates_to", target: "aaa" }]);
    await writeTask(locttDir, "aaa", t1);
    await writeTask(locttDir, "bbb", t2);

    expect(await validateRelationships(locttDir, config)).toEqual([]);
  });

  it("checks symmetric relationships rather than skipping them", async () => {
    // The paired test above passes whether symmetric links are checked
    // correctly or skipped entirely — "no error" is true either way. It
    // takes a *one-sided* symmetric link to tell those apart, and
    // skipping is a real temptation: `relates_to` is its own inverse,
    // so the naive guard is `inverse === type -> continue`.
    const t1 = makeTask("aaa", "T-1", [{ type: "relates_to", target: "bbb" }]);
    const t2 = makeTask("bbb", "T-2");
    await writeTask(locttDir, "aaa", t1);
    await writeTask(locttDir, "bbb", t2);

    const errors = await validateRelationships(locttDir, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/no matching "relates_to"/);
  });

  it("does not report a missing inverse when the target does not exist", async () => {
    // The dangling-target error already says what is wrong; adding a
    // second finding about the inverse would be noise about a task that
    // is not there.
    const t1 = makeTask("aaa", "T-1", [{ type: "parent", target: "ghost" }]);
    await writeTask(locttDir, "aaa", t1);

    const errors = await validateRelationships(locttDir, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/does not exist/);
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

    const tree = buildTree(tasks, "parent");
    expect(tree.edges.get("")).toEqual(["root"]);
    expect(tree.edges.get("root")?.sort()).toEqual(["child1", "child2"]);
  });
});

describe("axis is chosen by the caller, not by config order", () => {
  // The defect 0c removes: `find(r => r.structural)` took the first
  // match, and the shipped default declared `blocks` before `parent`
  // with both marked structural — so getChildren returned the tasks a
  // task blocked, not its children. Silently wrong, not an error.
  const tasks = [
    makeTask("root", "T-1"),
    makeTask("kid", "T-2", [{ type: "parent", target: "root" }]),
    makeTask("blocked", "T-3", [{ type: "blocks", target: "root" }]),
  ];

  it("getChildren walks the axis it is given", () => {
    expect(getChildren(tasks, "root", "parent").map(t => t.frontmatter.id))
      .toEqual(["kid"]);
    expect(getChildren(tasks, "root", "blocks").map(t => t.frontmatter.id))
      .toEqual(["blocked"]);
  });

  it("buildTree walks the axis it is given", () => {
    expect(buildTree(tasks, "parent").edges.get("root")).toEqual(["kid"]);
    expect(buildTree(tasks, "blocks").edges.get("root")).toEqual(["blocked"]);
  });

  it("an axis with no edges yields every task as a root", () => {
    const tree = buildTree(tasks, "relates_to");
    expect(tree.edges.get("")).toEqual(["root", "kid", "blocked"]);
    expect(tree.cycles).toEqual([]);
  });
});

describe("buildTree cycle reporting", () => {
  it("reports a cycle instead of silently returning no roots", () => {
    // Reachable without any invalid operation: a git sync can merge two
    // halves that were each legitimate. Before this, edges came back
    // with an empty roots list, so a renderer starting from roots drew
    // an empty tree with no explanation.
    const tasks = [
      makeTask("a", "T-1", [{ type: "parent", target: "b" }]),
      makeTask("b", "T-2", [{ type: "parent", target: "a" }]),
    ];
    const tree = buildTree(tasks, "parent");

    expect(tree.edges.get("")).toEqual([]);
    expect(tree.cycles).toHaveLength(1);
    expect(tree.cycles[0]?.relationshipKey).toBe("parent");
    expect(tree.cycles[0]?.path).toEqual(["a", "b", "a"]);
  });

  it("still returns the acyclic part alongside the cycle", () => {
    // The UI renders what it can and banners the rest, so the acyclic
    // subtree must survive.
    const tasks = [
      makeTask("root", "T-1"),
      makeTask("kid", "T-2", [{ type: "parent", target: "root" }]),
      makeTask("a", "T-3", [{ type: "parent", target: "b" }]),
      makeTask("b", "T-4", [{ type: "parent", target: "a" }]),
    ];
    const tree = buildTree(tasks, "parent");

    expect(tree.edges.get("")).toEqual(["root"]);
    expect(tree.edges.get("root")).toEqual(["kid"]);
    expect(tree.cycles).toHaveLength(1);
  });

  it("reports each cycle once, canonicalized to its lowest id", () => {
    const tasks = [
      makeTask("c", "T-1", [{ type: "parent", target: "a" }]),
      makeTask("a", "T-2", [{ type: "parent", target: "b" }]),
      makeTask("b", "T-3", [{ type: "parent", target: "c" }]),
    ];
    const tree = buildTree(tasks, "parent");
    expect(tree.cycles).toHaveLength(1);
    expect(tree.cycles[0]?.path).toEqual(["a", "b", "c", "a"]);
  });

  it("does not treat a DAG as a cycle", () => {
    // A diamond: two parents converging on one child. Revisiting a
    // finished node is not a back-edge.
    const tasks = [
      makeTask("top", "T-1"),
      makeTask("l", "T-2", [{ type: "parent", target: "top" }]),
      makeTask("r", "T-3", [{ type: "parent", target: "top" }]),
      makeTask("bottom", "T-4", [
        { type: "parent", target: "l" },
        { type: "parent", target: "r" },
      ]),
    ];
    expect(buildTree(tasks, "parent").cycles).toEqual([]);
  });

  it("ignores a dangling target rather than reporting a cycle", () => {
    const tasks = [makeTask("a", "T-1", [{ type: "parent", target: "ghost" }])];
    const tree = buildTree(tasks, "parent");
    expect(tree.cycles).toEqual([]);
  });

  it("reports two independent cycles separately", () => {
    const tasks = [
      makeTask("a", "T-1", [{ type: "parent", target: "b" }]),
      makeTask("b", "T-2", [{ type: "parent", target: "a" }]),
      makeTask("x", "T-3", [{ type: "parent", target: "y" }]),
      makeTask("y", "T-4", [{ type: "parent", target: "x" }]),
    ];
    const cycles = buildTree(tasks, "parent").cycles;
    expect(cycles).toHaveLength(2);
    expect(cycles.map(c => c.path[0]).sort()).toEqual(["a", "x"]);
  });

  it("terminates on a self-loop", () => {
    const tasks = [makeTask("a", "T-1", [{ type: "parent", target: "a" }])];
    const tree = buildTree(tasks, "parent");
    expect(tree.cycles).toHaveLength(1);
    expect(tree.cycles[0]?.path).toEqual(["a", "a"]);
  });
});

describe("getChildren / getParents", () => {
  const tasks = [
    makeTask("root", "T-1"),
    makeTask("child1", "T-2", [{ type: "parent", target: "root" }]),
    makeTask("child2", "T-3", [{ type: "parent", target: "root" }]),
  ];

  it("getChildren returns child tasks", () => {
    const children = getChildren(tasks, "root", "parent");
    const ids = children.map(c => c.frontmatter.id).sort();
    expect(ids).toEqual(["child1", "child2"]);
  });

  it("getParents returns parent tasks", () => {
    const parents = getParents(tasks, "child1", "parent");
    expect(parents.map(p => p.frontmatter.id)).toEqual(["root"]);
  });

  it("getParents returns empty for root tasks", () => {
    const parents = getParents(tasks, "root", "parent");
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
    const parents = getParents(multiParentTasks, "child", "parent");
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
    const tree = buildTree(tasks, "parent");
    expect(tree.edges.get("")).toEqual(["p1", "p2"]);
    expect(tree.edges.get("p1")).toEqual(["child"]);
    expect(tree.edges.get("p2")).toEqual(["child"]);
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

  it("ignores cycles on graph: none relationships", () => {
    // `relates_to` carries no graph constraint, so a loop there is
    // legitimate data rather than a defect.
    const tasks = [
      makeTask("a", "T-1", [{ type: "relates_to", target: "b" }]),
      makeTask("b", "T-2", [{ type: "relates_to", target: "a" }]),
    ];
    expect(findStructuralCycles(tasks, config)).toEqual([]);
  });

  it("reports cycles on graph: acyclic, not just graph: tree", () => {
    // The two differ only in tree-drawability; both forbid cycles. The
    // superseded `structural` boolean could not express that split, and
    // the shipped default marks `blocks` acyclic precisely because a
    // blocks cycle is a deadlock.
    const tasks = [
      makeTask("a", "T-1", [{ type: "blocks", target: "b" }]),
      makeTask("b", "T-2", [{ type: "blocks", target: "a" }]),
    ];
    const cycles = findStructuralCycles(tasks, config);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.relationshipKey).toBe("blocks");
  });

  it("does not crash on a dangling target", () => {
    const tasks = [
      makeTask("a", "T-1", [{ type: "parent", target: "ghost" }]),
    ];
    expect(findStructuralCycles(tasks, config)).toEqual([]);
  });
});
