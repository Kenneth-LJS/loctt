// @vitest-environment jsdom
import type { WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardColumnsPanel } from "./BoardColumnsPanel.tsx";

/**
 * Board columns panel (BRD-2, K8). Edits the SHARED
 * `workflow.boards.columns` block. Assertions turn on the request the
 * panel PUTs (the whole document, boards block replaced) and on the
 * inline validation that mirrors BoardsConfigSchema.superRefine (a status
 * may be in only one column).
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

const BASE: WorkflowConfig = {
  key: { prefix: "T-" },
  statuses: [
    { key: "backlog", label: "Backlog", category: "pending", default: true },
    { key: "doing", label: "In progress", category: "active" },
    { key: "done", label: "Done", category: "completed" },
  ],
  priorities: [{ key: "low", label: "Low", value: 10 }],
  task_types: [{ key: "task", label: "Task" }],
  relationships: [],
  custom_fields: [],
};

const USAGE = { path: "/abs/.loctt/config/workflow.yaml", statuses: { backlog: 0, doing: 0, done: 0 }, priorities: { low: 0 }, task_types: { task: 0 }, relationships: {} };

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

describe("BoardColumnsPanel", () => {
  it("shows the implicit board and a promote button when no columns are configured", async () => {
    mockWorkflow(BASE);
    render(<BoardColumnsPanel />, { wrapper: wrapper() });

    expect(await screen.findByTestId("board-implicit-note")).toBeTruthy();
    const chips = screen.getByTestId("board-implicit-columns");
    expect(chips.textContent).toContain("Backlog");
    expect(chips.textContent).toContain("In progress");
    expect(screen.getByTestId("board-promote")).toBeTruthy();
  });

  it("promotes the implicit board into per-status editable columns", async () => {
    mockWorkflow(BASE);
    render(<BoardColumnsPanel />, { wrapper: wrapper() });

    fireEvent.click(await screen.findByTestId("board-promote"));
    const list = await screen.findByTestId("board-columns-list");
    // One column per status, pre-filled from the implicit board.
    expect(list.getAttribute("data-count")).toBe("3");
    expect((screen.getByTestId<HTMLInputElement>("board-column-label-backlog")).value).toBe("Backlog");
    expect((screen.getByTestId<HTMLInputElement>("board-column-backlog-status-backlog")).checked).toBe(true);
  });

  it("loads existing configured columns directly (no promote step)", async () => {
    mockWorkflow({
      ...BASE,
      boards: { columns: [{ key: "todo", label: "To do", statuses: ["backlog", "doing"] }, { key: "closed", label: "Closed", statuses: ["done"] }] },
    });
    render(<BoardColumnsPanel />, { wrapper: wrapper() });

    const list = await screen.findByTestId("board-columns-list");
    expect(list.getAttribute("data-count")).toBe("2");
    expect((screen.getByTestId<HTMLInputElement>("board-column-label-todo")).value).toBe("To do");
  });

  it("blocks save and shows an error when a status is in two columns", async () => {
    const { putBodies } = mockWorkflow({
      ...BASE,
      boards: { columns: [{ key: "a", label: "A", statuses: ["backlog"] }, { key: "b", label: "B", statuses: ["doing"] }] },
    });
    render(<BoardColumnsPanel />, { wrapper: wrapper() });

    await screen.findByTestId("board-columns-list");
    // Add "backlog" to column B too -> duplicate.
    fireEvent.click(screen.getByTestId("board-column-b-status-backlog"));

    expect(await screen.findByTestId("board-column-problem-b")).toBeTruthy();
    const saveBtn = screen.getByTestId<HTMLButtonElement>("board-columns-save");
    expect(saveBtn.disabled).toBe(true);
    fireEvent.click(saveBtn);
    // Nothing was written.
    expect(putBodies.length).toBe(0);
  });

  it("saves the edited columns, PUTting the whole document with only boards changed", async () => {
    const { putBodies } = mockWorkflow({
      ...BASE,
      boards: { columns: [{ key: "todo", label: "To do", statuses: ["backlog"] }, { key: "closed", label: "Closed", statuses: ["done"] }] },
    });
    render(<BoardColumnsPanel />, { wrapper: wrapper() });

    await screen.findByTestId("board-columns-list");
    // Add "doing" to the "todo" column and save.
    fireEvent.click(screen.getByTestId("board-column-todo-status-doing"));
    fireEvent.click(screen.getByTestId("board-columns-save"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    const cols = put.workflow.boards?.columns ?? [];
    expect(cols.find(c => c.key === "todo")?.statuses).toEqual(["backlog", "doing"]);
    // The rest of the document is intact.
    expect(put.workflow.statuses).toEqual(BASE.statuses);
  });

  it("reset writes an undefined boards block (back to one column per status)", async () => {
    const { putBodies } = mockWorkflow({
      ...BASE,
      boards: { columns: [{ key: "todo", label: "To do", statuses: ["backlog"] }, { key: "d", label: "Done", statuses: ["done"] }] },
    });
    render(<BoardColumnsPanel />, { wrapper: wrapper() });

    await screen.findByTestId("board-columns-list");
    fireEvent.click(screen.getByTestId("board-columns-reset"));

    await waitFor(() => { expect(putBodies.length).toBe(1); });
    const put = putBodies[0] as { workflow: WorkflowConfig };
    expect(put.workflow.boards).toBeUndefined();
  });
});
