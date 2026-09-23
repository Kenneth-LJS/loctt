// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listSearchSchema } from "../router/listSearch.ts";
import { expectComboValueSelectable, pickCombo } from "../ui/selectComboboxTestUtils.ts";
import { ToastProvider } from "../ui/Toast.tsx";
import { buildChips, type FacetKey, type FacetOptions, FilterBar } from "./FilterBar.tsx";

// Computes the real accessible description rather than reading an
// attribute: UI-23e moved the active-view chip's full summary off
// `title` and onto a `Tooltip`, so what must hold is that the summary
// still reaches the user, not which attribute carries it.
expect.extend(matchers);

/**
 * FilterBar tests. Selecting a dropdown option writes the filter to URL
 * search state and surfaces a removable chip; removing the chip clears
 * it. The URL is the source of truth, so we assert against the router's
 * location.search after each interaction.
 */

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/projects")) {
    return { items: [{ id: "p_web", name: "Web", prefix: "WEB-" }], total: 1, offset: 0, limit: 100, default: "p_web" };
  }
  if (path.startsWith("/api/users")) {
    return { items: [{ id: "u_ken", name: "Ken Loh", timezone: "UTC" }], total: 1, offset: 0, limit: 100, current: "u_ken" };
  }
  if (path.startsWith("/api/labels")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/milestones")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/sprints")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/views")) {
    return {
      queries: [
        {
          id: "v_recent",
          name: "recent-open",
          filters: [{ kind: "simple", field: "status", op: "not in", values: ["done"] }],
        },
        {
          id: "v_blocked",
          name: "blocked",
          filters: [{ kind: "simple", field: "status", op: "in", values: ["blocked"] }],
        },
      ],
    };
  }
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: [
        { key: "in_progress", label: "In progress", category: "active" },
        { key: "done", label: "Done", category: "completed" },
      ],
      priorities: [{ key: "high", label: "High" }],
      task_types: [{ key: "bug", label: "Bug" }],
      relationships: [],
      custom_fields: [],
    };
  }
  return {};
}

