// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SortableMove, SortableTreeProps } from "./SortableTree.tsx";
import { moveInArray, SortableTree } from "./SortableTree.tsx";

/**
 * SortableTree (K156): the one reorder primitive. Every test asserts the
 * far end the primitive owns: what `onMove` receives (or that it is not
 * called), and the drop line's attribute and element, which is what a
 * person sees while dragging or moving by keyboard.
 */

interface Node {
  readonly id: string;
  readonly children?: readonly Node[];
}

const FLAT: readonly Node[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

/** a has a1 (with a1x under it) and a2; b has b1. */
const NESTED: readonly Node[] = [
  { id: "a", children: [{ id: "a1", children: [{ id: "a1x" }] }, { id: "a2" }] },
  { id: "b", children: [{ id: "b1" }] },
  { id: "c" },
];

afterEach(cleanup);

function renderTree(
  items: readonly Node[],
  props: Partial<SortableTreeProps<Node>> = {},
): { onMove: ReturnType<typeof vi.fn<(m: SortableMove) => void>> } {
  const onMove = vi.fn<(m: SortableMove) => void>();
  render(
    <SortableTree
      items={items}
      getId={n => n.id}
      getChildren={n => n.children}
      itemName={n => n.id.toUpperCase()}
      onMove={onMove}
      testIds={{ row: n => `row-${n.id}`, handle: n => `handle-${n.id}` }}
      renderItem={(n, ctx) => (
        <div data-testid={`content-${n.id}`} className="flex">
          {ctx.leading}
          <span>{n.id}</span>
        </div>
      )}
      {...props}
    />,
  );
  return { onMove };
}

/** Rendered row ids, depth-first, in document order. */
function rendered(): string[] {
  return Array.from(document.querySelectorAll("[data-sortable-row]"))
    .map(el => (el.getAttribute("data-testid") ?? "").replace(/^row-/, ""));
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`row-${id}`);
}

function handle(id: string): HTMLElement {
  return screen.getByTestId(`handle-${id}`);
}

/** Which row carries the drop line, and on which edge. */
function lines(): { row: string; edge: string | null }[] {
  return Array.from(document.querySelectorAll('[data-testid="drop-line"]')).map(el => ({
    row: (el.closest("[data-sortable-row]")?.getAttribute("data-testid") ?? "").replace(/^row-/, ""),
    edge: el.getAttribute("data-edge"),
  }));
}

