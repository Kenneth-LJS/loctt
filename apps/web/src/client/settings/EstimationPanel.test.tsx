// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EstimationPanel } from "./EstimationPanel.tsx";

/**
 * Part B: the estimation `scale` select and, for custom_enum, the
 * per-category `weights` inputs. Both fields are stored + seeded into the
 * draft but had no control. The assertions turn on the PUT body — what the
 * panel writes to `estimation` — since a layer in between could repair a
 * wrong value.
 */

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function baseWorkflow(estimation?: WorkflowConfig["estimation"]): WorkflowConfig {
  return {
    key: { prefix: "T-" },
    statuses: [{ key: "todo", label: "Todo", category: "pending", default: true }],
    priorities: [],
    task_types: [],
    relationships: [],
    custom_fields: [],
    ...(estimation !== undefined ? { estimation } : {}),
  } as WorkflowConfig;
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

function mockWorkflow(workflow: WorkflowConfig): { putBodies: unknown[] } {
  const putBodies: unknown[] = [];
  fetchMock.mockImplementation((url: unknown, init?: unknown): Promise<Response> => {
    const u = String(url);
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    if (u.includes("/api/workflow") && method === "PUT") {
      const body = (init as { body?: string }).body;
      putBodies.push(body !== undefined ? JSON.parse(body) : undefined);
      return Promise.resolve(jsonResponse({ rewrittenTaskCount: 0 }));
    }
    if (u.includes("/api/workflow/usage")) return Promise.resolve(jsonResponse({}));
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("EstimationPanel — scale", () => {
  it("has a scale select and persists the chosen scale", async () => {
    const { putBodies } = mockWorkflow(baseWorkflow({ enabled: true, unit: "points" }));
    render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-panel");

    fireEvent.change(screen.getByTestId("estimation-scale"), { target: { value: "fibonacci" } });
    fireEvent.click(screen.getByTestId("estimation-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.estimation?.scale).toBe("fibonacci");
  });

  it("drops the scale key when set back to free (the implicit default)", async () => {
    const { putBodies } = mockWorkflow(baseWorkflow({ enabled: true, unit: "points", scale: "linear" }));
    render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-panel");

    // Seeded from the stored scale.
    expect(screen.getByTestId<HTMLSelectElement>("estimation-scale").value).toBe("linear");
    fireEvent.change(screen.getByTestId("estimation-scale"), { target: { value: "free" } });
    fireEvent.click(screen.getByTestId("estimation-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.estimation).not.toHaveProperty("scale");
  });
});

describe("EstimationPanel — weights (custom_enum)", () => {
  it("shows a weight input per preset value and persists the entered weights", async () => {
    const { putBodies } = mockWorkflow(baseWorkflow({
      enabled: true,
      unit: "custom_enum",
      unit_label: "T-shirt",
      preset_values: ["S", "M", "L"],
    }));
    render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-panel");

    // One input per preset value.
    await screen.findByTestId("estimation-weights");
    expect(screen.getByTestId("estimation-weight-S")).toBeTruthy();
    expect(screen.getByTestId("estimation-weight-M")).toBeTruthy();
    expect(screen.getByTestId("estimation-weight-L")).toBeTruthy();

    fireEvent.change(screen.getByTestId("estimation-weight-S"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("estimation-weight-M"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("estimation-weight-L"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("estimation-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.estimation?.weights).toEqual({ S: 1, M: 3, L: 5 });
  });

  it("clearing every weight drops the map entirely (an empty map is rejected)", async () => {
    const { putBodies } = mockWorkflow(baseWorkflow({
      enabled: true,
      unit: "custom_enum",
      unit_label: "T-shirt",
      preset_values: ["S"],
      weights: { S: 1 },
    }));
    render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-panel");

    // Seeded from the stored weight.
    expect(screen.getByTestId<HTMLInputElement>("estimation-weight-S").value).toBe("1");
    fireEvent.change(screen.getByTestId("estimation-weight-S"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("estimation-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.estimation).not.toHaveProperty("weights");
  });

  it("shows no weights control for a non-enum unit", async () => {
    mockWorkflow(baseWorkflow({ enabled: true, unit: "points" }));
    render(<EstimationPanel />, { wrapper: wrapper() });
    await screen.findByTestId("estimation-panel");
    expect(screen.queryByTestId("estimation-weights")).toBeNull();
  });
});
