// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { shouldNavigateRow } from "./rowNavigation.ts";

/**
 * UI-12. `shouldNavigateRow` is the guard behind "whole row clickable"
 * for both the main task list and MilestoneDetail's task table — see
 * rowNavigation.ts's docstring for why this is a guarded `<tr onClick>`
 * rather than a stretched-link `<a>`.
 */

function baseEvent(overrides: Partial<{
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}> = {}) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  row.appendChild(cell);
  return {
    target: cell,
    currentTarget: row,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

describe("shouldNavigateRow", () => {
  it("navigates on a plain primary click on a non-interactive cell", () => {
    expect(shouldNavigateRow(baseEvent())).toBe(true);
  });

  // @verifies LST-5 (modifier-click / middle-click must not navigate in
  // place — the row's own handler cannot open a background tab, so it
  // must get out of the way and let the key cell's real <Link> handle it)
  it.each([
    ["metaKey", { metaKey: true }],
    ["ctrlKey", { ctrlKey: true }],
    ["shiftKey", { shiftKey: true }],
    ["altKey", { altKey: true }],
  ])("does not navigate on a %s click", (_name, overrides) => {
    expect(shouldNavigateRow(baseEvent(overrides))).toBe(false);
  });

  it("does not navigate on a middle-click (button 1)", () => {
    expect(shouldNavigateRow(baseEvent({ button: 1 }))).toBe(false);
  });

  it("does not navigate on a right-click (button 2)", () => {
    expect(shouldNavigateRow(baseEvent({ button: 2 }))).toBe(false);
  });

  // @verifies LST-5 (an interactive child — kebab, checkbox, a link —
  // must not also trigger the row's own navigation)
  it("does not navigate when the click target is inside a link", () => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const link = document.createElement("a");
    cell.appendChild(link);
    row.appendChild(cell);
    expect(shouldNavigateRow(baseEvent({ target: link, currentTarget: row }))).toBe(false);
  });

  it("does not navigate when the click target is inside a button", () => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const button = document.createElement("button");
    cell.appendChild(button);
    row.appendChild(cell);
    expect(shouldNavigateRow(baseEvent({ target: button, currentTarget: row }))).toBe(false);
  });

  it("does not navigate when the click target is inside an input (checkbox)", () => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "checkbox";
    cell.appendChild(input);
    row.appendChild(cell);
    expect(shouldNavigateRow(baseEvent({ target: input, currentTarget: row }))).toBe(false);
  });

  // @verifies LST-5 (dragging to select text inside a cell must not
  // navigate on mouseup/click)
  it("does not navigate when the click leaves a non-empty text selection", () => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.textContent = "Some task title";
    row.appendChild(cell);
    document.body.appendChild(row);

    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(shouldNavigateRow(baseEvent({ target: cell, currentTarget: row }))).toBe(false);

    document.body.removeChild(row);
  });

  it("navigates when the selection is collapsed (a plain click, no drag)", () => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.textContent = "Some task title";
    row.appendChild(cell);
    document.body.appendChild(row);

    // A plain click collapses any prior selection to a caret — empty text.
    window.getSelection()?.removeAllRanges();

    expect(shouldNavigateRow(baseEvent({ target: cell, currentTarget: row }))).toBe(true);

    document.body.removeChild(row);
  });
});
