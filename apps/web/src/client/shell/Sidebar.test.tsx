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
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar.tsx";

/**
 * Sidebar render tests. We stub `fetch` so each query hook resolves
 * with canned config data, mount the Sidebar inside a memory router at
 * a chosen path, and assert the groups render from that data and that
 * the active route is highlighted. This is the closest unit-level proxy
 * for "the sidebar reflects live query data + current route" without a
 * full app boot.
 */

const INFO: TrackerInfoResponse = {
  exists: true,
  taskCount: 7,
  keyPrefix: "WEB-",
  nextKey: "WEB-8",
  schemaStatus: { kind: "current", version: 3 },
  cwd: "~/PDev/loctt",
};

/** Routes a request path to a canned JSON body for the stubbed fetch. */
function routeFetch(path: string): unknown {
  if (path.startsWith("/api/projects")) {
    return {
      items: [
        { id: "p_web", name: "Web", prefix: "WEB-" },
        { id: "p_api", name: "API", prefix: "API-" },
      ],
      total: 2,
      offset: 0,
      limit: 100,
      default: "p_web",
    };
  }
  if (path.startsWith("/api/views")) {
    return { queries: [{ id: "v_mine", name: "My open bugs", query: "x" }] };
  }
  if (path.startsWith("/api/milestones")) {
    return { items: [{ id: "m_v1", name: "v1.0" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/sprints")) {
    return {
      items: [
        { id: "sp_12", name: "Sprint 12", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" },
        { id: "sp_11", name: "Sprint 11", start_date: "2026-05-18", end_date: "2026-05-31", state: "completed" },
      ],
      total: 2,
      offset: 0,
      limit: 100,
    };
  }
  if (path.startsWith("/api/labels")) {
    return { items: [{ id: "l_fe", name: "frontend", color: "#1e6fcb" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/recents")) {
    return { items: [], total: 0, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/tasks")) {
    return { total: 3 }; // built-in count badges
  }
  return {};
}

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

async function renderSidebarAt(pathname: string, search: Record<string, unknown> = {}) {
  stubFetch();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => (
      <Sidebar collapsed={false} info={INFO} currentUserId="u_ken" today="2026-06-08" />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({
      initialEntries: [
        `${pathname}?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(search).map(([k, v]) => [k, String(v)]),
          ),
        ).toString()}`,
      ],
    }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  // Let the router resolve and queries settle.
  await screen.findByText("Projects");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Sidebar", () => {
  it("renders all data-driven groups from query data", async () => {
    await renderSidebarAt("/list");

    // Group headers
    for (const label of ["Projects", "Saved filters", "Milestones", "Sprints", "Labels", "Recently viewed"]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    // Project items
    expect(await screen.findByText("Web")).toBeTruthy();
    expect(screen.getByText("API")).toBeTruthy();
    // User saved view
    expect(await screen.findByText("My open bugs")).toBeTruthy();
    // Milestone + label
    expect(await screen.findByText("v1.0")).toBeTruthy();
    expect(await screen.findByText("frontend")).toBeTruthy();
  });

  it("hides completed sprints, shows active ones", async () => {
    await renderSidebarAt("/list");
    expect(await screen.findByText("Sprint 12")).toBeTruthy();
    expect(screen.queryByText("Sprint 11")).toBeNull();
  });

  it("renders the empty-state note for recents", async () => {
    await renderSidebarAt("/list");
    expect(await screen.findByText("No recent tasks")).toBeTruthy();
  });

  it("renders all six built-in filters including deferred 'Mentions me'", async () => {
    await renderSidebarAt("/list");
    for (const label of [
      "Assigned to me", "Reported by me", "Mentions me",
      "Due this week", "Overdue", "High priority",
    ]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it("shows live count badges on resolvable built-ins but not on 'Mentions me'", async () => {
    await renderSidebarAt("/list");
    // Stubbed /api/tasks returns total: 3 for every count query.
    const highPriority = (await screen.findByText("High priority")).closest("a");
    expect(within(highPriority as HTMLElement).getByText("3")).toBeTruthy();
    // "Mentions me" is deferred: inert text, no link, no badge.
    const mentions = await screen.findByText("Mentions me");
    expect(mentions.closest("a")).toBeNull();
    expect(within(mentions.closest("div") as HTMLElement).queryByText("3")).toBeNull();
  });

  it("highlights the active List view", async () => {
    await renderSidebarAt("/list");
    const list = await screen.findByText("List");
    // The active ItemShell carries data-active="true".
    expect(list.closest("a")?.querySelector("[data-active]")).not.toBeNull();
    // The Board item, by contrast, is not active.
    const board = screen.getByText("Board");
    expect(board.closest("a")?.querySelector("[data-active]")).toBeNull();
  });

  it("marks the active project from the URL search params", async () => {
    await renderSidebarAt("/list", { project: "p_api" });
    const api = await screen.findByText("API");
    expect(api.closest("a")?.querySelector("[data-active]")).not.toBeNull();
    const web = screen.getByText("Web");
    expect(web.closest("a")?.querySelector("[data-active]")).toBeNull();
  });
});
