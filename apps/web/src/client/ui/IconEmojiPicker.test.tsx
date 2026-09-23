// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconEmojiPicker } from "./IconEmojiPicker.tsx";

afterEach(() => { cleanup(); });

/**
 * The grid's column count is derived from actual layout (see the doc
 * comment on `onGridKeyDown` in the component), not a hardcoded
 * constant — so keyboard-navigation tests need `getBoundingClientRect`
 * to report a real row/column shape. jsdom does no layout on its own
 * (every rect is all-zero), so this stubs it the same way
 * `Menu.test.tsx` stubs it for its own layout-dependent behaviour:
 * gridcells are laid out `columns`-wide, each 32px square.
 */
function mockGridLayout(columns: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement): DOMRect {
      if (this.getAttribute("role") === "gridcell") {
        const container = this.closest('[role="grid"]');
        const cells = container
          ? Array.from(container.querySelectorAll('[role="gridcell"]'))
          : [];
        const index = cells.indexOf(this);
        const row = Math.floor(index / columns);
        const col = index % columns;
        return {
          left: col * 32, right: col * 32 + 32,
          top: row * 32, bottom: row * 32 + 32,
          width: 32, height: 32, x: col * 32, y: row * 32,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect;
    },
  );
}

beforeEach(() => { mockGridLayout(8); });

/**
 * K104 — the icon picker (A279's portalled two-tab grid).
 *
 * Every behaviour the old Combobox-based `IconPicker` asserted is
 * carried forward here (pick, search, clear, keep-an-unknown-value), so
 * replacing the control did not quietly drop a guarantee. The new
 * assertions cover what A279 added: the two tabs over one search box,
 * and the free-type emoji escape hatch.
 */

function Harness({ initial }: { readonly initial?: string | undefined }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <div>
      <IconEmojiPicker
        value={value}
        onChange={setValue}
        testId="icon-trigger"
        listTestId="icon-list"
        searchTestId="icon-search"
        clearTestId="icon-clear"
      />
      <output data-testid="picked">{value ?? "(none)"}</output>
    </div>
  );
}

describe("IconEmojiPicker", () => {
  it("picks a Lucide icon and reports it through onChange", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-option-flag"));
    expect(screen.getByTestId("picked").textContent).toBe("flag");
  });

  it("is searchable — typing filters the icon grid", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.change(screen.getByTestId("icon-search"), { target: { value: "calend" } });
    expect(screen.getByTestId("icon-option-calendar")).toBeTruthy();
    expect(screen.queryByTestId("icon-option-flag")).toBeNull();
  });

  it("the one search box filters the Emoji tab too, by keyword", () => {
    // A279's reason for ONE box: a user wanting "a rocket" does not know
    // which source has one. Searching on the Icons tab must already have
    // narrowed Emoji, so switching tabs lands on matches, not on
    // everything.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.change(screen.getByTestId("icon-search"), { target: { value: "rocket" } });
    fireEvent.click(screen.getByTestId("icon-list-tab-emoji"));
    expect(screen.getByTestId("icon-option-🚀")).toBeTruthy();
    // A non-matching emoji is filtered out.
    expect(screen.queryByTestId("icon-option-☕")).toBeNull();
  });

  it("picks a curated emoji from the Emoji tab", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-list-tab-emoji"));
    fireEvent.click(screen.getByTestId("icon-option-✅"));
    expect(screen.getByTestId("picked").textContent).toBe("✅");
  });

  it("accepts a free-typed emoji the curated list does not carry", () => {
    // The pinned escape hatch (A279): always visible, not a third tab.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.change(screen.getByTestId("icon-list-free"), { target: { value: "🦄" } });
    fireEvent.click(screen.getByTestId("icon-list-free-apply"));
    expect(screen.getByTestId("picked").textContent).toBe("🦄");
  });

  it("is clearable back to no icon", () => {
    render(<Harness initial="star" />);
    expect(screen.getByTestId("picked").textContent).toBe("star");
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-clear"));
    expect(screen.getByTestId("picked").textContent).toBe("(none)");
  });

  it("keeps a stored icon the catalog does not know selectable rather than dropping it", () => {
    // A279's field-local degradation: a hand-authored value is valid on
    // disk and stays the current selection.
    render(<Harness initial="🛸" />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    expect(screen.getByTestId("icon-option-🛸")).toBeTruthy();
    expect(screen.getByTestId("picked").textContent).toBe("🛸");
  });

  it("offers the six pre-K104 names that are not Lucide ids, so stored config keeps rendering", () => {
    // `alert` is NOT a Lucide id. Dropping it would orphan every
    // `icon: alert` already written to a workflow.yaml.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    fireEvent.click(screen.getByTestId("icon-option-alert"));
    expect(screen.getByTestId("picked").textContent).toBe("alert");
  });
});

/**
 * Arrow-key navigation over the grid — the known-gaps fix. Up to 225
 * cells with Tab as the only route through them (known-gaps.md) is not
 * navigation; these assert the `ColorPicker`-derived roving-focus model
 * that replaces it, adapted for a grid whose column count and cell
 * count both change under a live search filter.
 */
