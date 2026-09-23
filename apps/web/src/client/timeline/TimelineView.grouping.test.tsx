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
 * TML-59: a grouping that names a custom field no longer eligible (here:
 * `field.area` deleted from `workflow.yaml`) degrades to the next
 * resolvable layer with a visible notice naming the dropped key — it
 * does not crash and does not draw a single mislabelled band.
 *
 * The pure resolution logic (`resolveGrouping`'s defer-then-fall-to-none
 * chain) is unit-tested in `timeline/settings.test.ts`. This file covers
 * the half that logic alone cannot: that the resolved `dangling` value
 * actually reaches a rendered, visible notice.
 */

function routeFetch(path: string): { body: unknown; status: number } {
  if (path.startsWith("/api/workflow")) {
    return {
      status: 200,
      body: {
        statuses: [{ key: "in_progress", label: "In progress", category: "active" }],
        priorities: [{ key: "high", label: "High" }],
        task_types: [{ key: "feature", label: "Feature" }],
        relationships: [],
        // `area` does not exist here — the URL's `field.area` is dangling.
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
        taskCount: 0,
        keyPrefix: "WEB-",
        nextKey: "WEB-1",
        schemaStatus: { kind: "current", version: 3 },
        cwd: "~/PDev/loctt",
        today: "2026-03-04",
        timezone: "UTC",
      },
    };
  }
  if (path.startsWith("/api/tasks")) {
    return { status: 200, body: { items: [], total: 0, offset: 0, limit: 200 } };
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
  const router = createRouter({
    routeTree: rootRoute.addChildren([timelineRoute]),
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

Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;

describe("the timeline's dangling-grouping notice (TML-59)", () => {
  // @verifies TML-59
  it("names the dropped key and does not crash when the URL's grouping field no longer resolves", async () => {
    mountTimeline("?grouping=field.area");
    const notice = await screen.findByTestId("timeline-grouping-config-error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("timeline-grouping-dangling-key").textContent).toBe("field.area");
    // Falls back to flat rather than drawing a mislabelled band.
    expect(notice.textContent).toContain("flat");
  });

  // @verifies TML-59
  it("shows no notice at all when the grouping resolves normally", async () => {
    mountTimeline("?grouping=status");
    // Let the view settle (workflow + tasks load) before asserting absence.
    await screen.findByRole("heading", { name: "Timeline", level: 1 });
    expect(screen.queryByTestId("timeline-grouping-config-error")).toBeNull();
  });
});
