// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listSearchSchema } from "../router/listSearch.ts";
import { buildChips, type FacetKey, type FacetOptions, FilterBar } from "./FilterBar.tsx";

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

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return Promise.resolve(new Response(JSON.stringify(routeFetch(path)), { status: 200, headers: { "Content-Type": "application/json" } }));
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
    fireEvent.click(screen.getByRole("button", { name: "Filter Reporter" }));
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

  it("toggling 'Show archived' sets the archived flag", async () => {
    const router = await mountFilterBar();
    fireEvent.click(screen.getByLabelText("Show archived"));
    await vi.waitFor(() => expect(search(router).archived).toBe(true));
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

  it("hides 'Save as view' when the scope would not be reproduced by one", async () => {
    await mountScopedFilterBar();
    expect(screen.queryByRole("button", { name: /Save as view/ })).toBeNull();
  });

  it("still shows 'Save as view' on the list, where the URL is the whole state", async () => {
    await mountFilterBar();
    expect(screen.getByRole("button", { name: /Save as view/ })).toBeTruthy();
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
