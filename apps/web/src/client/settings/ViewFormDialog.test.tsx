// @vitest-environment jsdom
import type { Filter } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ViewFormDialog, type ViewFormTarget } from "./ViewFormDialog.tsx";

/**
 * K102. A saved view stores an ORDERED list of filters, each carrying its
 * own `kind`, and the dialog renders each one BY THAT STORED KIND:
 *
 *  - `{kind:"simple"}` → a DROPDOWN ROW (field / operator / value), always.
 *  - `{kind:"advanced"}` → query text.
 *
 * Ken's complaint is the reason these exist: *"there's this fucking
 * obsession with the QUERY... the dumb filters will go back to rendering
 * with the dumb filters in the UI"*, and *"i dont want things to swap
 * positions or whatever."* So the guards below are: kind decides the
 * rendering, order is preserved, and editing never reorders.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

const WORKFLOW = {
  statuses: [
    { key: "backlog", label: "Backlog" },
    { key: "in_progress", label: "In progress" },
  ],
  priorities: [{ key: "high", label: "High" }],
  task_types: [{ key: "bug", label: "Bug" }],
  custom_fields: [],
};

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url, init) => {
    const u = String(url);
    if (u.includes("/api/query/validate")) return Promise.resolve(jsonResponse({ valid: true }));
    if (u.endsWith("/api/views") && (init as RequestInit | undefined)?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "vNew", name: "n", filters: [] }, 201));
    }
    if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "PUT") {
      return Promise.resolve(jsonResponse({ id: "v1", name: "n", filters: [] }));
    }
    if (u.includes("/api/workflow")) return Promise.resolve(jsonResponse({ workflow: WORKFLOW }));
    // Entity pickers (projects/users/labels/milestones/sprints) — empty.
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

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

function parseBody(init: RequestInit | undefined): Record<string, unknown> | undefined {
  const body = init?.body;
  return typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : undefined;
}

function writeCalls(method: string) {
  return fetchMock.mock.calls
    .filter(c => (c[1] as RequestInit | undefined)?.method === method)
    .map(c => ({ url: String(c[0]), body: parseBody(c[1] as RequestInit | undefined) }));
}

function target(filters: Filter[]): ViewFormTarget {
  return { id: "v1", name: "Existing", filters };
}

/** The rendered rows, in DOM order. */
function rows(): HTMLElement[] {
  return screen.queryAllByTestId("view-filter-row");
}