describe("SortableTree: shapes", () => {
  it("renders a flat list and ignores children when nesting is off", () => {
    renderTree(NESTED);
    expect(rendered()).toEqual(["a", "b", "c"]);
    expect(screen.queryAllByTestId("tree-toggle")).toHaveLength(0);
  });

  it("renders every level, expanded, when nesting is on", () => {
    renderTree(NESTED, { nesting: true });
    expect(rendered()).toEqual(["a", "a1", "a1x", "a2", "b", "b1", "c"]);
    expect(row("a1x").getAttribute("data-depth")).toBe("2");
  });

  it("stops at maxDepth levels, and a row whose children are not shown gets no toggle", () => {
    renderTree(NESTED, { nesting: true, maxDepth: 2 });
    expect(rendered()).toEqual(["a", "a1", "a2", "b", "b1", "c"]);
    // a1 has a child, but depth 2 is not rendered: no toggle to open nothing.
    expect(row("a1").querySelector('[data-testid="tree-toggle"]')).toBeNull();
  });

  it("starts collapsed when asked, and the toggle opens one item", () => {
    renderTree(NESTED, { nesting: true, startCollapsed: true });
    expect(rendered()).toEqual(["a", "b", "c"]);
    const toggle = row("a").querySelector<HTMLElement>('[data-testid="tree-toggle"]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle as HTMLElement);
    expect(rendered()).toEqual(["a", "a1", "a2", "b", "c"]);
  });

  it("shows the toggle only on items with children, and a spacer where a level cannot reorder", () => {
    renderTree(NESTED, { nesting: true, canReorder: l => l.depth === 0 });
    expect(row("a").querySelector('[data-testid="tree-toggle"]')).not.toBeNull();
    expect(row("c").querySelector('[data-testid="tree-toggle"]')).toBeNull();
    expect(screen.queryByTestId("handle-a1")).toBeNull();
    // The 24px slot is still there, so content lines up.
    expect(screen.getByTestId("content-a1").querySelector("[data-sortable-spacer]")).not.toBeNull();
    expect(screen.getByTestId("content-c").querySelector("[data-sortable-spacer]")).toBeNull();
  });

  it("names the handle with its position and renders a disabled handle as inert", () => {
    renderTree(FLAT, { disabled: true });
    expect(handle("b").getAttribute("aria-label")).toBe(
      "Reorder B, position 2 of 4. Arrow up and down to move, Enter to drop, Escape to cancel.",
    );
    expect((handle("b") as HTMLButtonElement).disabled).toBe(true);
    expect(row("b").getAttribute("draggable")).toBe("false");
  });
});

describe("SortableTree: keyboard pickup", () => {
  it("Space picks up, arrows move on screen with the line, Enter drops once", () => {
    const { onMove } = renderTree(FLAT);
    fireEvent.keyDown(handle("c"), { key: " " });
    expect(row("c").getAttribute("data-picked-up")).toBe("true");
    // Picked up in place: no line, nothing would change.
    expect(lines()).toEqual([]);

    fireEvent.keyDown(handle("c"), { key: "ArrowUp" });
    expect(rendered()).toEqual(["a", "c", "b", "d"]);
    // The line marks the edge it crossed: above C, between A and C.
    expect(lines()).toEqual([{ row: "c", edge: "above" }]);
    expect(row("c").getAttribute("data-drop-indicator")).toBe("above");
    expect(screen.getByTestId("reorder-announcement").textContent).toBe("C moved to position 2 of 4");
    expect(onMove).not.toHaveBeenCalled();

    fireEvent.keyDown(handle("c"), { key: "Enter" });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ parentId: null, fromIndex: 2, toIndex: 1, before: "b" });
    expect(lines()).toEqual([]);
    expect(screen.getByTestId("reorder-announcement").textContent).toBe("C dropped at position 2 of 4");
  });

  it("an arrow picks up on its own; moving down draws the line below and anchors after", () => {
    const { onMove } = renderTree(FLAT);
    fireEvent.keyDown(handle("a"), { key: "ArrowDown" });
    fireEvent.keyDown(handle("a"), { key: "ArrowDown" });
    expect(rendered()).toEqual(["b", "c", "a", "d"]);
    expect(lines()).toEqual([{ row: "a", edge: "below" }]);
    fireEvent.keyDown(handle("a"), { key: " " });
    expect(onMove).toHaveBeenCalledWith({ parentId: null, fromIndex: 0, toIndex: 2, after: "c" });
  });

  it("Escape puts the item back and calls nothing", () => {
    const { onMove } = renderTree(FLAT);
    fireEvent.keyDown(handle("a"), { key: "ArrowDown" });
    fireEvent.keyDown(handle("a"), { key: "Escape" });
    expect(rendered()).toEqual(["a", "b", "c", "d"]);
    expect(lines()).toEqual([]);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByTestId("reorder-announcement").textContent).toBe("Move cancelled");
  });

  it("dropping where it was picked up calls nothing", () => {
    const { onMove } = renderTree(FLAT);
    fireEvent.keyDown(handle("b"), { key: "ArrowDown" });
    fireEvent.keyDown(handle("b"), { key: "ArrowUp" });
    fireEvent.keyDown(handle("b"), { key: "Enter" });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("moves stay within the level: a nested item cannot leave its parent", () => {
    const { onMove } = renderTree(NESTED, { nesting: true });
    fireEvent.keyDown(handle("a2"), { key: "ArrowDown" });
    // a2 is last under a: it does not cross into b's children.
    expect(rendered()).toEqual(["a", "a1", "a1x", "a2", "b", "b1", "c"]);
    fireEvent.keyDown(handle("a2"), { key: "ArrowUp" });
    fireEvent.keyDown(handle("a2"), { key: "Enter" });
    expect(onMove).toHaveBeenCalledWith({ parentId: "a", fromIndex: 1, toIndex: 0, before: "a1" });
  });
});

