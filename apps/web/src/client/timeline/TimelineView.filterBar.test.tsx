// @vitest-environment jsdom
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

import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { timelineSearchSchema } from "../router/timelineSearch.ts";
import { ToastProvider } from "../ui/Toast.tsx";
import { TimelineView } from "./TimelineView.tsx";

/**
 * TML-56: the list's shared filter bar is mounted on the timeline, and
 * applying a filter narrows which bars are charted via the SERVER (the
 * `/api/tasks` request itself is narrowed), not the client hiding rows
 * out of a full response.
 */

const TASKS = [
  {
    id: "01T0000000000000000000001",
    key: "T-1",
    title: "In progress task",
    status: "in_progress",
    start_date: "2026-03-02",
    due_date: "2026-03-06",
  },
  {
    id: "01T0000000000000000000002",
    key: "T-2",
    title: "Done task",
    status: "done",
    start_date: "2026-03-03",
    due_date: "2026-03-07",
  },
];

/** Fetch calls made to /api/tasks, so the test can assert the server was asked to narrow. */
let taskRequests: string[] = [];

function routeFetch(path: string): { body: unknown; status: number } {
  if (path.startsWith("/api/workflow")) {
    return {
      status: 200,
      body: {
        statuses: [
          { key: "in_progress", label: "In progress", category: "active" },
          { key: "done", label: "Done", category: "completed" },
        ],
        priorities: [{ key: "high", label: "High" }],
        task_types: [{ key: "feature", label: "Feature" }],
        relationships: [],
        custom_fields: [],
      },
    };
  }
  if (path.startsWith("/api/calendar")) {
    return { status: 200, body: { working_days: [1, 2, 3, 4, 5], holidays: [] } };
  }
  if (path.startsWith("/api/info")) {
    return {
      status: 200,
      body: {
        exists: true,
        initState: "ready",
        defaultUserName: "you",
        taskCount: TASKS.length,
        keyPrefix: "WEB-",
        nextKey: "WEB-3",
        schemaStatus: { kind: "current", version: 3 },
        cwd: "~/PDev/loctt",
        today: "2026-03-04",
        timezone: "UTC",
      },
    };
  }
  if (path.startsWith("/api/tasks")) {
    taskRequests.push(path);
    const url = new URL(path, "http://localhost");
    const status = url.searchParams.get("status");
    // The server-side narrowing this case requires: only rows matching
    // the requested status come back. A client-side-hiding
    // implementation would still request everything and filter in the
    // browser — this stub would not catch that on its own, but the
    // count/row assertions below do: if the client only hid rows the
    // *request* would still carry the full set (2), not 1.
    const items = status === null ? TASKS : TASKS.filter(t => t.status === status);
    return { status: 200, body: { items, total: items.length, offset: 0, limit: 200 } };
  }
  return { status: 200, body: { items: [], total: 0, offset: 0, limit: 100 } };
}

function stubFetch() {
  taskRequests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const { body, status } = routeFetch(path);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mountTimeline(initialSearch = "") {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const timelineRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/timeline",
    validateSearch: timelineSearchSchema,
    component: () => (
      <ToastProvider>
        <CreateTaskProvider>
          <TimelineView />
        </CreateTaskProvider>
      </ToastProvider>
    ),
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([timelineRoute, listRoute]),
    history: createMemoryHistory({ initialEntries: [`/timeline${initialSearch}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement `Element.scrollTo` (no layout engine); the
// timeline's today-centring effect calls it once real bars render.
Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;

describe("the timeline mounts the shared filter bar (TML-56)", () => {
  // @verifies TML-56
  it("the same filter bar the list uses is present on the timeline", async () => {
    mountTimeline();
    // The Status/Priority/Assignee facet buttons are FilterBar's own
    // controls — the same component `from="/timeline"` mounts, not a
    // timeline-private toolbar.
    expect(await screen.findByRole("button", { name: "Filter Status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter Priority" })).toBeTruthy();
  });

  // @verifies TML-56
  it("applying a status filter narrows the charted bars via a narrowed server request", async () => {
    mountTimeline("?status=in_progress");
    // Only the matching task's bar renders.
    expect(await screen.findByTestId("timeline-bar-T-1")).toBeTruthy();
    expect(screen.queryByTestId("timeline-bar-T-2")).toBeNull();
    // The request itself carried the filter — the server did the
    // narrowing, the client did not fetch everything and hide rows.
    expect(taskRequests.some(p => p.includes("status=in_progress"))).toBe(true);
  });

  // @verifies TML-56
  it("the filter is reflected in the URL so the filtered timeline is shareable", async () => {
    mountTimeline("?status=in_progress");
    await screen.findByTestId("timeline-bar-T-1");
    // The Status filter control shows an active count, proving the
    // filter round-tripped from the URL into the visible filter bar
    // rather than being applied invisibly.
    const statusButton = screen.getByRole("button", { name: "Filter Status" });
    expect(statusButton.textContent).toContain("1");
  });
});
