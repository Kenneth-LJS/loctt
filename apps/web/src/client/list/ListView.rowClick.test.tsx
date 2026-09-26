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

import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { listSearchSchema } from "../router/listSearch.ts";
import { taskDetailSearchSchema } from "../router/taskDetailSearch.ts";
import { resetTaskOriginForTest } from "../router/taskOrigin.ts";
import { ToastProvider } from "../ui/Toast.tsx";
import { ListView } from "./ListView.tsx";

/**
 * UI-12. "Whole row clickable", plus the origin it records for the
 * detail page's back affordance. `rowNavigation.test.ts` covers the
 * guard's decision logic directly (selection, modifiers, interactive
 * children); this file covers the wiring — that a real click on the
 * list's row actually navigates, that a modifier-click does not, and
 * that opening a task records this exact URL (filters included) as the
 * origin for `TaskDetail`'s back link.
 */

function WrappedListView() {
  return (
    <ToastProvider>
      <CreateTaskProvider>
        <ListView />
      </CreateTaskProvider>
    </ToastProvider>
  );
}

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
  if (path.startsWith("/api/user-settings")) return { user: "u_ken", settings: {} };
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

/** A minimal stand-in for the real TaskDetail — this file's subject is
 * the LIST side (does a row click navigate, does it record the origin),
 * not the detail page's own render, which TaskDetail.backAffordance.test.tsx
 * covers directly. */
function TaskDetailStub({ taskKey }: { readonly taskKey: string }) {
  return <div data-testid="task-detail-stub">{taskKey}</div>;
}

async function mountListWithTaskRoute(initialSearch = "") {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: WrappedListView,
  });
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$key",
    validateSearch: taskDetailSearchSchema,
    component: function TaskRoute() {
      const { key } = taskRoute.useParams();
      return <TaskDetailStub taskKey={key} />;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, taskRoute]),
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
  resetTaskOriginForTest();
});

describe("ListView row click (UI-12)", () => {
  // @verifies LST-5 (whole row clickable)
  it("navigates to the task when clicking anywhere in the row, not just the key", async () => {
    const router = await mountListWithTaskRoute();
    const row = screen.getByText("First task").closest("tr") as HTMLElement;

    // Click the title cell — not the key link.
    fireEvent.click(within(row).getByText("First task"));

    const stub = await screen.findByTestId("task-detail-stub");
    expect(stub.textContent).toBe("WEB-1");
    expect(router.state.location.pathname).toBe("/tasks/WEB-1");
  });

  // @verifies LST-5 (modifier-click must not navigate in place)
  it("does not navigate on a ctrl-click on the row", async () => {
    const router = await mountListWithTaskRoute();
    const row = screen.getByText("First task").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByText("First task"), { ctrlKey: true });

    expect(screen.queryByTestId("task-detail-stub")).toBeNull();
    expect(router.state.location.pathname).toBe("/list");
  });

  // @verifies LST-5 (the kebab / checkbox must not navigate)
  it("does not navigate when clicking the row's select checkbox", async () => {
    const router = await mountListWithTaskRoute();
    const checkbox = screen.getByLabelText("Select WEB-1");

    fireEvent.click(checkbox);

    expect(screen.queryByTestId("task-detail-stub")).toBeNull();
    expect(router.state.location.pathname).toBe("/list");
  });

  // @verifies LST-5 (the origin recorded for the back affordance carries
  // the full URL this view was showing, search params included)
  //
  // This test's router (unlike the real app's, wired in router/index.tsx)
  // uses TanStack's default stringifier rather than the app's CSV one
  // (`?status=in_progress`), so the recorded href's *search string*
  // encoding differs from what a user would actually see in the address
  // bar — that format is asserted elsewhere (listSearch.test.ts /
  // router/index.tsx's own stringifySearch). What this test pins is the
  // thing that's actually this file's subject: the recorded origin is
  // THIS route (`/list`) with THIS render's filter still present, not a
  // bare `/list`.
  it("records this view's full URL — filters included — as the task's origin", async () => {
    const { takeTaskOrigin } = await import("../router/taskOrigin.ts");
    await mountListWithTaskRoute("?status=in_progress&page=2");
    const row = screen.getByText("First task").closest("tr") as HTMLElement;

    fireEvent.click(within(row).getByText("First task"));
    await screen.findByTestId("task-detail-stub");

    const origin = takeTaskOrigin();
    expect(origin?.pathname).toBe("/list");
    expect(origin?.search).toContain("status");
    expect(origin?.search).toContain("page=2");
    expect(origin?.href).toBe(`${origin?.pathname}${origin?.search}`);
  });
});