describe("SortableTree: drag", () => {
  it("drag over a later row draws the line below it; the drop calls onMove once", () => {
    const { onMove } = renderTree(FLAT);
    expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(0);
    fireEvent.dragStart(row("a"));
    expect(row("a").getAttribute("data-dragging")).toBe("true");
    fireEvent.dragOver(row("c"));
    expect(lines()).toEqual([{ row: "c", edge: "below" }]);
    expect(row("c").getAttribute("data-drop-indicator")).toBe("below");
    fireEvent.drop(row("c"));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ parentId: null, fromIndex: 0, toIndex: 2, after: "c" });
    expect(lines()).toEqual([]);
  });

  it("drag over an earlier row draws the line above it and anchors before", () => {
    const { onMove } = renderTree(FLAT);
    fireEvent.dragStart(row("d"));
    fireEvent.dragOver(row("b"));
    expect(lines()).toEqual([{ row: "b", edge: "above" }]);
    fireEvent.drop(row("b"));
    expect(onMove).toHaveBeenCalledWith({ parentId: null, fromIndex: 3, toIndex: 1, before: "b" });
  });

  it("no line over its own slot, and the line clears on drag end", () => {
    const { onMove } = renderTree(FLAT);
    fireEvent.dragStart(row("b"));
    fireEvent.dragOver(row("b"));
    expect(lines()).toEqual([]);
    fireEvent.dragOver(row("d"));
    expect(lines()).toHaveLength(1);
    fireEvent.dragEnd(row("b"));
    expect(lines()).toEqual([]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("the line clears when the pointer leaves the list", () => {
    renderTree(FLAT);
    fireEvent.dragStart(row("a"));
    fireEvent.dragOver(row("c"));
    expect(lines()).toHaveLength(1);
    const tree = document.querySelector("[data-sortable-tree]") as HTMLElement;
    fireEvent.dragLeave(tree, { relatedTarget: document.body });
    expect(lines()).toEqual([]);
  });

  it("a row of another level is no drop target: no line, no move", () => {
    const { onMove } = renderTree(NESTED, { nesting: true });
    fireEvent.dragStart(row("a1"));
    // b1 is at the same depth but under another parent.
    fireEvent.dragOver(row("b1"));
    expect(lines()).toEqual([]);
    fireEvent.drop(row("b1"));
    expect(onMove).not.toHaveBeenCalled();
    // Its sibling is a target.
    fireEvent.dragOver(row("a2"));
    expect(lines()).toEqual([{ row: "a2", edge: "below" }]);
    fireEvent.drop(row("a2"));
    expect(onMove).toHaveBeenCalledWith({ parentId: "a", fromIndex: 0, toIndex: 1, after: "a2" });
  });

  it("a drop on a nested row lands next to its top-level ancestor when dragging the top level", () => {
    const { onMove } = renderTree(NESTED, { nesting: true });
    fireEvent.dragStart(row("c"));
    fireEvent.dragOver(row("a1x"));
    expect(lines()).toEqual([{ row: "a", edge: "above" }]);
    fireEvent.drop(row("a1x"));
    expect(onMove).toHaveBeenCalledWith({ parentId: null, fromIndex: 2, toIndex: 0, before: "a" });
  });

  it("a level that cannot reorder is not draggable", () => {
    renderTree(NESTED, { nesting: true, canReorder: l => l.depth === 0 });
    expect(row("a").getAttribute("draggable")).toBe("true");
    expect(row("a1").getAttribute("draggable")).toBe("false");
  });
});

describe("moveInArray", () => {
  it("moves one element and leaves the input alone", () => {
    const input = ["a", "b", "c"];
    expect(moveInArray(input, 0, 2)).toEqual(["b", "c", "a"]);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