describe("ViewFormDialog — simple filters render as dropdown rows (K102)", () => {
  it("renders a stored {kind:'simple'} filter as a DROPDOWN ROW, not as query text", async () => {
    render(
      <ViewFormDialog
        existing={target([{ kind: "simple", field: "status", op: "in", values: ["backlog"] }])}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );

    await screen.findByTestId("view-filter-field-0");

    // THE load-bearing assertion (Ken's complaint): the row is three
    // pickers. The field select holds the stored field, the operator
    // select the stored operator.
    const field = screen.getByTestId<HTMLSelectElement>("view-filter-field-0");
    expect(field.tagName).toBe("SELECT");
    expect(field.value).toBe("status");
    expect(screen.getByTestId<HTMLSelectElement>("view-filter-op-0").value).toBe("in");

    // The row is marked simple, and NO query textarea exists for it.
    expect(rows()[0]?.getAttribute("data-row-kind")).toBe("simple");
    expect(screen.queryByTestId("view-filter-query-0")).toBeNull();

    // The value picker is the SAME FilterDropdown the top filter bar
    // renders — labelled by the field, with the selection count.
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy();
  });

  it("renders a stored {kind:'advanced'} filter as query TEXT", async () => {
    render(
      <ViewFormDialog
        existing={target([{ kind: "advanced", query: 'has_link("is_blocked_by")' }])}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );

    const box = await screen.findByTestId<HTMLTextAreaElement>("view-filter-query-0");
    expect(box.value).toBe('has_link("is_blocked_by")');
    expect(rows()[0]?.getAttribute("data-row-kind")).toBe("advanced");
    // And it is NOT decomposed into pickers.
    expect(screen.queryByTestId("view-filter-field-0")).toBeNull();
  });

  it("never renders a merged DSL preview of the whole view", async () => {
    render(
      <ViewFormDialog
        existing={target([
          { kind: "simple", field: "status", op: "in", values: ["backlog"] },
          { kind: "advanced", query: "priority = high" },
        ])}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-filter-field-0");

    // The old dialog rendered a live "Query …" string for the whole view.
    // K102 removed the concept: there is no single query for a view.
    expect(screen.queryByTestId("view-qb-validation")).toBeNull();
    expect(screen.queryByTestId("query-builder")).toBeNull();
    expect(document.body.textContent).not.toContain("status IN");
  });
});

describe("ViewFormDialog — order (Ken: 'i dont want things to swap positions')", () => {
  const THREE: Filter[] = [
    { kind: "simple", field: "status", op: "in", values: ["backlog"] },
    { kind: "advanced", query: "priority = high" },
    { kind: "simple", field: "task_type", op: "in", values: ["bug"] },
  ];

  it("renders [simple, advanced, simple] in exactly that order", async () => {
    render(<ViewFormDialog existing={target(THREE)} onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-filter-field-0");

    expect(rows().map(r => r.getAttribute("data-row-kind"))).toEqual([
      "simple",
      "advanced",
      "simple",
    ]);
  });

  it("editing the MIDDLE row does not reorder the list", async () => {
    render(<ViewFormDialog existing={target(THREE)} onClose={() => {}} />, { wrapper: wrapper() });
    const box = await screen.findByTestId<HTMLTextAreaElement>("view-filter-query-1");

    fireEvent.change(box, { target: { value: "priority = low" } });

    // Still in the same positions — the edited row stayed at index 1.
    expect(rows().map(r => r.getAttribute("data-row-kind"))).toEqual([
      "simple",
      "advanced",
      "simple",
    ]);
    expect(screen.getByTestId<HTMLTextAreaElement>("view-filter-query-1").value)
      .toBe("priority = low");
    // The rows either side are untouched.
    expect(screen.getByTestId<HTMLSelectElement>("view-filter-field-0").value).toBe("status");
    expect(screen.getByTestId<HTMLSelectElement>("view-filter-field-2").value).toBe("task_type");
  });

  it("removing row N removes exactly that row, leaving the others in order", async () => {
    render(<ViewFormDialog existing={target(THREE)} onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-filter-field-0");

    // Remove the MIDDLE row.
    fireEvent.click(screen.getByTestId("view-filter-remove-1"));

    expect(rows().map(r => r.getAttribute("data-row-kind"))).toEqual(["simple", "simple"]);
    expect(screen.getByTestId<HTMLSelectElement>("view-filter-field-0").value).toBe("status");
    expect(screen.getByTestId<HTMLSelectElement>("view-filter-field-1").value).toBe("task_type");
    // The advanced row is gone entirely.
    expect(screen.queryByTestId("view-filter-query-1")).toBeNull();
  });

  it("saves the filters in the AUTHORED order", async () => {
    render(<ViewFormDialog existing={target(THREE)} onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-filter-field-0");

    fireEvent.click(screen.getByTestId("view-form-save"));
    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });

    const [put] = writeCalls("PUT");
    expect(put?.body?.filters).toEqual(THREE);
  });
});

describe("ViewFormDialog — adding filters", () => {
  it("starts a CREATE in the simple picker, not in a DSL box", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });

    await screen.findByTestId("view-filter-field-0");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.getAttribute("data-row-kind")).toBe("simple");
    // The raw DSL editor is NOT the default surface.
    expect(screen.queryByTestId("advanced-query-editor")).toBeNull();
    expect(screen.queryByTestId("view-filter-query-0")).toBeNull();
  });

  it("'+ Add filter' APPENDS a simple row at the end", async () => {
    render(
      <ViewFormDialog
        existing={target([{ kind: "advanced", query: "priority = high" }])}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-filter-query-0");

    fireEvent.click(screen.getByTestId("view-add-filter"));

    // Appended — the existing advanced row stays FIRST.
    expect(rows().map(r => r.getAttribute("data-row-kind"))).toEqual(["advanced", "simple"]);
    expect(screen.getByTestId<HTMLTextAreaElement>("view-filter-query-0").value)
      .toBe("priority = high");
  });

  it("'+ Add advanced query' appends an advanced row and is visually subordinate", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-filter-field-0");

    const addFilter = screen.getByTestId("view-add-filter");
    const addAdvanced = screen.getByTestId("view-add-advanced");
    // Opt-in and subordinate: the primary add is the picker. The advanced
    // action must not be a primary-weight button (K102 — the DSL is not
    // what the eye should land on).
    expect(addFilter.className).not.toEqual(addAdvanced.className);
    expect(addAdvanced.className).not.toContain("bg-accent");

    fireEvent.click(addAdvanced);
    expect(rows().map(r => r.getAttribute("data-row-kind"))).toEqual(["simple", "advanced"]);
  });
});

