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
 * @verifies VUE-22 (A313, timeline parity)
 *
 * The list's `broken_view` defect (ListView.broken-view.test.tsx) has an
 * identical shape here: `?view=<broken>` returns every task in the
 * tracker, unfiltered, alongside a non-fatal `broken_view` diagnostic —
 * and before this fix the timeline had no banner for it at all AND drew
 * a bar for every one of those unfiltered tasks. Both `useTasksFeed`
 * hooks (list and timeline) receive the same page shape; only the list
 * had a consumer for `broken_view` before this change.
 */
let TASKS_EXTRA: Record<string, unknown> = {};

function routeFetch(path: string): { body: unknown; status: number } {
  if (path.startsWith("/api/calendar")) {
    return { status: 200, body: { working_days: [1, 2, 3, 4, 5], holidays: [] } };
  }
  if (path.startsWith("/api/workflow")) {
    return {
      status: 200,
      body: {
        statuses: [{ key: "in_progress", label: "In progress", category: "active" }],
        priorities: [{ key: "high", label: "High" }],
        task_types: [{ key: "feature", label: "Feature" }],
        relationships: [],
        custom_fields: [],
      },
    };
  }
  if (path.startsWith("/api/info")) {
    return {
      status: 200,
      body: {
        exists: true,
        initState: "ready",
        defaultUserName: "you",
        taskCount: 0,
        keyPrefix: "WEB-",
        nextKey: "WEB-1",
        schemaStatus: { kind: "current", version: 3 },
        cwd: "~/PDev/loctt",
        today: "2026-08-14",
        timezone: "UTC",
      },
    };
  }
  if (path.startsWith("/api/tasks")) {
    return {
      status: 200,
      body: {
        items: [
          {
            id: "01A", key: "T-1", title: "Alpha", project: "p1",
            start_date: "2026-08-10", due_date: "2026-08-14",
          },
          {
            id: "01B", key: "T-2", title: "Beta", project: "p1",
            start_date: "2026-08-11", due_date: "2026-08-15",
          },
        ],
        total: 2,
        offset: 0,
        limit: 200,
        ...TASKS_EXTRA,
      },
    };
  }
  return { status: 200, body: { items: [], total: 0, offset: 0, limit: 100 } };
}

function stubFetch() {
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
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([timelineRoute, settingsRoute]),
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
  TASKS_EXTRA = {};
});

// jsdom does not implement `Element.scrollTo` (no layout engine); the
// timeline's today-centring effect calls it once real bars render. Only
// the "no view" control scenario below reaches that path — the two
// broken-view scenarios never draw a bar, so they never call it.
Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;

describe("the timeline under a broken saved view (VUE-22 / A313)", () => {
  it("shows a broken-view banner and does not draw bars for the unfiltered tasks", async () => {
    TASKS_EXTRA = {
      broken_view: {
        id: "01BROKEN",
        name: "Busted",
        error: "unexpected token at position 9",
        position: 9,
      },
    };
    mountTimeline("?view=01BROKEN");

    const banner = await screen.findByTestId("timeline-broken-view");
    expect(banner.textContent).toContain("Busted");
    expect(screen.getByTestId("timeline-broken-view-error").textContent)
      .toContain("unexpected token at position 9");

    // The load-bearing assertion: before this fix, neither the banner
    // nor this suppression existed, and both unfiltered tasks (Alpha,
    // Beta) were drawn as bars.
    expect(screen.queryByTestId("timeline-bar-T-1")).toBeNull();
    expect(screen.queryByTestId("timeline-bar-T-2")).toBeNull();
  });

  it("does not show 'No tasks match this view' under the banner", async () => {
    TASKS_EXTRA = {
      broken_view: { id: "01BROKEN", name: "Busted", error: "bad op" },
    };
    mountTimeline("?view=01BROKEN");

    await screen.findByTestId("timeline-broken-view");
    // The ordinary noRows empty state is a different, false claim here
    // — the filter never ran, so this must not render underneath.
    expect(screen.queryByTestId("timeline-empty")).toBeNull();
    expect(screen.queryByText(/No tasks match this view/i)).toBeNull();
  });

  it("still draws bars normally once the view is no longer broken (no view param)", async () => {
    TASKS_EXTRA = {};
    mountTimeline("");

    expect(await screen.findByTestId("timeline-bar-T-1")).toBeTruthy();
    expect(screen.getByTestId("timeline-bar-T-2")).toBeTruthy();
    expect(screen.queryByTestId("timeline-broken-view")).toBeNull();
  });
});
