// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditableTitle } from "./EditableTitle.tsx";
import type { FieldFailure } from "./fieldFailure.ts";

/**
 * L1 — the title is editable in place, closing the GUI's core/surface
 * parity hole (core/CLI/MCP can all rename via `title`; the detail page
 * could not).
 *
 * These render the real component and assert on the DOM the user drives:
 * open → commit / revert / empty-refused, the K26 key fallback, and the
 * shared field-failure notice under the heading.
 */

afterEach(cleanup);

function renderTitle(overrides: {
  title?: string | undefined;
  taskKey?: string;
  onCommit?: (t: string) => void;
  error?: FieldFailure;
}) {
  const onCommit = overrides.onCommit ?? vi.fn();
  const title = "title" in overrides ? overrides.title : "A task";
  render(
    <EditableTitle
      title={title}
      taskKey={overrides.taskKey ?? "T-1"}
      onCommit={onCommit}
      {...(overrides.error !== undefined ? { error: overrides.error } : {})}
    />,
  );
  return { onCommit };
}

describe("L1 — editable title", () => {
  // @verifies L1
  it("opens an input seeded with the current title on click", () => {
    renderTitle({ title: "Ship the thing" });
    expect(screen.queryByTestId("task-title-input")).toBeNull();
    fireEvent.click(screen.getByTestId("task-title-edit"));
    const input = screen.getByTestId<HTMLInputElement>("task-title-input");
    expect(input.value).toBe("Ship the thing");
  });

  // @verifies L1
  it("commits the new title on Enter", () => {
    const { onCommit } = renderTitle({ title: "Old" });
    fireEvent.click(screen.getByTestId("task-title-edit"));
    const input = screen.getByTestId("task-title-input");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("New title");
  });

  // @verifies L1
  it("commits on blur", () => {
    const { onCommit } = renderTitle({ title: "Old" });
    fireEvent.click(screen.getByTestId("task-title-edit"));
    const input = screen.getByTestId("task-title-input");
    fireEvent.change(input, { target: { value: "Blurred" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("Blurred");
  });

  // @verifies L1
  it("reverts on Escape without committing", () => {
    const { onCommit } = renderTitle({ title: "Keep me" });
    fireEvent.click(screen.getByTestId("task-title-edit"));
    const input = screen.getByTestId("task-title-input");
    fireEvent.change(input, { target: { value: "discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    // Back to the read state, still showing the original title.
    expect(screen.queryByTestId("task-title-input")).toBeNull();
    expect(screen.getByTestId("task-title-edit").textContent).toBe("Keep me");
  });

  // @verifies L1
  it("does not write an unchanged title", () => {
    const { onCommit } = renderTitle({ title: "Same" });
    fireEvent.click(screen.getByTestId("task-title-edit"));
    const input = screen.getByTestId("task-title-input");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  // @verifies L1
  it("refuses an empty (whitespace-only) title and keeps the input open", () => {
    // Core requires a non-empty title. An empty draft must not be sent and
    // must not blank the heading.
    const { onCommit } = renderTitle({ title: "Not blank" });
    fireEvent.click(screen.getByTestId("task-title-edit"));
    const input = screen.getByTestId("task-title-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    // Still editing; the draft has snapped back to the original value.
    const stillOpen = screen.getByTestId<HTMLInputElement>("task-title-input");
    expect(stillOpen.value).toBe("Not blank");
  });

  // @verifies L1 / K26
  it("falls back to the key when the title is absent (K26)", () => {
    renderTitle({ title: undefined, taskKey: "T-42" });
    expect(screen.getByTestId("task-title-edit").textContent).toBe("T-42");
  });

  // @verifies L1 / K26
  it("seeds the input from the real (empty) title, not the key fallback", () => {
    // Editing an untitled task must let the user type a real title over an
    // empty box — not over the key, which would store the key as the title.
    renderTitle({ title: undefined, taskKey: "T-42" });
    fireEvent.click(screen.getByTestId("task-title-edit"));
    expect(screen.getByTestId<HTMLInputElement>("task-title-input").value).toBe("");
  });

  // @verifies L1
  it("renders a rejection under the heading via the shared notice", () => {
    const failure: FieldFailure = {
      field: "title",
      message: "Title cannot be empty.",
      dataState: "not_saved",
    } as unknown as FieldFailure;
    renderTitle({ title: "A task", error: failure });
    expect(screen.getByTestId("meta-field-error")).not.toBeNull();
  });
});
