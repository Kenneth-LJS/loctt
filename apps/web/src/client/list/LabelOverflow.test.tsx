// @vitest-environment jsdom
/**
 * MSL-20's second bullet (K12): the `+N` affordance reveals the
 * remaining labels and each stays individually clickable to filter.
 *
 * Before K12 the affordance was a `<span title="...">`: not focusable,
 * not announced, and the hidden labels were a tooltip string rather
 * than controls. These pin the four properties that made it a defect —
 * that the reveal happens, that a revealed label filters, that Escape
 * closes it and hands focus back, and that a click outside dismisses.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabelsCell } from "./cells.tsx";

afterEach(cleanup);

const LABELS = [
  { id: "l1", name: "alpha", color: "#ff0000" },
  { id: "l2", name: "bravo", color: "#00ff00" },
  { id: "l3", name: "charlie", color: "#0000ff" },
  { id: "l4", name: "delta", color: "#ffff00" },
  { id: "l5", name: "echo", color: "#ff00ff" },
];

describe("LabelsCell overflow reveal", () => {
  // @verifies MSL-20
  it("hides labels past the cap behind a +N trigger, revealed on click", () => {
    render(<LabelsCell labels={LABELS} onFilter={() => undefined} />);

    // Capped: the first three are pills, the rest are not on screen.
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.queryByText("delta")).toBeNull();
    expect(screen.queryByText("echo")).toBeNull();

    const trigger = screen.getByTestId("label-overflow-trigger");
    expect(trigger.textContent).toBe("+2");
    // The trigger is a real control, not a span with a title.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);

    expect(screen.getByTestId("label-overflow-panel")).toBeTruthy();
    expect(screen.getByText("delta")).toBeTruthy();
    expect(screen.getByText("echo")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  // @verifies MSL-20
  it("a revealed label filters on click, exactly as a visible pill does", () => {
    const onFilter = vi.fn();
    render(<LabelsCell labels={LABELS} onFilter={onFilter} />);

    // The visible pill's behaviour, as the control.
    fireEvent.click(screen.getByText("alpha"));
    expect(onFilter).toHaveBeenCalledWith("l1");
    onFilter.mockClear();

    fireEvent.click(screen.getByTestId("label-overflow-trigger"));
    const revealed = screen.getByText("echo");
    // Not a text node in a tooltip — a button, like the visible ones.
    expect(revealed.closest("button")).not.toBeNull();
    fireEvent.click(revealed);
    expect(onFilter).toHaveBeenCalledWith("l5");
  });

  // @verifies MSL-20
  it("Escape closes the reveal and returns focus to the trigger", () => {
    render(<LabelsCell labels={LABELS} onFilter={() => undefined} />);
    const trigger = screen.getByTestId("label-overflow-trigger");
    fireEvent.click(trigger);
    expect(screen.queryByTestId("label-overflow-panel")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("label-overflow-panel")).toBeNull();
    // flow-accessibility: Esc returns focus to the control that opened
    // the layer, never to document.body.
    expect(document.activeElement).toBe(trigger);
  });

  // @verifies MSL-20
  it("a pointer-down outside dismisses the reveal", () => {
    render(<LabelsCell labels={LABELS} onFilter={() => undefined} />);
    fireEvent.click(screen.getByTestId("label-overflow-trigger"));
    expect(screen.queryByTestId("label-overflow-panel")).not.toBeNull();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByTestId("label-overflow-panel")).toBeNull();
  });

  // @verifies MSL-20
  it("no +N trigger at or below the cap", () => {
    render(<LabelsCell labels={LABELS.slice(0, 3)} onFilter={() => undefined} />);
    expect(screen.queryByTestId("label-overflow-trigger")).toBeNull();
    expect(screen.getByText("charlie")).toBeTruthy();
  });
});