describe("ViewFormDialog — chrome", () => {
  it("puts Cancel and Save at the same level, labelled 'Save'", async () => {
    render(<ViewFormDialog existing={target([])} onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-form-save");

    const save = screen.getByTestId("view-form-save");
    const cancel = screen.getByTestId("view-form-cancel");
    // Ken: "why is it on a different level from 'Cancel'? And the text
    // should be 'Save'".
    expect(save.textContent).toBe("Save");
    expect(save.parentElement).toBe(cancel.parentElement);
  });

  it("carries the archived scope as a view PROPERTY, not as a filter row", async () => {
    render(
      <ViewFormDialog
        existing={{ id: "v1", name: "E", filters: [], archivedScope: "all" }}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    const control = await screen.findByTestId<HTMLSelectElement>("view-form-archived-scope");
    // Seeded from the view…
    expect(control.value).toBe("all");
    // …and it is NOT one of the removable filter rows: no row carries it,
    // so it cannot be deleted along with a filter (K107 + K102).
    for (const r of rows()) expect(r.textContent).not.toContain("Archived");
    expect(screen.getByTestId("view-form-archived-scope").closest("[data-testid='view-filter-row']"))
      .toBeNull();

    fireEvent.change(control, { target: { value: "archived" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    expect(writeCalls("PUT")[0]?.body?.archivedScope).toBe("archived");
  });

  it("does not drop a stored icon when the view is edited (K104 field)", async () => {
    render(
      <ViewFormDialog
        existing={{ id: "v1", name: "E", filters: [], icon: "bug" }}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-form-save");
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    expect(writeCalls("PUT")[0]?.body?.icon).toBe("bug");
  });

  it("blocks Save while a started filter is unfinished, and drops untouched blank rows", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-filter-field-0");
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Mine" } });

    // An untouched blank row does NOT block: Save is live and the row is
    // simply not stored.
    const save = screen.getByTestId<HTMLButtonElement>("view-form-save");
    expect(save.disabled).toBe(false);

    // Choosing a field with no value is a STARTED filter — that blocks,
    // because saving it would discard the choice the user just made.
    fireEvent.change(screen.getByTestId("view-filter-field-0"), { target: { value: "status" } });
    expect(screen.getByTestId<HTMLButtonElement>("view-form-save").disabled).toBe(true);
  });

  it("clears the values when the field changes, so a row never holds another field's values", async () => {
    render(
      <ViewFormDialog
        existing={target([{ kind: "simple", field: "status", op: "in", values: ["backlog"] }])}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-filter-field-0");
    // One value selected on `status`.
    expect(within(screen.getByRole("button", { name: "Filter Status" })).getByText("· 1"))
      .toBeTruthy();

    fireEvent.change(screen.getByTestId("view-filter-field-0"), { target: { value: "priority" } });

    // A `backlog` status key is not a priority key — it must not carry over.
    const picker = screen.getByRole("button", { name: "Filter Priority" });
    expect(picker.textContent).not.toContain("· 1");
  });
});
