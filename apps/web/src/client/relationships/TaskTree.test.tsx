// @vitest-environment jsdom
import type { TaskFrontmatterPublic } from "@loctt/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RelationshipGroup, RelationshipRow } from "./group.ts";
import { TaskTree } from "./TaskTree.tsx";

/**
 * TaskTree (K156): every relationship group's rows on the shared
 * SortableTree. What it owns beyond the primitive: flat vs tree groups
 * render the same leading controls (so rows align), only this task's own
 * (depth-0) rows can be reordered and removed, the cycle and dangling
 * treatments survive, and a move reports the group's stored indices.
 */

afterEach(cleanup);

function row(target: string, key: string | undefined, over: Partial<RelationshipRow> = {}): RelationshipRow {
  return {
    type: "child",
    target,
    resolvedKey: key,
    resolvedTitle: key === undefined ? undefined : `Title ${key}`,
    resolvedStatus: "backlog",
    missing: key === undefined,
    rank: undefined,
    index: 0,
    duplicates: 1,
    ...over,
  };
}

function group(over: Partial<RelationshipGroup>): RelationshipGroup {
  return { key: "child", label: "Child", unknown: false, ranked: true, tree: false, rows: [], ...over };
}

function task(id: string, key: string, children: readonly string[] = []): TaskFrontmatterPublic {
  return {
    id,
    key,
    title: `Title ${key}`,
    status: "backlog",
    relationships: children.map((t, i) => ({ type: "child", target: t, rank: String.fromCharCode(97 + i) })),
  } as unknown as TaskFrontmatterPublic;
}

function renderTree(
  g: RelationshipGroup,
  index: ReadonlyMap<string, TaskFrontmatterPublic> = new Map(),
): { onMove: ReturnType<typeof vi.fn>; onRemove: ReturnType<typeof vi.fn> } {
  const onMove = vi.fn();
  const onRemove = vi.fn();
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <TaskTree
        group={g}
        taskId="root"
        taskIndex={index}
        statusOf={() => undefined}
        removing={false}
        onRemove={onRemove}
        onMove={onMove}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
  return { onMove, onRemove };
}

/** The first child element of a relationship row: the leading slot. */
function leadingOf(target: string): Element | null | undefined {
  return document.querySelector(`[data-testid="relationship-row"][data-target="${target}"]`)?.firstElementChild;
}

describe("TaskTree", () => {
  it("a flat group's rows carry the handle first, and no tree markup", async () => {
    renderTree(group({ key: "blocks", rows: [row("b1", "T-2", { type: "blocks" }), row("b2", "T-3", { type: "blocks" })] }));
    await screen.findAllByTestId("relationship-row");
    expect(leadingOf("b1")?.getAttribute("data-testid")).toBe("drag-handle");
    expect(screen.queryAllByTestId("tree-node")).toHaveLength(0);
    expect(screen.queryAllByTestId("tree-toggle")).toHaveLength(0);
  });

  it("a tree group puts the handle first too; the toggle only on a row with children", async () => {
    const index = new Map([
      ["c1", task("c1", "C1", ["g1"])],
      ["c2", task("c2", "C2")],
      ["g1", task("g1", "G1")],
    ]);
    renderTree(group({ tree: true, rows: [row("c1", "C1"), row("c2", "C2")] }), index);
    await screen.findAllByTestId("tree-node");
    // Same first element as a flat row, so the key starts at the same x.
    expect(leadingOf("c2")?.getAttribute("data-testid")).toBe("drag-handle");
    expect(document.querySelector('[data-target="c2"] [data-testid="tree-toggle"]')).toBeNull();
    expect(document.querySelector('[data-testid="tree-node"][data-target="c1"] [data-testid="tree-toggle"]')).not.toBeNull();
    // The grandchild: a spacer where the handle would be, no remove kebab.
    expect(leadingOf("g1")?.hasAttribute("data-sortable-spacer")).toBe(true);
    const g1 = document.querySelector('[data-testid="relationship-row"][data-target="g1"]');
    expect(g1?.querySelector('[data-testid="relationship-kebab"]')).toBeNull();
    expect(screen.getAllByTestId("drag-handle")).toHaveLength(2);
  });

  it("an undeclared kind gets no handles but keeps the slot, so its rows still align", async () => {
    renderTree(group({ key: "mystery", unknown: true, ranked: false, rows: [row("m1", "T-9", { type: "mystery" })] }));
    await screen.findAllByTestId("relationship-row");
    expect(screen.queryAllByTestId("drag-handle")).toHaveLength(0);
    expect(leadingOf("m1")?.hasAttribute("data-sortable-spacer")).toBe(true);
  });

  it("a keyboard move reports the group's stored indices", async () => {
    const { onMove } = renderTree(group({ key: "blocks", rows: [row("b1", "T-2"), row("b2", "T-3"), row("b3", "T-4")] }));
    const handles = await screen.findAllByTestId("drag-handle");
    fireEvent.keyDown(handles[2] as HTMLElement, { key: "ArrowUp" });
    fireEvent.keyDown(handles[2] as HTMLElement, { key: "ArrowUp" });
    fireEvent.keyDown(screen.getAllByTestId("drag-handle")[0] as HTMLElement, { key: "Enter" });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(2, 0);
  });

  it("marks a cycle where it repeats and says how to break it", async () => {
    // c1's child is the root task itself: the walk stops and marks it.
    const index = new Map([["c1", task("c1", "C1", ["root"])], ["root", task("root", "ROOT")]]);
    renderTree(group({ tree: true, rows: [row("c1", "C1")] }), index);
    expect(await screen.findByTestId("tree-cycle-marker")).toBeTruthy();
    expect(screen.getByTestId("relationship-cycle").textContent).toContain("contains a cycle");
  });

  it("a dangling row stays a row with its remove control", async () => {
    const { onRemove } = renderTree(group({ key: "blocks", rows: [row("gone", undefined, { type: "blocks" })] }));
    expect(await screen.findByTestId("relationship-broken")).toBeTruthy();
    expect(screen.getByTestId("relationship-kebab")).toBeTruthy();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
