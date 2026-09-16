// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReconcileConflict, ReconcileDeleteVsEdit } from "../api/hooks/useGit.ts";
import { ConflictRow, DeleteVsEditRow } from "./ReconcilePanel.tsx";

/**
 * @verifies Batch-2 a11y (ReconcilePanel pick-value control label)
 *
 * The pick-value select/input had no accessible name — the field name
 * beside it was a plain `<div>` with no `id`, so neither control was
 * associated with it. This wires the field-name element via `useId()`
 * + `aria-labelledby`, so the control announces the field it belongs
 * to.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function enumConflict(): ReconcileConflict {
  return {
    taskId: "01ABC",
    taskKey: "T-1",
    taskTitle: "Some task",
    field: "status",
    fieldLabel: "Status",
    kind: "enum",
    local: { raw: "Todo", display: "Todo" },
    remote: { raw: "Doing", display: "Doing" },
    options: [
      { key: "todo", label: "Todo" },
      { key: "doing", label: "Doing" },
    ],
  };
}

function scalarConflict(): ReconcileConflict {
  return {
    taskId: "01ABC",
    taskKey: "T-1",
    taskTitle: "Some task",
    field: "title",
    fieldLabel: "Title",
    kind: "scalar",
    local: { raw: "Local title", display: "Local title" },
    remote: { raw: "Remote title", display: "Remote title" },
  };
}

describe("ReconcilePanel pick-value control has an accessible name", () => {
  it("labels the enum picker with the field name", () => {
    render(<ConflictRow conflict={enumConflict()} decision={undefined} onChoose={() => {}} />);
    // getByRole with a name only matches when the control has an
    // accessible name — which is exactly the association under test.
    const select = screen.getByRole("combobox", { name: "Status" });
    expect(select).toBeDefined();
  });

  it("labels the scalar free-text input with the field name", () => {
    render(<ConflictRow conflict={scalarConflict()} decision={undefined} onChoose={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input).toBeDefined();
  });
});

/**
 * @verifies GIT-16
 *
 * A delete-vs-edit row states which side deleted and which edited, and
 * offers keep-the-deletion / keep-the-task. The chosen side is the winning
 * side: keep-deletion = the deleting side, keep-task = the editing side.
 */
describe("ReconcilePanel delete-vs-edit row (GIT-16)", () => {
  function dveRow(): ReconcileDeleteVsEdit {
    return {
      taskId: "01ABC",
      taskKey: "T-1",
      taskTitle: "Contested",
      deletedSide: "remote",
      editedSide: "local",
    };
  }

  it("names which side deleted and which edited", () => {
    render(<DeleteVsEditRow row={dveRow()} choice={undefined} onChoose={() => {}} />);
    const desc = screen.getByTestId("git-reconcile-dve-desc");
    expect(desc.textContent).toMatch(/deleted on the remote side/);
    expect(desc.textContent).toMatch(/edited on the local side/);
  });

  it("keep-deletion chooses the deleting side; keep-task chooses the editing side", () => {
    const onChoose = vi.fn();
    render(<DeleteVsEditRow row={dveRow()} choice={undefined} onChoose={onChoose} />);
    // deletedSide is "remote" → keep-deletion must report "remote".
    fireEvent.click(screen.getByTestId("git-reconcile-dve-keep-deletion"));
    expect(onChoose).toHaveBeenCalledWith("remote");
    // editedSide is "local" → keep-task must report "local".
    fireEvent.click(screen.getByTestId("git-reconcile-dve-keep-task"));
    expect(onChoose).toHaveBeenCalledWith("local");
  });

  it("marks the chosen keep-task and warns a colliding key will confirm a renumber", () => {
    // choice === editedSide ("local") means keep-task.
    render(<DeleteVsEditRow row={dveRow()} choice="local" onChoose={() => {}} />);
    const decided = screen.getByTestId("git-reconcile-dve-decided");
    expect(decided.textContent).toMatch(/keeping the task/);
    expect(decided.textContent).toMatch(/confirm a renumber/);
  });
});