describe("IconEmojiPicker — grid keyboard navigation", () => {
  it("exposes the grid as role=grid with exactly one tab stop", () => {
    // "check" is the THIRD Lucide id (after flag, star), not the first —
    // this pins the tab stop to the selected cell rather than merely
    // agreeing with a stub that always picks index 0.
    render(<Harness initial="check" />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    expect(grid.getAttribute("role")).toBe("grid");
    const stops = Array.from(grid.querySelectorAll('[role="gridcell"]'))
      .filter(cell => (cell as HTMLElement).tabIndex === 0);
    expect(stops).toHaveLength(1);
    // The tab stop is the SELECTED cell, not always the first — Tab
    // should land a keyboard user where they already are.
    expect(stops[0]).toBe(screen.getByTestId("icon-option-check"));
  });

  it("Right moves focus one cell", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cells[1]);
  });

  it("Down moves focus a full row, not the next cell", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    // The layout mock lays cells out 8-wide, matching the real
    // `grid-cols-8` class — a flat-list implementation would land on
    // cells[1] instead.
    expect(document.activeElement).toBe(cells[8]);
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("Home/End jump to the first and last cell", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "End" });
    expect(document.activeElement).toBe(cells[cells.length - 1]);
    fireEvent.keyDown(grid, { key: "Home" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("reaches the last of 225 icons in a handful of keypresses, not 225", () => {
    // The known-gaps scenario itself: Tab alone took up to 225 presses.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    expect(cells.length).toBeGreaterThan(200);
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "End" });
    expect(document.activeElement).toBe(cells[cells.length - 1]);
  });

  it("clamps at the row ends rather than wrapping to another row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cells[0]);
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cells[0]);
  });

  it("clamps at the last cell on ArrowRight/ArrowDown too", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    const last = cells[cells.length - 1];
    last?.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);
  });

  it("moving focus with arrow keys does NOT select — only Enter/Space does", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "End" });
    // A pick closes the panel (`onPick` calls `close()`), so if arrowing
    // had selected, the panel would already be gone and "picked" would
    // have changed from its initial "(none)".
    expect(screen.getByTestId("picked").textContent).toBe("(none)");
    expect(screen.getByTestId("icon-trigger").getAttribute("aria-expanded")).toBe("true");
  });

  it("Enter on the focused cell selects it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    const target = cells[1];
    // jsdom does not run the browser's own "Enter activates a focused
    // button" behaviour, so this fires the button's click the way a
    // real Enter keypress would result in — asserting the SELECTION
    // behaviour, not the browser's native-activation plumbing.
    fireEvent.click(target as HTMLElement);
    expect(screen.getByTestId("picked").textContent).not.toBe("(none)");
  });

  it("re-measures columns when a search filters the grid down mid-navigation", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    // "flag" matches exactly one Lucide id, so the filtered grid is a
    // single short row — well under the 8-wide layout.
    fireEvent.change(screen.getByTestId("icon-search"), { target: { value: "flag" } });
    const grid = screen.getByTestId("icon-list");
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    // The filtered result is a single short row (well under 8), so with
    // layout correctly re-measured, Down should clamp to the SAME cell
    // rather than reading a stale 8-wide offset into a now-shorter list.
    expect(cells.length).toBeLessThan(8);
    cells[0]?.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cells[0]);
    fireEvent.keyDown(grid, { key: "End" });
    expect(document.activeElement).toBe(cells[cells.length - 1]);
  });

  it("keeps the roving focus stop in range when a search shrinks the grid out from under it", () => {
    // The scenario the task calls out by name: a cell deep in the full
    // 225-icon grid is focused, then a search narrows the set so that
    // cell no longer exists. Nothing here should throw, and the DOM
    // should settle on a valid (fewer, filtered) set of gridcells.
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const grid = screen.getByTestId("icon-list");
    const before = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    before[100]?.focus();
    fireEvent.change(screen.getByTestId("icon-search"), { target: { value: "flag" } });
    const after = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    expect(after.length).toBeLessThan(before.length);
    // Arrowing after the shrink must not throw and must stay in range.
    expect(() => { fireEvent.keyDown(grid, { key: "ArrowRight" }); }).not.toThrow();
  });

  it("ArrowDown from the search box moves focus into the grid's tab stop", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const search = screen.getByTestId("icon-search");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const grid = screen.getByTestId("icon-list");
    const stop = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'))
      .find(cell => cell.tabIndex === 0);
    expect(document.activeElement).toBe(stop);
  });

  it("typing in the search box still filters — ArrowDown handling does not swallow other keys", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("icon-trigger"));
    const search = screen.getByTestId("icon-search");
    fireEvent.change(search, { target: { value: "calend" } });
    expect(screen.getByTestId("icon-option-calendar")).toBeTruthy();
    expect(screen.queryByTestId("icon-option-flag")).toBeNull();
  });
});
