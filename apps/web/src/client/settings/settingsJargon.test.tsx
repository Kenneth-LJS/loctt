// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** The visible text of the <option> for a given stored value. */
function optionLabel(selectTestId: string, value: string): string | null {
  const select = screen.getByTestId(selectTestId);
  const opt = select.querySelector<HTMLOptionElement>(`option[value="${value}"]`);
  return opt?.textContent ?? null;
}

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
    const select = screen.getByTestId("relationships-entry-graph");
    expect(select.textContent).not.toContain("acyclic");
  });

  it("still stores the raw key as the option value", () => {
    renderDialog();
    const select = screen.getByTestId<HTMLSelectElement>("relationships-entry-graph");
    const values = Array.from(select.querySelectorAll("option")).map(o => o.value);
    expect(values).toEqual(["none", "acyclic", "tree"]);
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
    const select = screen.getByTestId("custom-field-dialog-type");
    expect(select.textContent).not.toContain("boolean");
  });

  it("still stores the raw key as the option value", () => {
    renderDialog();
    const select = screen.getByTestId<HTMLSelectElement>("custom-field-dialog-type");
    const values = Array.from(select.querySelectorAll("option")).map(o => o.value);
    expect(values).toEqual(["string", "number", "date", "boolean", "enum"]);
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
    const select = screen.getByTestId("estimation-unit");
    expect(select.textContent).not.toContain("custom_numeric");
    expect(select.textContent).not.toContain("custom_enum");
    // ...and the stored values are still the raw keys.
    const values = Array.from(
      select.querySelectorAll("option"),
    ).map(o => o.value);
    expect(values).toContain("custom_numeric");
    expect(values).toContain("custom_enum");
  });

  it("does not leak custom_enum in the panel description", async () => {
    const { container } = render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-unit");
    expect(container.textContent).not.toContain("custom_enum");
  });
});
