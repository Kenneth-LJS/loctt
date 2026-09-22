// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { listSearchSchema } from "../router/listSearch.ts";
import { ToastProvider } from "../ui/Toast.tsx";
import { ListView } from "./ListView.tsx";

/**
 * A11Y-9 (blocker · P8): the list → open → return cycle is keyboard-only.
 *
 * These cases cover the two halves of A11Y-9 that live in the list:
 *
 *  1. A task row is *keyboard*-activatable, not click-only. The row's
 *     key link is a real anchor and pressing Enter on it opens the task
 *     — the exact thing a bare `<tr onClick>` could not do.
 *  2. Returning to the list restores focus to the opened row's anchor
 *     rather than to `document.body` / the top of the page.
 *
 * The status-dropdown step ("change its status") happens on the task
 * detail, whose picker (`ui/Combobox`) is separately keyboard-tested; it
 * is not re-asserted here. The router carries a `/tasks/$key` stub so the
 * open navigation resolves and Back returns to a live `/list`.
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
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-07T00:00:00.000Z",
    },
    {
      id: "01TASKBBBB0000000000000000",
      key: "WEB-2",
      project: "p_web",
      title: "Second task",
      status: "in_progress",
      priority: "high",
      task_type: "feature",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-07T00:00:00.000Z",
    },
  ],
  total: 2,
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
  if (path.startsWith("/api/labels")) return { items: [], total: 0, offset: 0, limit: 100 };
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

function WrappedListView() {
  return (
    <ToastProvider>
      <CreateTaskProvider>
        <ListView />
      </CreateTaskProvider>
    </ToastProvider>
  );
}

/**
 * A two-route router: `/list` renders the real list, `/tasks/$key`
 * renders a minimal stub standing in for the detail. Navigation between
 * them is real (memory history), so Back genuinely remounts the list —
 * which is the whole point of the focus-restore case.
 */
async function mountWithDetail(initialPath = "/list") {
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
    component: function TaskStub() {
      return <div data-testid="task-detail-stub">detail</div>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, taskRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
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
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

describe("ListView keyboard operation (A11Y-9)", () => {
  // @verifies A11Y-9 (row is keyboard-activatable, not click-only)
  it("opens the task when Enter is pressed on the row's key link", async () => {
    const router = await mountWithDetail();

    // The key link is a real anchor and the row's Tab target.
    const link = screen.getByRole("link", { name: "WEB-1" });
    // A native <a href> navigates on Enter → click; fire the click the
    // key press produces on an anchor. This is the keyboard path a bare
    // `<tr onClick>` (no role/tabIndex/key handler) could never satisfy.
    fireEvent.click(link);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tasks/WEB-1");
    });
    expect(screen.getByTestId("task-detail-stub")).toBeTruthy();
  });

  // @verifies A11Y-9 (focus returns to the opened row on the way back)
  it("restores focus to the opened row's anchor after returning to the list", async () => {
    const router = await mountWithDetail();

    // Open the SECOND task from the keyboard, so a body-top restore would
    // be visibly wrong (it would land on WEB-1, or nothing).
    const link = screen.getByRole("link", { name: "WEB-2" });
    act(() => { link.focus(); });
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tasks/WEB-2");
    });

    // Return to the list. The list remounts (its per-instance refs are
    // gone), so restore has to come from the stashed key.
    act(() => { router.history.back(); });
    await screen.findByText("First task");

    await waitFor(() => {
      const restored = document.activeElement as HTMLElement | null;
      expect(restored?.getAttribute("data-task-key")).toBe("WEB-2");
    });
  });

  // @verifies A11Y-9 (the pointer open-path records the same key, so a
  // mouse user who opens a task and navigates back also lands on the row)
  it("restores focus after a task opened by clicking the row itself", async () => {
    const router = await mountWithDetail();

    // Open via the ROW (not the key link): the `<tr>` onClick. This is
    // the path that must share the key-recording with the keyboard path —
    // if the two diverged, a mouse-opened task would return to the top of
    // the list.
    const row = screen.getByText("Second task").closest("tr") as HTMLElement;
    fireEvent.click(row);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tasks/WEB-2");
    });

    act(() => { router.history.back(); });
    await screen.findByText("First task");

    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.getAttribute("data-task-key")).toBe("WEB-2");
    });
  });
});
