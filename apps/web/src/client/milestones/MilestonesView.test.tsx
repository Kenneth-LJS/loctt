// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MilestonesView } from "./MilestonesView.tsx";

/**
 * MilestonesView unreadable-notice test (Phase Z, data-flow finding 2).
 *
 * The guarantee under test: `GET /api/milestones?progress=true` carries
 * a top-level `unreadable` list (K28) when a task file cannot be read.
 * The view must SURFACE it — the totals it renders are short by that
 * many, and a silently-shortened total is exactly the undercount K28
 * forbids (P-5). Before the fix the client hook narrowed the response
 * to `.items` and dropped `unreadable`, so nothing on the page said why
 * a total was short.
 *
 * Harness mirrors SprintsView.test.tsx: stub `fetch` so each hook
 * resolves with canned data, mount inside a memory router, assert DOM.
 */

interface UnreadableEntry {
  readonly id: string;
  readonly path: string;
  readonly reason: string;
}

let MILESTONES: { id: string; name: string; progress?: { done: number; total: number; discarded: number; fraction: number } }[] = [];
let UNREADABLE: UnreadableEntry[] = [];
let TASKS: Record<string, unknown>[] = [];

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  if (path.startsWith("/api/milestones")) {
    return {
      items: MILESTONES,
      total: MILESTONES.length,
      offset: 0,
      limit: 1000,
      ...(UNREADABLE.length > 0 ? { unreadable: UNREADABLE } : {}),
    };
  }
  if (path.startsWith("/api/tasks")) {
    return { items: TASKS, total: TASKS.length, offset: 0, limit: 1000 };
  }
  if (path.startsWith("/api/calendar")) {
    return { timezone: "UTC" };
  }
  return {};
}

function stubFetch() {
  const current = globalThis.fetch as typeof globalThis.fetch & { mockRestore?: () => void };
  current.mockRestore?.();
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

let priorQc: QueryClient | undefined;

async function renderView() {
  if (priorQc) {
    await priorQc.cancelQueries();
    priorQc.clear();
  }
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  priorQc = qc;

  const rootRoute = createRootRoute();
  const milestonesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/milestones",
    component: () => <MilestonesView />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([milestonesRoute]),
    history: createMemoryHistory({ initialEntries: ["/milestones"] }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  MILESTONES = [];
  UNREADABLE = [];
  TASKS = [];
});

describe("MilestonesView — unreadable task notice (K28 / P-5)", () => {
  it("surfaces the unreadable count when the progress response carries one", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    UNREADABLE = [
      { id: "tk_bad", path: ".loctt/tasks/tk_bad/task.md", reason: "invalid YAML" },
    ];
    await renderView();

    const notice = await screen.findByTestId("milestones-unreadable");
    // Names the count, so the reader knows the total below is short.
    expect(notice.textContent).toContain("1");
    expect(notice.textContent?.toLowerCase()).toContain("could not be read");
    // The healthy milestone still renders — one unreadable task never
    // blanks the surface.
    expect(await screen.findByTestId("milestone-row")).toBeTruthy();
  });

  it("renders no notice when nothing is unreadable", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 2, total: 2, discarded: 0, fraction: 1 } },
    ];
    UNREADABLE = [];
    await renderView();

    await screen.findByTestId("milestone-row");
    await waitFor(() => {
      expect(screen.queryByTestId("milestones-unreadable")).toBeNull();
    });
  });
});
