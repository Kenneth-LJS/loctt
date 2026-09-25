// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comboOptions, comboValue, expectComboValueSelectable, pickCombo } from "../ui/selectComboboxTestUtils.ts";
import { TimelinePanel } from "./TimelinePanel.tsx";

/**
 * Timeline defaults panel (TML-14). The panel authors the persisted
 * timeline defaults and saves through the generic whole-document workflow
 * write. Assertions turn on the REQUEST the panel issues (the whole
 * augmented document with only the `timeline` block changed) and on the
 * dangling-relationship affordance (A31/TML-34: a stored dependency key
 * that no longer exists is preserved + warned, not dropped or blocked).
 */

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE: WorkflowConfig = {
  key: { prefix: "T-" },
  statuses: [{ key: "todo", label: "To do", category: "pending", default: true }],
  priorities: [{ key: "low", label: "Low", value: 10 }],
  task_types: [{ key: "task", label: "Task" }],
  relationships: [
    {
      key: "blocks", label: "Blocks", kind: "directional",
      inverse: "blocked_by", inverse_label: "Blocked by",
    },
  ],
  custom_fields: [],
};

const USAGE = { path: "/abs/.loctt/config/workflow.yaml", statuses: { todo: 0 }, priorities: { low: 0 }, task_types: { task: 0 }, relationships: { blocks: 0 } };

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

function mockWorkflow(workflow: WorkflowConfig): { putBodies: unknown[] } {
  const putBodies: unknown[] = [];
  fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
    const u = String(url);
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (u.includes("/api/workflow/usage")) return Promise.resolve(jsonResponse(USAGE));
    if (u.includes("/api/workflow") && method === "PUT") {
      const body = (init as { body?: string }).body;
      putBodies.push(body !== undefined ? JSON.parse(body) : undefined);
      return Promise.resolve(jsonResponse({ rewrittenTaskCount: 0 }));
    }
    if (u.includes("/api/workflow")) return Promise.resolve(jsonResponse(workflow));
    return Promise.resolve(jsonResponse({}, 404));
  });
  return { putBodies };
}

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TimelinePanel", () => {
  it("renders the stored timeline defaults", async () => {
    mockWorkflow({
      ...BASE,
      timeline: { default_zoom: "month", default_grouping: "milestone", show_arrows: false, dependency_relationship: "blocks" },
    });
    render(<TimelinePanel />, { wrapper: wrapper() });

    await screen.findByTestId("timeline-default-zoom");
    expectComboValueSelectable("timeline-default-zoom", "month");
    // Grouping is no longer a native <select> — it is the shared
    // searchable GroupByPicker, whose selected value is exposed on the
    // trigger as `data-value` (asserting `.value` here was asserting the
    // pre-redesign control).
    expect(screen.getByTestId("timeline-default-grouping").getAttribute("data-value")).toBe("milestone");
    expect(screen.getByTestId<HTMLInputElement>("timeline-show-arrows").checked).toBe(false);
    expectComboValueSelectable("timeline-dependency-relationship", "blocks");
  });

  it("saves the edited defaults, PUTting the whole document with only the timeline block changed", async () => {
    const { putBodies } = mockWorkflow({ ...BASE, timeline: { default_zoom: "week" } });
    render(<TimelinePanel />, { wrapper: wrapper() });

    await screen.findByTestId("timeline-default-zoom");
    pickCombo("timeline-default-zoom", "day");
    // Open the GroupByPicker and click the option row (the redesigned
    // control; `fireEvent.change` on a <select> no longer applies).
    fireEvent.click(screen.getByTestId("timeline-default-grouping"));
    fireEvent.click(screen.getByTestId("timeline-default-grouping-opt-assignee"));
    fireEvent.click(screen.getByTestId("timeline-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    // Only the timeline block changed; the rest of the document is intact.
    expect(put.workflow.timeline?.default_zoom).toBe("day");
    expect(put.workflow.timeline?.default_grouping).toBe("assignee");
    expect(put.workflow.statuses).toEqual(BASE.statuses);
    expect(put.workflow.relationships).toEqual(BASE.relationships);
  });

  it("warns about a dangling dependency relationship but keeps it (does not block save or drop it)", async () => {
    // `depends_on` is stored but is NOT among relationships (only `blocks` is).
    const { putBodies } = mockWorkflow({
      ...BASE,
      timeline: { dependency_relationship: "depends_on" },
    });
    render(<TimelinePanel />, { wrapper: wrapper() });

    // The warning is shown...
    expect(await screen.findByTestId("timeline-dependency-unresolvable")).toBeTruthy();
    // ...the dangling value is still selected (not silently dropped)...
    expect(comboValue("timeline-dependency-relationship")).toBe("depends_on");
    // ...and it is genuinely OFFERED, labelled as defunct, so the user can
    // see and change it. `data-value` alone echoes the draft state and
    // would read "depends_on" even with the option dropped — a native
    // <select>'s `.value` could not, so asserting only the value above
    // stopped covering A31/TML-34 the moment the control became a button.
    expect(comboOptions("timeline-dependency-relationship"))
      .toContainEqual({ value: "depends_on", label: "depends_on (no longer defined)" });
    // ...and Save is NOT blocked — the dangle is preserved on the wire (A31).
    fireEvent.click(screen.getByTestId("timeline-save"));
    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.timeline?.dependency_relationship).toBe("depends_on");
  });

  it("clearing the dependency relationship omits the field", async () => {
    const { putBodies } = mockWorkflow({ ...BASE, timeline: { dependency_relationship: "blocks" } });
    render(<TimelinePanel />, { wrapper: wrapper() });

    await screen.findByTestId("timeline-dependency-relationship");
    pickCombo("timeline-dependency-relationship", "");
    fireEvent.click(screen.getByTestId("timeline-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.timeline?.dependency_relationship).toBeUndefined();
  });
});
