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

import { timelineSearchSchema } from "../router/timelineSearch.ts";
import { TimelineView } from "./TimelineView.tsx";

/**
 * Config-discoverability (audit P3, K100): the timeline's two config
 * banners named `workflow.yaml` / `calendar.yaml` with no way to act on
 * them from inside the app. Each now links to the Settings section that
 * owns the fix — Timeline settings for the dependency relationship, and
 * Calendar settings for the timezone/calendar file.
 */

/** Fails `/api/calendar` so the calendar-error banner renders. */
let FAIL_CALENDAR = false;

function routeFetch(path: string): { body: unknown; status: number } {
  if (path.startsWith("/api/calendar")) {
    if (FAIL_CALENDAR) {
      return {
        status: 500,
        body: { code: "config_invalid", message: "calendar.yaml could not be read." },
      };
    }
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
        // Names a relationship key that `relationships` does not define —
        // the trigger for the dependency-config banner (TML-34).
        timeline: { dependency_relationship: "blocks" },
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

function mountTimeline() {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const timelineRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/timeline",
    validateSearch: timelineSearchSchema,
    component: TimelineView,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([timelineRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/timeline"] }),
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
  FAIL_CALENDAR = false;
});

describe("the timeline config banners", () => {
  it("links the dependency-config banner to Timeline settings", async () => {
    mountTimeline();
    const link = await screen.findByTestId("timeline-dependency-config-settings-link");
    expect(link.getAttribute("href")).toBe("/settings/timeline#field-dependency_relationship");
  });

  it("links the calendar-error banner to Calendar settings", async () => {
    FAIL_CALENDAR = true;
    mountTimeline();
    const link = await screen.findByTestId("timeline-calendar-error-settings-link");
    expect(link.getAttribute("href")).toBe("/settings/calendar#field-timezone");
  });
});
