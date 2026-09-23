// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArchivedScopeControl } from "./ArchivedScopeControl.tsx";

afterEach(cleanup);

/**
 * The one shared tri-state archived-scope control (K107, resegmented
 * 2026-09-22). These pin the three options, the value/onChange contract,
 * the testid, and — now that the native `<select>` is gone — the
 * accessibility model that replaced what the select gave for free:
 * radiogroup semantics, an accessible group name, roving `tabIndex`, and
 * arrow-key selection-follows-focus.
 */
describe("ArchivedScopeControl", () => {
  /** Re-render at a new value, as a controlled parent would. */
  const renderControlled = (initial: "active" | "archived" | "all" = "active") => {
    const onChange = vi.fn();
    const view = render(
      <ArchivedScopeControl value={initial} onChange={onChange} testId="scope" />,
    );
    return { onChange, view };
  };

  it("offers exactly the three scopes in order", () => {
    render(<ArchivedScopeControl value="active" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map(r => r.getAttribute("data-scope"))).toEqual(["active", "archived", "all"]);
    expect(radios.map(r => r.textContent)).toEqual(["Active", "Archived", "All"]);
  });

  it("reflects the current value and reports the picked scope", () => {
    const { onChange } = renderControlled("active");
    const group = screen.getByTestId("scope");
    expect(group.getAttribute("data-value")).toBe("active");
    fireEvent.click(screen.getByTestId("scope-archived"));
    expect(onChange).toHaveBeenCalledWith("archived");
  });

  it("appends per-scope counts to the segment label when given", () => {
    render(<ArchivedScopeControl value="active" onChange={() => {}} counts={{ archived: 3 }} />);
    expect(screen.getAllByRole("radio").map(r => r.textContent))
      .toEqual(["Active", "Archived (3)", "All"]);
  });

  // The `<select>`'s implicit name is gone; the group must be named by the
  // visible label, or a screen reader announces three unattached radios.
  it("names the group with the visible label", () => {
    render(<ArchivedScopeControl value="all" onChange={() => {}} testId="scope" label="Show items" />);
    const group = screen.getByRole("radiogroup", { name: "Show items" });
    expect(group).toBe(screen.getByTestId("scope"));
    expect(screen.getByText("Show items").id).toBe(group.getAttribute("aria-labelledby"));
  });

  // What `<select>`'s `value` used to answer. `aria-checked` is the only
  // thing a screen reader reads to tell the user which scope is on.
  it("tracks the checked scope with aria-checked", () => {
    const { view } = renderControlled("archived");
    expect(screen.getAllByRole("radio").map(r => r.getAttribute("aria-checked")))
      .toEqual(["false", "true", "false"]);
    view.rerender(<ArchivedScopeControl value="all" onChange={() => {}} testId="scope" />);
    expect(screen.getAllByRole("radio").map(r => r.getAttribute("aria-checked")))
      .toEqual(["false", "false", "true"]);
  });

  // A single tab stop. Without roving tabIndex the group costs three Tabs
  // to walk past — the regression a `tabIndex={0}` on every segment causes.
  it("keeps one tab stop: only the checked segment is tabbable", () => {
    const { view } = renderControlled("active");
    expect(screen.getAllByRole("radio").map(r => r.getAttribute("tabindex")))
      .toEqual(["0", "-1", "-1"]);
    view.rerender(<ArchivedScopeControl value="all" onChange={() => {}} testId="scope" />);
    expect(screen.getAllByRole("radio").map(r => r.getAttribute("tabindex")))
      .toEqual(["-1", "-1", "0"]);
  });

  // Selection-follows-focus: in a radiogroup an arrow key both MOVES and
  // SELECTS. Moving focus without calling onChange would leave the visible
  // focus and the applied filter disagreeing.
  it("moves focus and selection together on ArrowRight/ArrowLeft", () => {
    const { onChange } = renderControlled("active");
    const [first, second, third] = screen.getAllByRole("radio");
    first?.focus();

    fireEvent.keyDown(screen.getByTestId("scope"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(onChange).toHaveBeenLastCalledWith("archived");

    // Wraps backwards off the first segment to the last.
    first?.focus();
    fireEvent.keyDown(screen.getByTestId("scope"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(third);
    expect(onChange).toHaveBeenLastCalledWith("all");
  });

  it("treats ArrowDown/ArrowUp the same as Right/Left", () => {
    const { onChange } = renderControlled("active");
    const [first, second] = screen.getAllByRole("radio");
    first?.focus();
    fireEvent.keyDown(screen.getByTestId("scope"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    expect(onChange).toHaveBeenLastCalledWith("archived");
  });

  it("jumps to the first and last scope on Home/End", () => {
    const { onChange } = renderControlled("archived");
    const [first, second, third] = screen.getAllByRole("radio");
    second?.focus();

    fireEvent.keyDown(screen.getByTestId("scope"), { key: "End" });
    expect(document.activeElement).toBe(third);
    expect(onChange).toHaveBeenLastCalledWith("all");

    fireEvent.keyDown(screen.getByTestId("scope"), { key: "Home" });
    expect(document.activeElement).toBe(first);
    expect(onChange).toHaveBeenLastCalledWith("active");
  });

  it("does not re-fire onChange when the already-checked scope is picked", () => {
    const { onChange } = renderControlled("active");
    fireEvent.click(screen.getByTestId("scope-active"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables every segment and announces the group as disabled", () => {
    const onChange = vi.fn();
    render(
      <ArchivedScopeControl value="active" onChange={onChange} testId="scope" disabled />,
    );
    const group = screen.getByTestId("scope");
    expect(group.getAttribute("aria-disabled")).toBe("true");
    for (const r of screen.getAllByRole("radio")) {
      expect((r as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