/** LST-57: make `/api/workflow` fail for one test. Reset in afterEach. */
let workflowFails = false;

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    let body: unknown;
    if (path.startsWith("/api/query/validate")) {
      // The builder's live-q preview runs through the same validate surface
      // as the text editor; a bare {} would read as invalid. The builder is
      // fed from constrained pickers, so a valid verdict is the norm — but
      // a query carrying the __INVALID__ marker returns an invalid verdict
      // so the F5 disable-Apply path can be exercised.
      const q = (() => {
        try { return (JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { query?: string }).query ?? ""; }
        catch { return ""; }
      })();
      // A blank-valued condition (`status = ""`) is what a freshly-added
      // builder row serialises to before the user picks a value — the real
      // server rejects it ("unknown status value '' at position N"), which
      // is the premature error the builder must NOT surface (problem #4).
      // Mirror that here so the suppression is genuinely exercised.
      body = q.includes("__INVALID__")
        ? { valid: false, kind: "syntax", message: "nope", position: 0 }
        : /=\s*""/.test(q)
          ? { valid: false, kind: "unknown_value", message: "unknown status value '' at position 0", position: 0 }
          : { valid: true };
    } else if (workflowFails && path.startsWith("/api/workflow")) {
      return Promise.resolve(new Response(
        JSON.stringify({ error: { code: "internal", message: "workflow.yaml could not be read" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ));
    } else {
      body = routeFetch(path);
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
}

async function mountFilterBar(initialSearch = "") {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: FilterBar,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: [`/list${initialSearch}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Filter Status" });
  return router;
}

afterEach(() => {
  workflowFails = false;
  cleanup();
  vi.restoreAllMocks();
});

function search(router: { state: { location: { search: unknown } } }): Record<string, unknown> {
  return router.state.location.search as Record<string, unknown>;
}


/**
 * Mounts the bar the way the sprint detail does (M4.7 / SPR-13): on a
 * different route, with the `sprint` facet withheld.
 *
 * The props exist so `/sprints/$key` can reuse this component instead
 * of forking it; without a test here the only thing holding them is a
 * Playwright spec, and a prop that silently stops being honoured would
 * fail far from its cause.
 */
async function mountScopedFilterBar(initialSearch = "") {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sprints/$key",
    validateSearch: listSearchSchema,
    component: () => (
      <FilterBar from="/sprints/$key" hiddenFacets={["sprint"]} showSaveView={false} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({ initialEntries: [`/sprints/S1${initialSearch}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Filter Status" });
  return router;
}

describe("FilterBar", () => {
  it("selecting a status option writes it to the URL and shows a chip", async () => {
    const router = await mountFilterBar();
    fireEvent.click(screen.getByRole("button", { name: "Filter Status" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "In progress" }));

    await vi.waitFor(() => expect(search(router).status).toEqual(["in_progress"]));
    // Chip with the human label appears.
    expect(await screen.findByText("In progress")).toBeTruthy();
  });

  // @verifies PRU-25
  it("offers a Reporter facet whose options are existing users only", async () => {
    const router = await mountFilterBar();
    // Reporter is not in the built-in default visible set (K97:
    // Project/Status/Priority/Assignee), so add it via the Add-filter
    // picker first. (Previously every facet was a permanent pill; the
    // configurable-visible-set redesign means non-default facets are added
    // on demand — this asserts the new add path, then the facet itself.)
    fireEvent.click(screen.getByTestId("add-filter"));
    fireEvent.click(await screen.findByTestId("add-filter-reporter"));
    fireEvent.click(await screen.findByRole("button", { name: "Filter Reporter" }));
    // Every option in the menu is a known user; a dangling ULID (a
    // deleted user, PRU-25) is never present because the options come
    // from the users list, not from task values.
    const options = await screen.findAllByRole("menuitemcheckbox");
    expect(options.map(o => o.textContent)).toEqual(["Ken Loh"]);

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Ken Loh" }));
    await vi.waitFor(() => expect(search(router).reporter).toEqual(["u_ken"]));
  });

  it("removing a chip clears that filter from the URL", async () => {
    const router = await mountFilterBar("?status=in_progress");
    const removeBtn = await screen.findByRole("button", { name: /Remove Status In progress/ });
    fireEvent.click(removeBtn);
    await vi.waitFor(() => expect(search(router).status).toBeUndefined());
  });

  // Ken's ruling, 2026-09-22 ("archiving is a one-way door, not a filter",
  // decisions.md § 9): the task list is a primary work surface, so it must
  // carry NO archived-scope control — the policy table names "Task list /
  // Board / Timeline" as "Never". This used to be
  // `list-archived-scope`/`filters-sheet-archived-scope`, a segmented
  // control sitting as a peer of Status/Priority/Assignee; both are gone.
  // K121 #1 then removed the `?archived=` capability from the web too.
  it("renders no archived-scope control, on desktop or in the mobile filter sheet", async () => {
    await mountFilterBar();
    expect(screen.queryByTestId("list-archived-scope")).toBeNull();
    expect(screen.queryByTestId("filters-sheet-archived-scope")).toBeNull();
  });

  it("'Clear all' removes every active filter", async () => {
    const router = await mountFilterBar("?status=in_progress&priority=high");
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    await vi.waitFor(() => {
      const s = search(router);
      expect(s.status).toBeUndefined();
      expect(s.priority).toBeUndefined();
    });
  });

  it("selecting a second value on a facet accumulates (in (...))", async () => {
    const router = await mountFilterBar("?status=in_progress");
    fireEvent.click(screen.getByRole("button", { name: "Filter Status" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Done" }));
    await vi.waitFor(() => {
      const s = search(router);
      expect(s.status).toEqual(["in_progress", "done"]);
    });
  });

  it("withholds a hidden facet's dropdown while keeping the rest (SPR-13)", async () => {
    await mountScopedFilterBar();
    // The shared facets are all still offered...
    expect(screen.getByRole("button", { name: "Filter Status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Priority" })).toBeTruthy();
    // ...and the withheld one is not.
    expect(screen.queryByRole("button", { name: "Filter Sprint" })).toBeNull();
  });

  it("does not offer a chip that would clear a hidden facet (SPR-13)", async () => {
    // The URL carries a sprint filter — the route's own scope. A chip
    // for it would come with a ✕ that strands the page.
    await mountScopedFilterBar("?sprint=S1&status=done");
    // A positive control: the visible facet's chip IS offered, so a
    // missing sprint chip is the hiding, not an empty chip row.
    expect(screen.getByRole("button", { name: /Remove Status/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove Sprint/ })).toBeNull();
  });

  // U23 moved "Save as view" into the desktop "⋯" menu; K30-web took it
  // back out as a direct star IconButton once the export left the menu
  // with nothing else in it. So it is asserted as a toolbar button again
  // — and on the sprint detail there is no cluster at all to look in.
  it("hides 'Save as view' when the scope would not be reproduced by one", async () => {
    await mountScopedFilterBar();
    expect(screen.queryByTestId("view-actions-save-view")).toBeNull();
    // Not merely hidden inside a menu: with nothing else to offer, the
    // whole cluster — including any ⋯ — is absent.
    expect(screen.queryByTestId("view-actions")).toBeNull();
    expect(screen.queryByTestId("view-actions-menu")).toBeNull();
  });

  it("still shows 'Save as view' on the list, where the URL is the whole state", async () => {
    await mountFilterBar();
    expect(await screen.findByTestId("view-actions-save-view")).toBeTruthy();
  });

  // @verifies LST-53
  it("a free-text q= query renders a removable chip and lights up Clear all", async () => {
    const router = await mountFilterBar(`?q=${encodeURIComponent("status = in_progress")}`);

    // UX-1: landing on a q= URL (as every sidebar saved filter does) now
    // shows a chip so the filtered short list is explained, and a
    // "Clear all" affordance so it is reversible in-page — matching how
    // facet chips already work.
    const chip = await screen.findByTestId("query-chip");
    expect(chip.textContent).toContain("Query:");
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();

    // Its ✕ clears just the query from the URL.
    fireEvent.click(screen.getByRole("button", { name: "Remove query filter" }));
    await vi.waitFor(() => expect(search(router).q).toBeUndefined());
  });

  // UX eval #6: a q= DSL carries raw entity ids; the chip resolves a
  // quoted id to its display name for the preview (the underlying query
  // keeps the id).
  it("humanizes a user id in the query chip preview", async () => {
    await mountFilterBar(`?q=${encodeURIComponent('assignee = "u_ken"')}`);
    const chip = await screen.findByTestId("query-chip");
    // Shows the name, not the raw id.
    expect(chip.textContent).toContain("Ken Loh");
    expect(chip.textContent).not.toContain("u_ken");
  });

  // Ken: a query filter must be EDITABLE from where it's shown, not only
  // removable. Clicking the query chip's text opens the advanced editor
  // pre-loaded with the query.
  it("clicking the query chip opens the advanced editor to edit it", async () => {
    await mountFilterBar(`?q=${encodeURIComponent("priority = high")}`);
    fireEvent.click(await screen.findByTestId("query-chip-edit"));
    const surface = await screen.findByTestId("advanced-query-surface");
    expect(surface).toBeTruthy();
  });

  // @verifies LST-53
  it("Clear all removes an active q= query too", async () => {
    const router = await mountFilterBar(
      `?q=${encodeURIComponent("priority = high")}&status=in_progress`,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    await vi.waitFor(() => {
      const s = search(router);
      expect(s.q).toBeUndefined();
      expect(s.status).toBeUndefined();
    });
  });

  // An active, VALID saved view (`?view=<id>`) is filtered server-side and
  // used to leave the toolbar with no indication which view was applied —
  // the same "filtered for no visible reason" trap LST-53 fixed for `q=`,
  // latent for saved views. It now renders its own chip naming the view.
  it("renders an active-view chip naming the view when ?view=<valid id> is set", async () => {
    await mountFilterBar("?view=v_recent");
    const chip = await screen.findByTestId("active-view-chip");
    expect(chip.textContent).toContain("View:");
    expect(chip.textContent).toContain("recent-open");
    // K102: the chip shows what the view MATCHES as the shared
    // display-only filter summary (a view stores no query string any
    // more). The full summary is on the edit button's title, so a
    // truncated preview can be read on hover.
    const edit = screen.getByTestId("active-view-chip-edit");
    // UI-23e: the full summary moved from `title` to a `Tooltip` with
    // `describes`, so it is the button's accessible DESCRIPTION. Read
    // the computed description rather than an attribute — what matters
    // is that the untruncated summary still reaches the user.
    expect(edit).toHaveAccessibleDescription(expect.stringContaining("status not in done"));
    // "Clear all" lights up for an active view too.
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
  });

  it("does not render an active-view chip for a bare /list", async () => {
    await mountFilterBar();
    expect(screen.queryByTestId("active-view-chip")).toBeNull();
  });

  it("does not render an active-view chip for a view id that does not resolve", async () => {
    // ListView's `missingView` banner already covers an unknown view id;
    // the chip must not duplicate it (nothing to name). Let the views query
    // settle first (the stub serves one known view, v_recent) so the
    // absence is a resolution miss on v_gone, not just an unfinished fetch —
    // otherwise a bug that renders the first view for ANY id would slip past.
    await mountFilterBar("?view=v_gone");
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId("active-view-chip")).toBeNull();
  });

  it("editing the active-view chip opens the view form dialog, NOT a DSL query", async () => {
    const router = await mountFilterBar("?view=v_recent");
    fireEvent.click(await screen.findByTestId("active-view-chip-edit"));

    // K102: the view opens in the same dropdown-row dialog Settings and the
    // sidebar use, seeded from its STORED filters. It used to flatten the
    // view into `q=<its query>` and open the raw DSL editor — the exact
    // behaviour Ken struck out ("QUERY IS ADVANCED SHIT"). A view built
    // from dropdowns must reopen as dropdowns.
    await screen.findByTestId("view-edit-dialog");
    // B14: the reopened dialog must offer "status" as a real, pickable
    // option, not just show it as a leftover trigger label.
    expectComboValueSelectable("view-filter-field-0", "status");
    expect(screen.queryByTestId("advanced-query-surface")).toBeNull();
    // And the URL is untouched: the view is still the active one.
    expect(search(router).view).toBe("v_recent");
    expect(search(router).q).toBeUndefined();
  });

  it("clearing the active-view chip returns to all tasks", async () => {
    const router = await mountFilterBar("?view=v_recent");
    fireEvent.click(await screen.findByRole("button", { name: "Clear active view" }));
    await vi.waitFor(() => expect(search(router).view).toBeUndefined());
  });

  // Stale-open-UI-on-navigation: the advanced editor is transient local
  // state, not derived from the URL. Switching to a different saved
  // filter/view from the sidebar (a navigation that changes `search.view`)
  // must close it — otherwise it stays open aimed at the wrong filter.
  it("closes the advanced editor when the user switches to a different saved view", async () => {
    const router = await mountFilterBar(
      `?view=v_recent&q=${encodeURIComponent("title ~ foo")}`,
    );
    // Open the DSL editor from the q= chip. (K102: the active-VIEW chip's
    // Edit now opens the view form dialog, not this editor.)
    fireEvent.click(await screen.findByTestId("query-chip-edit"));
    expect(await screen.findByTestId("advanced-query-surface")).toBeTruthy();

    // The sidebar switches to another saved view: navigate to view B.
    await router.navigate({ to: "/list", search: { view: "v_blocked" } as never });

    // The editor closes — it no longer applies to the newly-selected view.
    await vi.waitFor(() =>
      expect(screen.queryByTestId("advanced-query-surface")).toBeNull());
    // …and the toolbar now names the new view.
    expect((await screen.findByTestId("active-view-chip")).textContent).toContain("blocked");
  });

  // The draft must re-sync to the newly-selected filter's query, not keep
  // the previous filter's working text. Uses a q→q switch so the draft is
  // directly observable in the text box.
  it("re-syncs the editor draft to the new filter's query on a switch", async () => {
    const router = await mountFilterBar(`?q=${encodeURIComponent("priority = high")}`);
    // Open the editor and confirm it holds filter A's query.
    fireEvent.click(await screen.findByTestId("query-chip-edit"));
    await screen.findByTestId("advanced-query-surface");

    // Switch to a q= filter B via a fresh navigation (as a sidebar q-based
    // saved filter would). The editor closes and the draft re-syncs.
    await router.navigate({ to: "/list", search: { q: "title ~ zzz" } as never });
    // Generous timeout: the reset runs in an effect after the navigation
    // commits, and under full-suite parallel load that can take longer
    // than waitFor's 1s default (the close itself is prompt in isolation).
    await vi.waitFor(
      () => expect(screen.queryByTestId("advanced-query-surface")).toBeNull(),
      { timeout: 3000 },
    );

    // Re-open the editor: its draft now reflects filter B, not the stale A.
    fireEvent.click(await screen.findByTestId("query-chip-edit"));
    await screen.findByTestId("advanced-query-surface");
    // Switch to the text box to read the draft verbatim.
    const toText = screen.queryByTestId("switch-to-text");
    if (toText !== null) fireEvent.click(toText);
    const input = await screen.findByTestId("dsl-input");
    await vi.waitFor(
      () => expect((input as HTMLTextAreaElement).value).toBe("title ~ zzz"),
      { timeout: 3000 },
    );
  });

  // In-editor Apply writes `q` but must NOT close the editor — that is the
  // user refining their query, not navigating to a different filter.
  it("keeps the editor open when the user applies a query from inside it", async () => {
    const router = await mountFilterBar(`?q=${encodeURIComponent("title ~ foo")}`);
    fireEvent.click(await screen.findByTestId("query-chip-edit"));
    await screen.findByTestId("query-builder");

    // Edit the leaf value and apply — writes q, view unchanged, editor open.
    fireEvent.change(screen.getByTestId("qb-value"), { target: { value: "bar" } });
    fireEvent.click(screen.getByTestId("qb-apply"));

    await vi.waitFor(() => expect(search(router).q).toBe("title ~ bar"));
    // Let any reset effect flush, then assert the editor is STILL mounted —
    // an in-editor Apply must not be mistaken for a filter switch. (Without
    // the appliedByEditor guard, the q change closes the editor here.)
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByTestId("advanced-query-surface")).toBeTruthy();
  });

  // @verifies LST-56
  it("facet options show an empty checkbox affordance before the first click", async () => {
    await mountFilterBar();
    fireEvent.click(screen.getByRole("button", { name: "Filter Status" }));

    // UX-4: each option carries a real (B1) checkbox input so multi-select
    // is discoverable — an *unchecked* box reads as clickable, where the
    // old empty span was simply blank. The option is unchecked before the
    // first click, and the box is present in the option row.
    const option = await screen.findByRole("menuitemcheckbox", { name: "In progress" });
    expect(option.getAttribute("aria-checked")).toBe("false");
    const box = option.querySelector('input[type="checkbox"]');
    expect(box).not.toBeNull();
    expect((box as HTMLInputElement).checked).toBe(false);

    // Clicking checks it (the box mirrors the selected state).
    fireEvent.click(option);
    const checked = await screen.findByRole("menuitemcheckbox", { name: "In progress" });
    await vi.waitFor(() => expect(checked.getAttribute("aria-checked")).toBe("true"));
  });
});

/**
 * Mobile (< sm): the facet band collapses into a single "Filters" button
 * that opens a bottom sheet holding the same facet dropdowns (GROUP B).
 * useIsNarrow reads innerWidth when matchMedia is absent (jsdom), so
 * setting innerWidth drives the narrow layout.
 */
describe("FilterBar — mobile filter sheet", () => {
  async function mountNarrow(initialSearch = "") {
    stubFetch();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute();
    const listRoute = createRoute({
      getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema, component: FilterBar,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([listRoute]),
      history: createMemoryHistory({ initialEntries: [`/list${initialSearch}`] }),
    });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("filters-open");
    return router;
  }

  it("shows a Filters button (not inline facets) and opens a sheet with the facets", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      await mountNarrow();
      // The facet pills are NOT inline on a phone…
      expect(screen.queryByRole("button", { name: "Filter Status" })).toBeNull();
      // …the Filters button is. Open it.
      fireEvent.click(screen.getByTestId("filters-open"));
      const sheet = await screen.findByTestId("filters-sheet");
      // The same facet controls live inside the sheet.
      expect(within(sheet).getByRole("button", { name: "Filter Status" })).toBeTruthy();
      expect(within(sheet).getByRole("button", { name: "Filter Priority" })).toBeTruthy();
      // Sheet footer offers Clear all + Done.
      expect(within(sheet).getByTestId("filters-sheet-clear")).toBeTruthy();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });

  // Ken's ruling, 2026-09-22: the mobile Filters sheet is the same
  // primary-work surface as the desktop filter band, so opening it must
  // not reveal an archived-scope control either.
  it("the mobile filter sheet has no archived-scope control", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      await mountNarrow();
      fireEvent.click(screen.getByTestId("filters-open"));
      const sheet = await screen.findByTestId("filters-sheet");
      expect(within(sheet).queryByTestId("filters-sheet-archived-scope")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });

  it("badges the Filters button with the active facet count", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      await mountNarrow("?status=in_progress");
      expect((await screen.findByTestId("filters-active-count")).textContent).toBe("1");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });

  // Stale-open-sheet-on-switch: the mobile filter sheet is transient local
  // state, not derived from the URL. Switching to a different saved
  // filter/view (a navigation that changes `search.view`) must close it —
  // otherwise the sheet stays open aimed at the previous filter. The
  // editor/draft halves of this reset are tested above; the sheet halves
  // (`setFilterSheetOpen(false)` / `setAddSheetOpen(false)`) were not.
  it("closes an open filter sheet when the user switches to a different view", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      const router = await mountNarrow("?view=v_recent");
      fireEvent.click(screen.getByTestId("filters-open"));
      expect(await screen.findByTestId("filters-sheet")).toBeTruthy();

      // Switch to another saved view from outside the bar (as the sidebar does).
      await router.navigate({ to: "/list", search: { view: "v_blocked" } as never });

      await vi.waitFor(
        () => expect(screen.queryByTestId("filters-sheet")).toBeNull(),
        { timeout: 3000 },
      );
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });

  it("closes an open add-filter sheet when the user switches to a different view", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      const router = await mountNarrow("?view=v_recent");
      // Open the filter sheet, then the Add-filter sub-sheet from inside it.
      // On mobile the Add-filter trigger inside the sheet is
      // `add-filter-mobile` (the `add-filter` Menu is the desktop-only one).
      fireEvent.click(screen.getByTestId("filters-open"));
      await screen.findByTestId("filters-sheet");
      fireEvent.click(await screen.findByTestId("add-filter-mobile"));
      expect(await screen.findByTestId("add-filter-sheet")).toBeTruthy();

      await router.navigate({ to: "/list", search: { view: "v_blocked" } as never });

      await vi.waitFor(
        () => expect(screen.queryByTestId("add-filter-sheet")).toBeNull(),
        { timeout: 3000 },
      );
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });
});

/**
 * K83 step 3 — the Advanced surface's mode picker, refuse-on-unrenderable,
 * and how a builder apply composes with the chip filters (LST-40/41).
 *
 * These mount the whole FilterBar so the surface is exercised the way the
 * user reaches it: click "Advanced", then assert which mode opened and
 * what applying writes to the URL. The URL is the source of truth, so the
 * q + chip composition (LST-40) is asserted against location.search.
 */
describe("FilterBar — Advanced surface (K83 step 3)", () => {
  // The redesign folds advanced querying INTO the filter system: there is
  // no longer a leading "Advanced" pill (advanced-query-toggle). It is
  // reached one level in, from the END of the Add-filter menu ("Advanced
  // query…", data-testid `advanced-open`). This helper opens it the way a
  // user now does; the tests below asserted the removed leading pill, which
  // was exactly problem #2 in the toolbar review.
  const openAdvanced = async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("add-filter"));
    fireEvent.click(await screen.findByTestId("advanced-open"));
  };

  // @verifies K83
  // @verifies QBLD-1
  it("refuses the visual builder for a NOT query, landing in the text box with the reason", async () => {
    await mountFilterBar(`?q=${encodeURIComponent("not status = done")}`);
    await openAdvanced();

    // K83-i / K83-iii: a `not` is unrenderable → the TEXT box, never the
    // visual builder that would silently misrepresent it.
    const surface = await screen.findByTestId("advanced-query-surface");
    expect(surface.getAttribute("data-mode")).toBe("text");
    expect(screen.queryByTestId("query-builder")).toBeNull();

    // The reason note names why, and "Switch to visual" is disabled with it.
    const note = screen.getByTestId("advanced-refuse-note");
    expect(note.textContent).toContain("visual builder");
    const toVisual = screen.getByTestId("switch-to-visual");
    expect(toVisual.hasAttribute("disabled")).toBe(true);
    expect(toVisual.getAttribute("title") ?? "").not.toBe("");
  });

  // @verifies K83
  // @verifies QBLD-1
  it("refuses the visual builder for a has_link query too", async () => {
    await mountFilterBar(`?q=${encodeURIComponent('has_link("blocks")')}`);
    await openAdvanced();

    const surface = await screen.findByTestId("advanced-query-surface");
    expect(surface.getAttribute("data-mode")).toBe("text");
    expect(screen.getByTestId("advanced-refuse-note")).toBeTruthy();
  });

  // @verifies K83
  // @verifies QBLD-1
  it("opens the visual builder for a renderable OR query, showing two leaves", async () => {
    await mountFilterBar(`?q=${encodeURIComponent("priority = high or priority = critical")}`);
    await openAdvanced();

    const surface = await screen.findByTestId("advanced-query-surface");
    expect(surface.getAttribute("data-mode")).toBe("builder");
    expect(screen.getByTestId("query-builder")).toBeTruthy();

    // An OR group of two leaves: the root toggle reads OR and there are
    // two leaf rows (each with a field picker).
    const orBtn = screen.getByTestId("qb-and-or-or");
    expect(orBtn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByTestId("qb-field")).toHaveLength(2);
    // The preview round-trips the two leaves unchanged.
    expect(screen.getByTestId("query-builder-preview").textContent)
      .toBe("priority = high or priority = critical");
  });

  // @verifies K83
  // @verifies QBLD-2
  it("switches visual→text→visual preserving the query, and disables Switch-to-visual once the text is unrepresentable", async () => {
    await mountFilterBar(`?q=${encodeURIComponent("priority = high or priority = critical")}`);
    await openAdvanced();
    await screen.findByTestId("query-builder");

    // Visual → text carries the query into the text box verbatim.
    fireEvent.click(screen.getByTestId("switch-to-text"));
    const input = await screen.findByTestId("dsl-input");
    expect((input as HTMLTextAreaElement).value).toBe("priority = high or priority = critical");

    // Text still representable → "Switch to visual" enabled → back to builder,
    // re-parsed to the same two-leaf OR (no approximation).
    const toVisual = screen.getByTestId("switch-to-visual");
    expect(toVisual.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toVisual);
    await screen.findByTestId("query-builder");
    expect(screen.getByTestId("query-builder-preview").textContent)
      .toBe("priority = high or priority = critical");

    // Edit the text into an UNrepresentable query (a NOT) → the control
    // disables with a reason rather than opening a misrepresenting builder.
    fireEvent.click(screen.getByTestId("switch-to-text"));
    fireEvent.change(await screen.findByTestId("dsl-input"), { target: { value: "not status = done" } });
    await vi.waitFor(() =>
      expect(screen.getByTestId("switch-to-visual").hasAttribute("disabled")).toBe(true));
    expect(screen.getByTestId("switch-to-visual-reason")).toBeTruthy();
  });

  // @verifies LST-40
  // @verifies K83
  // @verifies QBLD-3
  it("applying from the builder sets q and leaves the active chip params untouched", async () => {
    const router = await mountFilterBar(
      `?status=done&q=${encodeURIComponent("title ~ foo")}`,
    );
    await openAdvanced();
    await screen.findByTestId("query-builder");

    // Edit the (only) leaf's free-text value foo → bar, then apply. A text
    // field's value control is a plain input, so the edit lands as typed.
    fireEvent.change(screen.getByTestId("qb-value"), { target: { value: "bar" } });
    fireEvent.click(screen.getByTestId("qb-apply"));

    await vi.waitFor(() => {
      const s = search(router);
      // LST-40: the chip param survives AND the new q is set — intersection.
      expect(s.status).toEqual(["done"]);
      expect(s.q).toBe("title ~ bar");
    });
  });

  // @verifies LST-41
  // @verifies K83
  // @verifies QBLD-3
  it("emptying the builder and applying clears q but keeps the chips", async () => {
    const router = await mountFilterBar(
      `?status=done&q=${encodeURIComponent("priority = high")}`,
    );
    await openAdvanced();
    await screen.findByTestId("query-builder");

    // Remove the sole condition → an empty builder → q cleared.
    fireEvent.click(screen.getByTestId("qb-remove"));
    fireEvent.click(screen.getByTestId("qb-apply"));

    await vi.waitFor(() => {
      const s = search(router);
      expect(s.q).toBeUndefined();
      expect(s.status).toEqual(["done"]); // LST-41: chips untouched
    });
  });

  // @verifies K83
  it("opening Advanced with no query shows the text box with NO parse-error note, and the empty builder is one click away", async () => {
    // A fresh Advanced open (no `q`) keeps the existing text path (VUE-8:
    // type a query, run it) — but the empty string is "no query yet", not
    // a parse error, so there is no refuse note, and "Switch to visual" is
    // enabled so the empty builder is reachable in one click.
    await mountFilterBar();
    await openAdvanced();

    const surface = await screen.findByTestId("advanced-query-surface");
    expect(surface.getAttribute("data-mode")).toBe("text");
    expect(screen.queryByTestId("advanced-refuse-note")).toBeNull();
    const toVisual = screen.getByTestId("switch-to-visual");
    expect(toVisual.hasAttribute("disabled")).toBe(false);

    // Clicking it opens the empty builder.
    fireEvent.click(toVisual);
    expect((await screen.findByTestId("advanced-query-surface")).getAttribute("data-mode")).toBe("builder");
    expect(screen.getByTestId("qb-add-condition")).toBeTruthy();
  });

  // @verifies K83
  // @verifies QBLD-4
  it("opening the builder on a renderable q and applying unchanged leaves q semantically the same", async () => {
    const original = "status = done and priority = high";
    const router = await mountFilterBar(`?q=${encodeURIComponent(original)}`);
    await openAdvanced();
    await screen.findByTestId("query-builder");

    // No edits — the open/save round-trip must not mutate the query (K83-i).
    fireEvent.click(screen.getByTestId("qb-apply"));
    await vi.waitFor(() => expect(search(router).q).toBe(original));
  });

  // @verifies K83
  // @verifies LST-42
  // @verifies QBLD-4
  it("open→apply with NO edits leaves a grammar-colliding value byte-identical (F2/F1)", async () => {
    // The value `"true"` collides with the DSL grammar: a bare `true`
    // reparses as a BOOLEAN. If dslAtom under-quoted (F1), opening the
    // builder and applying with no edits would silently rewrite
    // `status = "true"` to `status = true` — the K83-(i) no-mutation
    // failure. With the fix the quoted form survives byte-for-byte.
    const original = 'status = "true"';
    const router = await mountFilterBar(`?q=${encodeURIComponent(original)}`);
    await openAdvanced();
    await screen.findByTestId("query-builder");

    fireEvent.click(screen.getByTestId("qb-apply"));
    await vi.waitFor(() => expect(search(router).q).toBe(original));
  });

  // @verifies K83
  // @verifies QBLD-5
  it("disables Apply while the live query is invalid, and applies nothing (F5)", async () => {
    const router = await mountFilterBar();
    await openAdvanced();
    // Reach the empty builder, then build a query the (stubbed) validator
    // rejects: a free-text title value carrying the __INVALID__ marker.
    fireEvent.click(screen.getByTestId("switch-to-visual"));
    await screen.findByTestId("query-builder");
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    pickCombo("qb-field", "title");
    pickCombo("qb-op", "~");
    fireEvent.change(screen.getByTestId("qb-value"), { target: { value: "__INVALID__" } });

    // Once validation settles invalid, Apply is disabled...
    const apply = await screen.findByTestId("qb-apply");
    await vi.waitFor(() => expect(apply.hasAttribute("disabled")).toBe(true));

    // ...and clicking it writes nothing to the URL.
    fireEvent.click(apply);
    await new Promise(r => setTimeout(r, 0));
    expect(search(router).q).toBeUndefined();
  });

  // @verifies K97 (problem #4)
  it("does not leak a premature parse error when a fresh condition is added", async () => {
    await mountFilterBar();
    fireEvent.click(screen.getByTestId("add-filter"));
    fireEvent.click(await screen.findByTestId("advanced-open"));
    fireEvent.click(await screen.findByTestId("switch-to-visual"));
    await screen.findByTestId("query-builder");

    // Add a condition — it seeds a blank value (`status = ""`), which the
    // stubbed validator rejects (as the real server does), the instant the
    // row appears. The builder must NOT show that error before the user has
    // picked a value, and Apply is disabled because the condition is
    // incomplete.
    fireEvent.click(screen.getByTestId("qb-add-condition"));

    // Wait past the validate debounce so a leaked error WOULD have
    // surfaced by now — then assert it did not. (Without the suppression
    // this banner shows "unknown status value '' at position 0".)
    await new Promise(r => setTimeout(r, 400));
    const banner = screen.getByTestId("qb-validation");
    expect(banner.textContent?.trim()).toBe("");
    expect(banner.getAttribute("data-error-kind")).toBe("none");
    expect(screen.getByTestId("qb-apply").hasAttribute("disabled")).toBe(true);
  });
});

