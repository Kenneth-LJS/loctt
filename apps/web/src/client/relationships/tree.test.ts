import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { RelationshipRow } from "./group.ts";
import { buildTaskIndex, buildTree, hasCycle, MAX_TREE_DEPTH } from "./tree.ts";

/**
 * REL-5's nesting and REL-21's cycle guard.
 *
 * REL-21 is the one case in this ticket that a UI spec cannot honestly
 * prove. Its central claim is "does not lock the browser tab; there is
 * no unbounded loop" — and a Playwright test against an implementation
 * that *does* loop forever does not fail with a useful message, it
 * hangs until the suite's timeout and reports a timeout, which is
 * indistinguishable from the ambient flakiness recorded in
 * known-gaps.md. Here the same claim is a function that returns, so
 * "it terminated" is an assertion rather than the absence of one.
 */

function fm(
  id: string,
  edges: readonly { type: string; target: string }[] = [],
): TaskFrontmatterPublic {
  return {
    id,
    key: `K-${id}`,
    title: `Title ${id}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "backlog",
    relationships: edges,
  } as unknown as TaskFrontmatterPublic;
}

function row(target: string): RelationshipRow {
  return {
    type: "child",
    target,
    resolvedKey: `K-${target}`,
    resolvedTitle: `Title ${target}`,
    resolvedStatus: "backlog",
    missing: false,
    rank: undefined,
    index: 0,
    duplicates: 1,
  };
}

describe("buildTree", () => {
  // @verifies REL-5
  it("nests two children, one of which has three of its own", () => {
    // root -> a, b ; b -> c, d, e
    const index = buildTaskIndex([
      fm("root", [{ type: "child", target: "a" }, { type: "child", target: "b" }]),
      fm("a"),
      fm("b", [
        { type: "child", target: "c" },
        { type: "child", target: "d" },
        { type: "child", target: "e" },
      ]),
      fm("c"), fm("d"), fm("e"),
    ]);

    const nodes = buildTree([row("a"), row("b")], "child", index, "root");

    expect(nodes.map(n => n.target)).toEqual(["a", "b"]);
    expect(nodes.map(n => n.depth)).toEqual([0, 0]);
    // `a` is a leaf; `b` carries three children at depth 1.
    expect(nodes[0]?.children).toEqual([]);
    expect(nodes[1]?.children.map(n => n.target)).toEqual(["c", "d", "e"]);
    expect(nodes[1]?.children.map(n => n.depth)).toEqual([1, 1, 1]);
    // Each node carries the key, title and status the case asks for, so
    // the subtree is scannable without a second request.
    expect(nodes[1]?.children[0]).toMatchObject({
      resolvedKey: "K-c",
      resolvedTitle: "Title c",
      resolvedStatus: "backlog",
    });
  });

  // @verifies REL-5
  it("follows only the group's own edge type", () => {
    // `b` has a `child` and a `blocks` edge; only the first is walked.
    const index = buildTaskIndex([
      fm("b", [{ type: "child", target: "c" }, { type: "blocks", target: "x" }]),
      fm("c"), fm("x"),
    ]);
    const nodes = buildTree([row("b")], "child", index, "root");
    expect(nodes[0]?.children.map(n => n.target)).toEqual(["c"]);
  });

  // @verifies REL-21
  it("stops at a repeat and names the ancestor, rather than recursing forever", () => {
    // A cycle: a -> b -> a. Without the guard this recurses until the
    // stack overflows, so the assertion is that the call *returns*.
    const index = buildTaskIndex([
      fm("a", [{ type: "child", target: "b" }]),
      fm("b", [{ type: "child", target: "a" }]),
    ]);

    const nodes = buildTree([row("a")], "child", index, "root");

    const b = nodes[0]?.children[0];
    const repeat = b?.children[0];
    expect(b?.target).toBe("b");
    // The repeat is present as a marked row — not pruned silently,
    // which would hide the cycle instead of naming it.
    expect(repeat?.target).toBe("a");
    expect(repeat?.cycleWith).toBe("K-a");
    // And the walk stops there.
    expect(repeat?.children).toEqual([]);
    expect(hasCycle(nodes)).toBe(true);
  });

  // @verifies REL-21
  it("terminates on a two-node mutual cycle reached from the root itself", () => {
    // root -> a -> root. The root seeds the ancestor path, so the
    // second hop is the repeat.
    const index = buildTaskIndex([
      fm("a", [{ type: "child", target: "root" }]),
      fm("root", [{ type: "child", target: "a" }]),
    ]);
    const nodes = buildTree([row("a")], "child", index, "root");
    expect(nodes[0]?.children[0]?.target).toBe("root");
    expect(nodes[0]?.children[0]?.cycleWith).toBe("K-root");
    expect(nodes[0]?.children[0]?.children).toEqual([]);
  });

  // @verifies REL-5
  it("does not mistake a diamond for a cycle", () => {
    // a and b both point at shared. That repeats a node in the forest
    // but never on one path, so neither copy may be marked — a visited
    // set would prune the second and lose a real child.
    const index = buildTaskIndex([
      fm("a", [{ type: "child", target: "shared" }]),
      fm("b", [{ type: "child", target: "shared" }]),
      fm("shared"),
    ]);
    const nodes = buildTree([row("a"), row("b")], "child", index, "root");

    expect(nodes[0]?.children.map(n => n.target)).toEqual(["shared"]);
    expect(nodes[1]?.children.map(n => n.target)).toEqual(["shared"]);
    expect(hasCycle(nodes)).toBe(false);
  });

  // @verifies REL-21
  it("truncates a chain deeper than the cap rather than rendering it all", () => {
    // A straight chain of MAX_TREE_DEPTH + 5 nodes: no cycle, just
    // depth. The cap must stop it and say so rather than marking a
    // cycle that does not exist.
    const n = MAX_TREE_DEPTH + 5;
    const index = buildTaskIndex(
      Array.from({ length: n }, (_, i) =>
        fm(`n${String(i)}`, i + 1 < n ? [{ type: "child", target: `n${String(i + 1)}` }] : []),
      ),
    );
    const nodes = buildTree([row("n0")], "child", index, "root");

    let node = nodes[0];
    let depth = 0;
    while (node?.children[0] !== undefined) {
      node = node.children[0];
      depth += 1;
    }
    expect(depth).toBe(MAX_TREE_DEPTH);
    expect(node?.truncated).toBe(true);
    // A depth cut is not a cycle, and conflating them would tell the
    // user their data is broken when it is merely deep.
    expect(node?.cycleWith).toBeUndefined();
    expect(hasCycle(nodes)).toBe(false);
  });

  // @verifies REL-5
  it("renders a leaf when the graph index has not loaded", () => {
    // The empty index is what the panel gets while /api/tasks is in
    // flight. The task's own edges still render; the descendants do
    // not, and nothing throws.
    const nodes = buildTree([row("a"), row("b")], "child", new Map(), "root");
    expect(nodes.map(n => n.target)).toEqual(["a", "b"]);
    expect(nodes.every(n => n.children.length === 0)).toBe(true);
    // The row's own resolved data survives, so the degraded render is
    // still readable rather than a pair of blank rows.
    expect(nodes[0]?.resolvedTitle).toBe("Title a");
    expect(nodes[0]?.missing).toBe(false);
  });
});
