import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { arrowPath, dependencyEdges } from "./arrows.ts";

/**
 * Dependency arrows (TML-14).
 *
 * The task set below mirrors the case exactly: `blocks` is configured,
 * and `depends_on` and `parent` links exist **between the same tasks**,
 * so a filter that leaks would show up here rather than in a tracker
 * where those links happen not to exist.
 */

function task(id: string, rels: { type: string; target: string }[] = []): TaskFrontmatterPublic {
  return {
    id,
    key: `T-${id}`,
    title: `Task ${id}`,
    status: "backlog",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    relationships: rels,
  } as TaskFrontmatterPublic;
}

const tasks: TaskFrontmatterPublic[] = [
  task("a", [
    { type: "blocks", target: "b" },
    // Same pair, other relationship types — TML-14's second bullet.
    { type: "depends_on", target: "b" },
    { type: "parent", target: "b" },
  ]),
  // The materialized inverse core writes on the target task.
  task("b", [{ type: "is_blocked_by", target: "a" }]),
];

describe("dependencyEdges", () => {
  // @verifies TML-14
  it("draws an arrow for the configured relationship only", () => {
    const edges = dependencyEdges(tasks, "blocks");
    expect(edges).toEqual([{ from: "a", to: "b" }]);
  });

  // @verifies TML-14
  it("draws NO arrow for depends_on or parent links on the same tasks", () => {
    const edges = dependencyEdges(tasks, "blocks");
    expect(edges).toHaveLength(1);
    // Positive control: those links really are present in the fixture,
    // so the absence above is a filter working, not a missing input.
    const types = tasks.flatMap(t => (t.relationships ?? []).map(r => r.type));
    expect(types).toContain("depends_on");
    expect(types).toContain("parent");
  });

  // @verifies TML-14
  it("follows the forward edge, not the materialized inverse", () => {
    // Core stores `blocks` on the source and `is_blocked_by` on the
    // target. Reading only the forward key gives one edge, pointing
    // a → b. Reading both would double it and could reverse it.
    const edges = dependencyEdges(tasks, "blocks");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.from).toBe("a");
    expect(edges[0]?.to).toBe("b");
  });

  // @verifies TML-14
  it("draws nothing when no relationship is configured", () => {
    expect(dependencyEdges(tasks, undefined)).toEqual([]);
  });

  // @verifies TML-14
  it("draws nothing for a key that names no defined relationship", () => {
    // TML-34's "no arrows" half: a dangling config key matches no
    // stored link, so there is nothing to draw — and, crucially, no
    // crash.
    expect(dependencyEdges(tasks, "dpends_on")).toEqual([]);
  });

  it("drops an edge whose other end is not on screen", () => {
    const only = [tasks[0] as TaskFrontmatterPublic];
    expect(dependencyEdges(only, "blocks")).toEqual([]);
  });

  it("ignores a self-link", () => {
    expect(dependencyEdges([task("z", [{ type: "blocks", target: "z" }])], "blocks")).toEqual([]);
  });
});

describe("arrowPath", () => {
  it("routes orthogonally: out horizontally, across, in horizontally", () => {
    const d = arrowPath({ x: 10, y: 20 }, { x: 100, y: 60 });
    expect(d).toBe("M 10 20 H 88 V 60 H 100");
  });

  it("does not double back through the source when the target starts earlier", () => {
    // A backwards-in-time link. Without the clamp the turn would fall
    // left of the source's own edge and the path would cross its bar.
    const from = { x: 200, y: 20 };
    const to = { x: 50, y: 60 };
    const d = arrowPath(from, to, 12);
    // The vertical segment sits a stub to the RIGHT of the source.
    expect(d).toContain("H 212");
  });
});