/**
 * The toolbar redesign (A210): the configurable visible-filter set (K97)
 * and the view-action cluster. These replace the assumption the older
 * tests carried — that every facet is a permanent pill and Refresh/Export
 * float as ListView siblings — which was exactly the toolbar review's
 * complaint.
 */
describe("FilterBar — toolbar redesign (A210 / K97)", () => {
  it("shows only the built-in default facets, not every facet", async () => {
    await mountFilterBar();
    // Built-in default (K97): Project/Status/Priority/Assignee are shown…
    expect(screen.getByRole("button", { name: "Filter Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Assignee" })).toBeTruthy();
    // …the non-default facets are NOT permanent pills anymore.
    expect(screen.queryByRole("button", { name: "Filter Reporter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Filter Milestone" })).toBeNull();
  });

  it("adds a filter via the picker (writes vf) and removes it again", async () => {
    const router = await mountFilterBar();
    // Add Milestone.
    fireEvent.click(screen.getByTestId("add-filter"));
    fireEvent.click(await screen.findByTestId("add-filter-milestone"));
    // The `vf` param is a comma-separated FilterId string in the URL.
    const vf = (): string => {
      const raw: unknown = search(router).vf;
      return typeof raw === "string" ? raw : "";
    };
    // It appears as a pill and the visible set is materialised into `vf`.
    expect(await screen.findByRole("button", { name: "Filter Milestone" })).toBeTruthy();
    await vi.waitFor(() => expect(vf()).toContain("milestone"));

    // Remove it from the toolbar via the dropdown's "Remove this filter".
    fireEvent.click(screen.getByRole("button", { name: "Filter Milestone" }));
    fireEvent.click(await screen.findByTestId("filter-remove-Milestone"));
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Filter Milestone" })).toBeNull());
    expect(vf()).not.toContain("milestone");
  });

  // U23: the inline Export + Save-as-view pills collapsed into the desktop
  // "⋯" View-options menu.
  //
  // K30-web (Ken, 2026-09-23) removed the web export. That deleted the
  // menu's only other section, so "Save as view" came back OUT of the
  // menu as a direct star IconButton, and the ⋯ now renders only where
  // something still fills it (the board's Configure links).
  it("renders Save as view as a direct button and NO ⋯ when there is nothing else in it", async () => {
    mountViewActions();
    const cluster = await screen.findByTestId("view-actions");
    // Q4: no manual refresh button — freshness is staleTime + focus refetch.
    expect(within(cluster).queryByRole("button", { name: "Refresh" })).toBeNull();
    // One click, not two: the action is the button, not a menu row.
    const save = within(cluster).getByTestId("view-actions-save-view");
    expect(save.tagName).toBe("BUTTON");
    expect(save.getAttribute("aria-label")).toBe("Save as view");
    // UI-23e: the hover text is now a `Tooltip`, not `title`. The icon
    // still names itself on hover, but promptly and on focus too. No
    // `title` should remain — leaving one would mean BOTH a custom
    // bubble and the ~1s native one appearing on the same control.
    expect(save.getAttribute("title")).toBeNull();
    // And the tooltip must not double up as a description: the name is
    // already on `aria-label`, so describing the button with the same
    // string would announce it twice.
    expect(save.getAttribute("aria-describedby")).toBeNull();
    // No ⋯ at all: with the export gone this view has nothing to put in
    // one, and a trigger that opens an empty panel is worse than none.
    expect(within(cluster).queryByTestId("view-actions-menu")).toBeNull();
    // And the export is gone from the web entirely (CLI/MCP keep it).
    expect(screen.queryByTestId("export-csv")).toBeNull();
    expect(screen.queryByTestId("export-json")).toBeNull();
  });
});

