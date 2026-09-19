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

import { listSearchSchema } from "../router/listSearch.ts";
import { ListView } from "./ListView.tsx";

/**
 * Config-discoverability (audit P3, K100): the broken-workflow banner
 * used to name `workflow.yaml` and tell the user to run `loctt doctor`
 * in a terminal — a dead end from inside the app. It now links straight
 * to Settings → Diagnostics, keeping the CLI mention as a fallback.
 */

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/tasks")) {
    return { items: [], total: 0, offset: 0, limit: 50 };
  }
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: [{ key: "in_progress", label: "In progress", category: "active" }],
      priorities: [{ key: "high", label: "High" }],
      task_types: [{ key: "feature", label: "Feature" }],
      relationships: [],
      custom_fields: [],
      // A hand-broken entry the tolerant loader degraded — the trigger
      // for the banner under test.
      broken: {
        statuses: [{ index: 0, error: "category must be one of active, done" }],
      },
    };
  }
  return { items: [], total: 0, offset: 0, limit: 100 };
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

async function mountList() {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: ListView,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByTestId("workflow-config-broken");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the ListView broken-workflow banner", () => {
  it("links to the Settings panel rather than only naming the CLI", async () => {
    await mountList();
    const link = screen.getByTestId("workflow-config-broken-diagnostics-link");
    expect(link.getAttribute("href")).toBe("/settings/diagnostics");
  });
});
