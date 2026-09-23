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

import { resetTaskOriginForTest, takeTaskOrigin } from "../router/taskOrigin.ts";
import { MilestoneDetail } from "./MilestoneDetail.tsx";

/**
 * UI-12. "Whole row clickable" for MilestoneDetail's own task table
 * (MilestoneDetail.tsx:~341) — the same request Ken raised while
 * looking at this exact table (ui-issues.md UI-12). Guarded by the same
 * `shouldNavigateRow` the main list uses; rowNavigation.test.ts covers
 * the guard's decision logic directly, this file covers the wiring.
 */

interface Milestone {
  readonly id: string;
  readonly name: string;
  readonly target_date?: string;
  readonly progress?: { done: number; total: number; discarded: number; fraction: number };
}

let MILESTONES: Milestone[] = [];

const TASKS = {
  items: [
    {
      id: "01TASKAAAA0000000000000000",
      key: "WEB-1",
      title: "A milestone task",
      status: "in_progress",
      priority: "high",
      task_type: "feature",
    },
  ],
  total: 1,
  offset: 0,
  limit: 1000,
};

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  if (path.startsWith("/api/milestones")) {
    return { items: MILESTONES, total: MILESTONES.length, offset: 0, limit: 1000 };
  }
  if (path.startsWith("/api/tasks")) return TASKS;
  if (path.startsWith("/api/calendar")) return { timezone: "UTC" };
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: [{ key: "in_progress", label: "In progress", category: "active" }],
      priorities: [{ key: "high", label: "High" }],
      task_types: [{ key: "feature", label: "Feature" }],
      relationship_types: [],
    };
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

async function renderDetail(id: string) {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/milestones/$id",
    component: () => <MilestoneDetail milestoneId={id} />,
  });
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$key",
    component: function TaskRoute() {
      const { key } = taskRoute.useParams();
      return <div data-testid="task-detail-stub">{key}</div>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([detailRoute, taskRoute]),
    history: createMemoryHistory({ initialEntries: [`/milestones/${id}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByText("A milestone task");
  return router;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetTaskOriginForTest();
  MILESTONES = [];
});

describe("MilestoneDetail task table row click (UI-12)", () => {
  // @verifies UI-12 (whole row clickable, MilestoneDetail's own table)
  it("navigates to the task when clicking anywhere in the row, not just the key", async () => {
    MILESTONES = [{ id: "ms_1", name: "Beta launch" }];
    const router = await renderDetail("ms_1");
    const row = screen.getByText("A milestone task").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByText("A milestone task"));

    const stub = await screen.findByTestId("task-detail-stub");
    expect(stub.textContent).toBe("WEB-1");
    expect(router.state.location.pathname).toBe("/tasks/WEB-1");
  });

  // @verifies UI-12 (modifier-click must not navigate in place)
  it("does not navigate on a ctrl-click on the row", async () => {
    MILESTONES = [{ id: "ms_1", name: "Beta launch" }];
    const router = await renderDetail("ms_1");
    const row = screen.getByText("A milestone task").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByText("A milestone task"), { ctrlKey: true });

    expect(screen.queryByTestId("task-detail-stub")).toBeNull();
    expect(router.state.location.pathname).toBe("/milestones/ms_1");
  });

  // @verifies UI-12 (origin recorded so the task's back link returns here)
  it("records the milestone detail URL as the task's origin", async () => {
    MILESTONES = [{ id: "ms_1", name: "Beta launch" }];
    await renderDetail("ms_1");
    const row = screen.getByText("A milestone task").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByText("A milestone task"));
    await screen.findByTestId("task-detail-stub");

    const origin = takeTaskOrigin();
    expect(origin?.pathname).toBe("/milestones/ms_1");
  });
});
