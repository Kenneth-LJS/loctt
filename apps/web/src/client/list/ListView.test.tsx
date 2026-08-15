// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listSearchSchema } from "../router/listSearch.ts";
import { ListView } from "./ListView.tsx";

/**
 * ListView tests. Stub fetch with a small task page + config data,
 * mount the real ListView under a memory router at /list, and assert
 * the table renders the columns, resolves enum/id values to labels,
 * and that clicking a sortable header navigates with the right
 * sort/dir search state (and toggles direction on a second click).
 */

const TASKS = {
  items: [
    {
      id: "01TASKAAAA0000000000000000",
      key: "WEB-1",
      project: "p_web",
      title: "First task",
      status: "in_progress",
      priority: "high",
      task_type: "feature",
      assignee: "u_ken",
      labels: ["l_fe"],
      due_date: "2026-06-20",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-07T00:00:00.000Z",
    },
  ],
  total: 1,
  offset: 0,
  limit: 50,
};

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/tasks")) return TASKS;
  if (path.startsWith("/api/projects")) {
    return { items: [{ id: "p_web", name: "Web", prefix: "WEB-" }], total: 1, offset: 0, limit: 100, default: "p_web" };
  }
  if (path.startsWith("/api/users")) {
    return { items: [{ id: "u_ken", name: "Ken Loh", timezone: "UTC" }], total: 1, offset: 0, limit: 100, current: "u_ken" };
  }
  if (path.startsWith("/api/labels")) {
    return { items: [{ id: "l_fe", name: "frontend", color: "#1e6fcb" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: [{ key: "in_progress", label: "In progress", category: "active" }],
      priorities: [{ key: "high", label: "High" }],
      task_types: [{ key: "feature", label: "Feature" }],
      relationships: [],
      custom_fields: [],
    };
  }
  if (path.startsWith("/api/user-settings")) {
    return { user: "u_ken", settings: {} };
  }
  return {};
}

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

async function mountList(initialSearch = "") {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: ListView,
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
  await screen.findByText("First task");
  return router;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ListView", () => {
  // @verifies LST-2
  it("renders the row with resolved labels for enum/id values", async () => {
    await mountList();
    const row = (await screen.findByText("First task")).closest("tr") as HTMLElement;
    const cells = within(row);
    expect(cells.getByText("WEB-1")).toBeTruthy(); // key
    expect(cells.getByText("WEB")).toBeTruthy(); // project chip (prefix)
    expect(cells.getByText("In progress")).toBeTruthy(); // status label
    expect(cells.getByText("High")).toBeTruthy(); // priority label
    expect(cells.getByText("Feature")).toBeTruthy(); // type label
    expect(cells.getByText("Ken")).toBeTruthy(); // assignee first name
    expect(cells.getByText("frontend")).toBeTruthy(); // label name
  });

  // @verifies LST-2
  it("renders all ten column headers", async () => {
    await mountList();
    for (const h of ["Key", "Project", "Title", "Status", "Priority", "Type", "Assignee", "Labels", "Due", "Updated"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h) })).toBeTruthy();
    }
  });

  // @verifies LST-3
  it("clicking a sortable header sorts ascending, then toggles to descending", async () => {
    const router = await mountList();

    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    await vi.waitFor(() => {
      const s = router.state.location.search as { sort?: string; dir?: string };
      expect(s.sort).toBe("title");
      expect(s.dir).toBe("asc");
    });
    // The header reflects the ascending sort via aria-sort.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Title/ }).getAttribute("aria-sort"),
      ).toBe("ascending"),
    );

    // Re-query the (re-rendered) header before the second click so the
    // bound handler reads the latest sort direction.
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    await vi.waitFor(() => {
      const s = router.state.location.search as { dir?: string };
      expect(s.dir).toBe("desc");
    });
  });

  it("resets to ascending when switching to a different sort column", async () => {
    const router = await mountList("?sort=updated_at&dir=desc");
    // Currently sorted by Updated desc; click Title → new column, asc.
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    await vi.waitFor(() => {
      const s = router.state.location.search as { sort?: string; dir?: string };
      expect(s.sort).toBe("title");
      expect(s.dir).toBe("asc");
    });
  });

  it("falls back to raw values for ids/keys that no longer resolve", async () => {
    // Task references a deleted assignee, label, and unknown status —
    // the row must still render without crashing.
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      let body: unknown = routeFetch(path);
      if (path.startsWith("/api/tasks")) {
        body = {
          items: [{
            id: "01TASKBBBB0000000000000000",
            key: "WEB-2",
            title: "Orphan refs",
            status: "ghost_status",
            assignee: "u_deleted_0000000000",
            labels: ["l_gone"],
            created_at: "2026-06-01T00:00:00.000Z",
            updated_at: "2026-06-07T00:00:00.000Z",
          }],
          total: 1, offset: 0, limit: 50,
        };
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute();
    const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema, component: ListView });
    const router = createRouter({ routeTree: rootRoute.addChildren([listRoute]), history: createMemoryHistory({ initialEntries: ["/list"] }) });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    const row = (await screen.findByText("Orphan refs")).closest("tr") as HTMLElement;
    const cells = within(row);
    // Unknown status key renders the raw key, not a blank.
    expect(cells.getByText("ghost_status")).toBeTruthy();
    // Deleted user renders a truncated id rather than crashing.
    expect(cells.getByText(/u_delete/)).toBeTruthy();
  });

  it("renders the empty state when no tasks match", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const body = path.startsWith("/api/tasks") ? { items: [], total: 0, offset: 0, limit: 50 } : routeFetch(path);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute();
    const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema, component: ListView });
    const router = createRouter({ routeTree: rootRoute.addChildren([listRoute]), history: createMemoryHistory({ initialEntries: ["/list"] }) });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No tasks match these filters.")).toBeTruthy();
  });
});
