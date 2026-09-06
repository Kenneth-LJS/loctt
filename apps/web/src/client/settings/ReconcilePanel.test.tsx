// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ReconcileConflict } from "../api/hooks/useGit.ts";
import { ConflictRow } from "./ReconcilePanel.tsx";

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
