// @vitest-environment jsdom
import type { Filter } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comboOptions, expectComboValueSelectable, pickCombo } from "../ui/selectComboboxTestUtils.ts";
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
    // pickers. The field picker holds the stored field, the operator
    // picker the stored operator.
    //
    // K106 made these listbox dropdowns rather than native <select>s, so
    // what is pinned is that the control IS a dropdown — a button opening
    // a listbox — and not a text input, which is the distinction the case
    // is about.
    const field = screen.getByTestId("view-filter-field-0");
    expect(field.tagName).toBe("BUTTON");
    expect(field.getAttribute("aria-haspopup")).toBe("listbox");
    expectComboValueSelectable("view-filter-field-0", "status");
    expectComboValueSelectable("view-filter-op-0", "in");

    // The row is marked simple, and NO query textarea exists for it.
    expect(rows()[0]?.getAttribute("data-row-kind")).toBe("simple");
    expect(screen.queryByTestId("view-filter-query-0")).toBeNull();

    // The value picker is the SAME FilterFacet the top filter bar
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

  it("offers a stored field the catalog does not know as its raw token", async () => {
    // A view filtering on a custom field that has since been removed. The
    // row must render what the file says rather than silently resetting to
    // blank — so the token is BOTH the current value and a real option.
    //
    // Asserting the value alone would not catch a dropped option: the
    // trigger's `data-value` echoes the draft state either way. That is a
    // regression a native <select>'s `.value` used to rule out for free.
    render(
      <ViewFormDialog
        existing={target([
          { kind: "simple", field: "fields.severity", op: "in", values: ["sev1"] },
        ])}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-filter-field-0");

    expectComboValueSelectable("view-filter-field-0", "fields.severity");
    expect(comboOptions("view-filter-field-0"))
      .toContainEqual({ value: "fields.severity", label: "fields.severity" });
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
    expectComboValueSelectable("view-filter-field-0", "status");
    expectComboValueSelectable("view-filter-field-2", "task_type");
  });

  it("removing row N removes exactly that row, leaving the others in order", async () => {
    render(<ViewFormDialog existing={target(THREE)} onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-filter-field-0");

    // Remove the MIDDLE row.
    fireEvent.click(screen.getByTestId("view-filter-remove-1"));

    expect(rows().map(r => r.getAttribute("data-row-kind"))).toEqual(["simple", "simple"]);
    expectComboValueSelectable("view-filter-field-0", "status");
    expectComboValueSelectable("view-filter-field-1", "task_type");
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

  // Ken's ruling, 2026-09-22 ("archiving is a one-way door, not a filter",
  // decisions.md § 9): "a view filtering on archived encodes the wrong
  // model." This dialog used to expose the view's `archivedScope` via an
  // "Include [Active|Archived|All]" segmented control — Ken
  // screenshotted exactly this control and ruled it out. It is gone from
  // the dialog entirely: no control, and no row.
  it("offers no archived-scope control, as a row or otherwise", async () => {
    render(
      <ViewFormDialog
        existing={{ id: "v1", name: "E", filters: [] }}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-form-save");
    expect(screen.queryByTestId("view-form-archived-scope")).toBeNull();
    for (const r of rows()) expect(r.textContent).not.toContain("Archived");
  });

  // The underlying capability (a view's stored `archivedScope`, set via
  // the CLI or MCP — both keep the field; only this web control is
  // removed) must not be clobbered by an edit made from a dialog that no
  // longer offers a way to choose it. Since `existing` here carries no
  // `archivedScope` in its narrowed `ViewFormTarget` shape, the only way
  // to prove the dialog does not send a stray default is to check the
  // wire body directly: it must carry no `archivedScope` key at all, so
  // `editView`'s merge (core) keeps whatever the view already has on
  // disk.
  it("saves without an `archivedScope` key, so an unrelated edit cannot reset a scope set elsewhere", async () => {
    render(
      <ViewFormDialog
        existing={{ id: "v1", name: "E", filters: [] }}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    fireEvent.click(await screen.findByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    expect(writeCalls("PUT")[0]?.body).not.toHaveProperty("archivedScope");
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
    pickCombo("view-filter-field-0", "status");
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

    pickCombo("view-filter-field-0", "priority");

    // A `backlog` status key is not a priority key — it must not carry over.
    const picker = screen.getByRole("button", { name: "Filter Priority" });
    expect(picker.textContent).not.toContain("· 1");
  });
});

/**
 * K103 colour on a saved view + the UI-14 emoji rule made visible.
 *
 * Ken, 2026-09-22: *"perhaps icons can also have colours as part of it,
 * but emojis, just use the emoji itself (because we can't add colour)"*.
 * The dialog must not silently ignore that: when the chosen icon is an
 * emoji the colour control goes INERT and SAYS WHY, and the stored colour
 * is preserved rather than cleared.
 *
 * What these catch: a view gaining a colour field whose control is wired
 * up without the coupling rule — which looks completely fine until a user
 * picks an emoji, sets a colour, and nothing happens with no explanation.
 */
describe("ViewFormDialog — colour, and the emoji rule", () => {
  /** Picks an icon through the portalled grid. */
  function pickViewIcon(id: string, tab: "icons" | "emoji" = "icons"): void {
    fireEvent.click(screen.getByTestId("view-form-icon"));
    fireEvent.click(screen.getByTestId(`view-form-icon-list-tab-${tab}`));
    fireEvent.click(screen.getByTestId(`icon-option-${id}`));
  }

  it("offers a colour control for a view, live for a NAMED icon", async () => {
    render(
      <ViewFormDialog existing={{ ...target([]), icon: "flag" }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-form-name");
    // The control exists at all — this is the ticket.
    const picker = screen.getByTestId("view-form-color-picker");
    // ...and it is USABLE, because a Lucide glyph takes `currentColor`.
    expect(picker.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByTestId("view-form-color-picker-disabled-reason")).toBeNull();
  });

  it("DISABLES the colour control for an emoji icon, and states the reason", async () => {
    render(
      <ViewFormDialog existing={{ ...target([]), icon: "flag" }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-form-name");

    pickViewIcon("🚀", "emoji");

    expect(screen.getByTestId("view-form-color-picker").hasAttribute("disabled")).toBe(true);
    // The reason is SHOWN, not merely implied by a greyed control — that
    // is the difference between Ken's rule made visible and silently
    // ignored.
    expect(screen.getByTestId("view-form-color-picker-disabled-reason").textContent)
      .toContain("Emoji carries its own colour");
    // The hex alias is inert too, or the "disabled" state would have a
    // live back door writing the very value the rule says cannot apply.
    expect(screen.getByTestId<HTMLInputElement>("view-form-color").disabled).toBe(true);
  });

  it("PRESERVES a stored colour through the emoji state, and sends it on save", async () => {
    render(
      <ViewFormDialog
        existing={{ ...target([]), icon: "flag", color: { palette: "blue" } }}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("view-form-name");

    pickViewIcon("🚀", "emoji");
    // Inert, NOT cleared: clearing would discard a deliberate choice and
    // make icon → emoji → icon lose it (A279 / P-11).
    expect(screen.getByTestId("view-form-color-picker").getAttribute("data-value")).toBe("blue");

    fireEvent.click(screen.getByTestId("view-form-save"));
    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    const body = writeCalls("PUT")[0]?.body;
    // The colour is still STORED while the icon is an emoji — the rule is
    // about whether it can be applied, not whether it may be kept.
    expect(body?.["color"]).toEqual({ palette: "blue" });
    expect(body?.["icon"]).toBe("🚀");
  });

  it("sends a view's colour on create", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("view-form-name");
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Coloured" } });

    pickViewIcon("flag");
    fireEvent.change(screen.getByTestId("view-form-color"), { target: { value: "#1e6fcb" } });

    fireEvent.click(screen.getByTestId("view-form-save"));
    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    expect(writeCalls("POST")[0]?.body?.["color"]).toBe("#1e6fcb");
  });
});
