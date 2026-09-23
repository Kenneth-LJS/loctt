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
import { BoardView } from "./BoardView.tsx";

/**
 * @verifies VUE-22 (A313/A314, board parity)
 *
 * `ListView.broken-view.test.tsx` and `TimelineView.broken-view.test.tsx`
 * cover the identical defect on those two surfaces (A313): `?view=<broken>`
 * returns every task in the tracker, unfiltered, alongside a non-fatal
 * `broken_view` diagnostic on `/api/tasks`. `BoardView.tsx` consumes the
 * same `useTasksFeed` page shape and had the identical gap — no banner,
 * and a card drawn for every unfiltered task — tracked in known-gaps.md
 * as "BoardView renders unfiltered cards under a broken saved view" and
 * closed by this same fix shape (A314).
 */
let TASKS_EXTRA: Record<string, unknown> = {};

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  if (path.startsWith("/api/tasks")) {
    return {
      items: [
        { id: "01A", key: "T-1", status: "todo" },
        { id: "01B", key: "T-2", status: "todo" },
      ],
      total: 2,
      offset: 0,
      limit: 200,
      ...TASKS_EXTRA,
    };
  }
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: [{ key: "todo", label: "To do", category: "pending" }],
      priorities: [],
      task_types: [],
    };
  }
  if (path.startsWith("/api/user-settings")) {
    return { settings: {} };
  }
  if (path.startsWith("/api/projects")) {
    return { items: [], total: 0, offset: 0, limit: 1000, default: null };
  }
  if (path.startsWith("/api/users")) {
    return { items: [], total: 0, offset: 0, limit: 1000, current: null };
  }
  if (
    path.startsWith("/api/labels")
    || path.startsWith("/api/milestones")
    || path.startsWith("/api/sprints")
  ) {
    return { items: [], total: 0, offset: 0, limit: 1000 };
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

function mountBoard(initialSearch = "") {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const boardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/board",
    component: () => (
      <CreateTaskProvider>
        <BoardView />
      </CreateTaskProvider>
    ),
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <div data-testid="settings-stub" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([boardRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: [`/board${initialSearch}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  TASKS_EXTRA = {};
});

describe("the board under a broken saved view (UI-24 / A313 / A314)", () => {
  it("shows a broken-view banner and does not draw cards for the unfiltered tasks", async () => {
    TASKS_EXTRA = {
      broken_view: {
        id: "01BROKEN",
        name: "Busted",
        error: "unexpected token at position 9",
        position: 9,
      },
    };
    mountBoard("?view=01BROKEN");

    const banner = await screen.findByTestId("board-broken-view");
    expect(banner.textContent).toContain("Busted");
    expect(screen.getByTestId("board-broken-view-error").textContent)
      .toContain("unexpected token at position 9");

    // The load-bearing assertion: before this fix, neither the banner nor
    // this suppression existed, and both unfiltered tasks (T-1, T-2) were
    // drawn as cards.
    expect(screen.queryByTestId("board-card-T-1")).toBeNull();
    expect(screen.queryByTestId("board-card-T-2")).toBeNull();
  });

  it("does not show the board-level empty state under the banner, even when the tracker's real total is zero", async () => {
    // `total: 0` here is what actually exercises the guard: BRD-40's
    // "No tasks yet" fires on `total === 0`, and the honest unfiltered
    // total (not suppressed, unlike `items`) can legitimately be zero.
    // Without the explicit `brokenView === undefined` gate this would
    // render "No tasks yet" underneath the broken-view banner — a second,
    // misleading message implying the tracker itself is empty rather
    // than that its filter never ran.
    TASKS_EXTRA = {
      broken_view: { id: "01BROKEN", name: "Busted", error: "bad op" },
      total: 0,
    };
    mountBoard("?view=01BROKEN");

    await screen.findByTestId("board-broken-view");
    expect(screen.queryByTestId("board-empty")).toBeNull();
    expect(screen.queryByText(/No tasks yet/i)).toBeNull();
  });

  it("still draws cards normally once the view is no longer broken (no view param)", async () => {
    TASKS_EXTRA = {};
    mountBoard("");

    expect(await screen.findByTestId("board-card-T-1")).toBeTruthy();
    expect(screen.getByTestId("board-card-T-2")).toBeTruthy();
    expect(screen.queryByTestId("board-broken-view")).toBeNull();
  });
});
