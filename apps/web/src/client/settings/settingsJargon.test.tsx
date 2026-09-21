// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  comboOptionLabel,
  comboOptionsText,
  comboValues,
} from "../ui/selectComboboxTestUtils.ts";
import { CustomFieldEditDialog } from "./CustomFieldEditDialog.tsx";
import { EstimationPanel } from "./EstimationPanel.tsx";
import { RelationshipEditDialog } from "./RelationshipEditDialog.tsx";

/**
 * Jargon leaks — raw enum/type tokens shown verbatim to the user.
 *
 * Each of these controls listed its stored config keys as the visible
 * option text (`custom_enum`, `acyclic`, `boolean`, …), which read as
 * machine tokens rather than choices. The fix is display-only: the
 * OPTION label is human, the option VALUE (what gets stored) is still the
 * raw key.
 *
 * Every assertion has a red-proof: it checks both that the friendly label
 * is present AND that the raw token is not — so reverting the label map
 * makes the "friendly present" half go red, and dropping the `value=`
 * mapping makes the "value is still the key" half go red.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * The visible text the dropdown shows for a given stored value.
 *
 * K106 turned these controls from native `<select>`s into listbox
 * dropdowns, so the options are `role="option"` buttons rather than
 * `<option>` elements and only exist while the panel is open — the
 * label/value pair is read through the shared helper instead.
 */
const optionLabel = comboOptionLabel;

describe("RelationshipEditDialog — graph constraint labels are human", () => {
  function renderDialog() {
    render(
      <RelationshipEditDialog
        mode="create"
        existingKeys={[]}
        pending={false}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );
  }

  it("shows friendly graph labels, not the raw tokens", () => {
    renderDialog();
    expect(optionLabel("relationships-entry-graph", "none")).toBe("No constraint");
    expect(optionLabel("relationships-entry-graph", "acyclic")).toBe("No cycles allowed");
    expect(optionLabel("relationships-entry-graph", "tree")).toBe("Strict hierarchy (one parent)");
    // Red-proof: the bare tokens must not be the visible label anymore.
    expect(comboOptionsText("relationships-entry-graph")).not.toContain("acyclic");
  });

  it("still stores the raw key as the option value", () => {
    renderDialog();
    expect(comboValues("relationships-entry-graph")).toEqual(["none", "acyclic", "tree"]);
  });
});

describe("CustomFieldEditDialog — type labels are human", () => {
  function renderDialog() {
    render(
      <CustomFieldEditDialog
        mode="create"
        existingKeys={[]}
        pending={false}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );
  }

  it("shows friendly type labels, not the raw tokens", () => {
    renderDialog();
    expect(optionLabel("custom-field-dialog-type", "string")).toBe("Text");
    expect(optionLabel("custom-field-dialog-type", "number")).toBe("Number");
    expect(optionLabel("custom-field-dialog-type", "date")).toBe("Date");
    expect(optionLabel("custom-field-dialog-type", "boolean")).toBe("Yes / No");
    expect(optionLabel("custom-field-dialog-type", "enum")).toBe("Choice list");
    expect(comboOptionsText("custom-field-dialog-type")).not.toContain("boolean");
  });

  it("still stores the raw key as the option value", () => {
    renderDialog();
    expect(comboValues("custom-field-dialog-type"))
      .toEqual(["string", "number", "date", "boolean", "enum"]);
  });
});

describe("EstimationPanel — unit labels are human", () => {
  let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

  const WORKFLOW: WorkflowConfig = {
    statuses: [{ key: "todo", label: "Todo", category: "todo" }],
    priorities: [],
    task_types: [],
    relationships: [],
  } as unknown as WorkflowConfig;

  beforeEach(() => {
    fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
    fetchMock.mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/api/workflow")) {
        return Promise.resolve(new Response(JSON.stringify(WORKFLOW), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      // useWorkflowUsage and anything else.
      return Promise.resolve(new Response(JSON.stringify({}), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function wrapper() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
  }

  it("shows friendly unit labels, not custom_numeric / custom_enum", async () => {
    render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-unit");
    expect(optionLabel("estimation-unit", "points")).toBe("Points");
    expect(optionLabel("estimation-unit", "custom_numeric")).toBe("Custom number scale");
    expect(optionLabel("estimation-unit", "custom_enum")).toBe("Custom label scale");
    // Red-proof: the raw tokens no longer appear as visible option text.
    expect(comboOptionsText("estimation-unit")).not.toContain("custom_numeric");
    expect(comboOptionsText("estimation-unit")).not.toContain("custom_enum");
    // ...and the stored values are still the raw keys.
    expect(comboValues("estimation-unit")).toContain("custom_numeric");
    expect(comboValues("estimation-unit")).toContain("custom_enum");
  });

  it("does not leak custom_enum in the panel description", async () => {
    const { container } = render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-unit");
    expect(container.textContent).not.toContain("custom_enum");
    // The options live in the panel, which is closed here — so the check
    // above no longer covers them (it did while they were <option>s in a
    // native <select>). Open it, so this still fails if the token leaks
    // back into either the prose OR the option labels.
    fireEvent.click(screen.getByTestId("estimation-unit"));
    expect(container.textContent).not.toContain("custom_enum");
  });
});
