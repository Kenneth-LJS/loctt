// @vitest-environment jsdom
import type { TrackerInfoResponse } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar.tsx";

/**
 * ERR-1 in the sidebar: an absence and a failure must not look alike.
 *
 * Every group read `data?.items ?? []`, so a failed fetch rendered as an
 * empty group. Three groups went further and returned `null` on empty,
 * so a failure made them disappear entirely — the user saw a sidebar
 * with no Sprints section and no reason to think anything was wrong.
 */

const INFO: TrackerInfoResponse = {
  exists: true,
  taskCount: 7,
  keyPrefix: "WEB-",
  nextKey: "WEB-8",
  schemaStatus: { kind: "current", version: 3 },
  cwd: "~/PDev/loctt",
  today: "2026-08-14",
};

const OK = { items: [], total: 0, offset: 0, limit: 100 };

/** Fails exactly one endpoint; everything else resolves empty. */
function stubFetch(failing: string) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith(failing)) return Promise.reject(new TypeError("Failed to fetch"));
    if (path.startsWith("/api/views")) {
      return Promise.resolve(new Response(JSON.stringify({ queries: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify(OK), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  });
}

async function renderSidebar(failing: string, collapsed = false) {
  stubFetch(failing);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => (
      <Sidebar collapsed={collapsed} info={INFO} currentUserId="u_ken" today="2026-06-08" />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByRole("alert");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a sidebar group whose data fails to load", () => {
  it("says so rather than rendering an empty group", async () => {
    await renderSidebar("/api/projects");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/could not load/i);
  });

  it("offers retry as a control", async () => {
    await renderSidebar("/api/projects");
    // ERR-15 applies here too, even though the surface is compact.
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("does not make a group vanish when it fails", async () => {
    // Sprints returns null on empty. Before the fix a failed fetch took
    // that same path, so the group disappeared with no indication that
    // anything had gone wrong — the quietest possible failure.
    await renderSidebar("/api/sprints");
    expect(screen.getByText("Sprints")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("marks the failure even when the sidebar is collapsed", async () => {
    // A collapsed sidebar has no room for prose, but hiding the failure
    // entirely would be the same conflation in a narrower column.
    await renderSidebar("/api/projects", true);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("marks only the group that failed", async () => {
    await renderSidebar("/api/projects");
    // One failing endpoint must not light up every group. The others
    // resolved empty here, which is a legitimate state and correctly
    // renders nothing.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("Projects")).toBeTruthy();
  });
});
