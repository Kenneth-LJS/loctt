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
import { FilterBar } from "./FilterBar.tsx";

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

describe("FilterBar", () => {
  it("selecting a status option writes it to the URL and shows a chip", async () => {
    const router = await mountFilterBar();
    fireEvent.click(screen.getByRole("button", { name: "Filter Status" }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "In progress" }));

    await vi.waitFor(() => expect(search(router).status).toEqual(["in_progress"]));
    // Chip with the human label appears.
    expect(await screen.findByText("In progress")).toBeTruthy();
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
});