/**
 * Mounts the bar (optionally with the board's extra menu section).
 *
 * Not `async`: unlike the old helper it awaits no settle signal, because
 * the cluster is now conditional — waiting on `view-actions` here would
 * hang for the sprint-detail case, whose whole point is that it never
 * appears. Each test picks its own settle signal instead.
 */
function mountViewActions({
  showSaveView = true,
  extraMenuSections,
}: {
  showSaveView?: boolean;
  extraMenuSections?: ReactNode;
} = {}) {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema,
    component: () => (
      <FilterBar
        showSaveView={showSaveView}
        extraMenuSections={extraMenuSections}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router as never} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

/**
 * The toolbar's right-hand action cluster after K30-web.
 *
 * What each test here would catch if it regressed:
 *  - "Save as view" sliding back behind a popover, so the one action
 *    the view offers costs two clicks again;
 *  - the ⋯ rendering with nothing in it — an empty panel, which is
 *    what the sprint detail (`showSaveView={false}`, no extra
 *    sections) would get if the guard were dropped;
 *  - the board's merged Configure section (UI-3) not arriving.
 */
describe("FilterBar — view-actions cluster (UI-2 / UI-3 / K30-web)", () => {
  it("renders the ⋯ only when it has rows, and puts the extra section in it (UI-3)", async () => {
    mountViewActions({
      extraMenuSections: <a role="menuitem" href="/settings/card-layout" data-testid="x-link">Card layout</a>,
    });
    const cluster = await screen.findByTestId("view-actions");
    // The star is still a direct button beside the menu — the action
    // does not move between views.
    expect(within(cluster).getByTestId("view-actions-save-view")).toBeTruthy();

    fireEvent.click(within(cluster).getByTestId("view-actions-menu"));
    const panel = await screen.findByRole("menu", { name: "View options" });
    expect(within(panel).getByTestId("x-link")).toBeTruthy();
    expect(within(panel).getByTestId("view-actions-extra-section").textContent)
      .toContain("Configure");
    // "Save as view" is NOT also duplicated into the panel.
    expect(within(panel).queryByTestId("view-actions-save-view")).toBeNull();
  });

  it("renders NO ⋯ trigger when extraMenuSections is a falsy ReactNode", async () => {
    // `extraMenuSections={cond && <X/>}` passes `false` — defined, but
    // rendering nothing. An `!== undefined` check alone would open an
    // empty panel here.
    mountViewActions({ extraMenuSections: false });
    const cluster = await screen.findByTestId("view-actions");
    expect(within(cluster).queryByTestId("view-actions-menu")).toBeNull();
  });

  it("renders NO cluster at all on the sprint detail (showSaveView=false, no extra rows)", async () => {
    // The sprint detail has its own header actions. With nothing to
    // show, the bar must render neither a stray ⋯ nor an empty
    // bordered slot where the cluster used to be.
    mountViewActions({ showSaveView: false });
    // Settle on a control the bar always renders, so "nothing found"
    // below means the cluster is absent rather than the bar unmounted.
    await screen.findByRole("button", { name: /Filter Status/ });
    expect(screen.queryByTestId("view-actions")).toBeNull();
    expect(screen.queryByTestId("view-actions-menu")).toBeNull();
    expect(screen.queryByTestId("view-actions-save-view")).toBeNull();
  });
});

/**
 * buildChips — LST-33 dangling-reference detection (unit).
 *
 * The pure function behind the filter chips. A chip is "dangling" when
 * its value names an entity the tracker no longer has — but ONLY once
 * that facet's option source has successfully loaded. The load-state
 * gate is the whole point: without it, a valid chip renders as
 * "(no longer exists)" during the fetch window (or forever, if the
 * source errors). This asserts that gate directly rather than waiting a
 * timing window out through the rendered page.
 */
describe("buildChips — LST-33 dangling detection", () => {
  const emptyOpts: FacetOptions = {
    project: [], status: [], priority: [], type: [],
    assignee: [], reporter: [], labels: [],
    milestone: [], sprint: [],
  };
  const allLoaded = new Set<FacetKey>([
    "project", "status", "priority", "type",
    "assignee", "reporter", "labels", "milestone", "sprint",
  ]);

  it("a value that resolves to an option is not dangling", () => {
    const opts: FacetOptions = { ...emptyOpts, milestone: [{ value: "m1", label: "v2" }] };
    const chips = buildChips({ milestone: ["m1"] }, opts, [], allLoaded, true);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.dangling).toBe(false);
    expect(chips[0]?.label).toBe("v2");
  });

  it("a value with no matching option, once the facet loaded, IS dangling", () => {
    const chips = buildChips({ milestone: ["gone"] }, emptyOpts, [], allLoaded, true);
    expect(chips[0]?.dangling).toBe(true);
    expect(chips[0]?.label).toBe("gone");
  });

  it("a value with no matching option, while the facet is NOT loaded, is NOT dangling", () => {
    // The loading-race guard: milestones not yet in `loadedFacets` (still
    // fetching, or errored) must never be judged dangling — a valid chip
    // would otherwise flash/stick as "no longer exists".
    const notLoaded = new Set<FacetKey>(); // nothing loaded yet
    const chips = buildChips({ milestone: ["m1"] }, emptyOpts, [], notLoaded, true);
    expect(chips[0]?.dangling).toBe(false);
  });

  it("a custom-field value is only dangling once the workflow config loaded", () => {
    const cf = [{
      key: "team", label: "Team", type: "enum" as const, multi: false, searchable: false,
      values: [{ key: "core", label: "Core" }],
    }];
    const search = { "field.team": ["ghost"] } as Record<string, string[]>;
    // Workflow not loaded → not dangling.
    expect(buildChips(search, emptyOpts, cf, allLoaded, false)[0]?.dangling).toBe(false);
    // Workflow loaded, value missing → dangling.
    expect(buildChips(search, emptyOpts, cf, allLoaded, true)[0]?.dangling).toBe(true);
  });
});

describe("FilterBar — custom-field filter when the workflow cannot load (LST-57)", () => {
  // @verifies LST-57
  it("keeps the custom-field filter on screen, marked unavailable, instead of dropping it", async () => {
    workflowFails = true;
    await mountFilterBar("?vf=status,field.team&field.team=core");
    // Before B2 the custom id was filtered out of the visible set because
    // the (empty) catalog did not contain it — the filter simply vanished.
    const team = await screen.findByRole("button", { name: "Filter team" });
    fireEvent.click(team);
    expect(await screen.findByText(/team options could not be loaded/i)).toBeTruthy();
  });
});
