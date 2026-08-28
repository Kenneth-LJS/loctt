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

/** Fails the named endpoints; everything else resolves empty. */
function stubFetch(...failing: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (failing.some(f => path.startsWith(f))) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
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

async function renderSidebar(failing: string | string[], collapsed = false) {
  stubFetch(...(Array.isArray(failing) ? failing : [failing]));
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

/**
 * @verifies SHL-39
 *
 * "No labels" and "couldn't load labels" are different claims. Every
 * group used `data?.items ?? []`, so a failed fetch rendered as an
 * empty group — and for the three groups that hide when empty, as no
 * group at all.
 */
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

/**
 * @verifies ONB-34, ERR-28
 *
 * Recents is the case where the two claims are easiest to confuse: a
 * fresh tracker legitimately has none, so "you haven't viewed
 * anything" and "we couldn't check" both look like an empty group
 * unless one of them says otherwise.
 */
describe("Recently viewed failing on its own", () => {
  it("shows a scoped failure distinguishable from its empty state", async () => {
    await renderSidebar("/api/recents");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/could not load/i);
    // Not the empty copy — that would be a claim about the data.
    expect(screen.queryByText(/No recent tasks/)).toBeNull();
    // Retry for that group alone.
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // Everything else is untouched, including groups that are simply
    // empty and say so.
    expect(screen.getByText(/No labels yet/)).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

/**
 * @verifies ERR-29
 *
 * Two unrelated failures at once stay two failures: attributable to
 * their own regions, neither overwriting the other.
 */
describe("two unrelated sidebar failures at once", () => {
  it("surfaces both, each in its own group", async () => {
    await renderSidebar(["/api/labels", "/api/recents"]);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);

    // Each sits inside the group it belongs to, rather than being
    // merged into one ambiguous banner.
    const labels = screen.getByText("Labels").parentElement as HTMLElement;
    const recents = screen.getByText("Recently viewed").parentElement as HTMLElement;
    expect(labels.querySelector('[role="alert"]')).not.toBeNull();
    expect(recents.querySelector('[role="alert"]')).not.toBeNull();

    // A group that is merely empty is not swept into the failure.
    expect(screen.getByText(/No milestones yet/)).toBeTruthy();
  });
});
