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

import { SprintsView } from "./SprintsView.tsx";

/**
 * SprintsView corruption tests (Phase-7B, surface agent S2).
 *
 * The guarantee under test: a corrupt **sprint-config entry** (A138's
 * `broken` list on `GET /api/sprints`) is SURFACED on the sprints view —
 * named, marked broken — rather than silently dropped; and a corrupt
 * **task** (one carrying `health`) does not vanish from its column and
 * does not crash the view.
 *
 * We stub `fetch` so each hook resolves with canned data, mount the view
 * inside a memory router, and assert against the rendered DOM — the same
 * shape Sidebar.test.tsx uses, which is the closest unit-level proxy for
 * "the view reflects live query data" without a full app boot.
 */

/** Per-test `broken` list ridden by `GET /api/sprints` (A138). */
let BROKEN_SPRINTS: { id?: string; index: number; rawText: string; error: string }[] = [];

/** Per-test valid sprints. */
let SPRINTS: { id: string; name: string; start_date: string; end_date: string; state: string }[] = [
  { id: "sp_12", name: "Sprint 12", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" },
];

/** Per-test tasks returned by `GET /api/tasks`. */
let TASKS: Record<string, unknown>[] = [];

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: TASKS.length, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  if (path.startsWith("/api/sprints")) {
    return {
      items: SPRINTS,
      total: SPRINTS.length,
      offset: 0,
      limit: 1000,
      ...(BROKEN_SPRINTS.length > 0 ? { broken: BROKEN_SPRINTS } : {}),
    };
  }
  if (path.startsWith("/api/tasks")) {
    return { items: TASKS, total: TASKS.length, offset: 0, limit: 200 };
  }
  if (path.startsWith("/api/workflow")) {
    return { statuses: [], priorities: [], task_types: [] };
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
  if (path.startsWith("/api/labels") || path.startsWith("/api/milestones")) {
    return { items: [], total: 0, offset: 0, limit: 1000 };
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
  const sprintsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sprints",
    component: () => <SprintsView />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sprintsRoute]),
    history: createMemoryHistory({ initialEntries: ["/sprints"] }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  BROKEN_SPRINTS = [];
  SPRINTS = [{ id: "sp_12", name: "Sprint 12", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" }];
  TASKS = [];
});

describe("SprintsView — corrupt sprint-config entry (A138)", () => {
  it("surfaces a broken sprint entry, named and marked, alongside the healthy ones", async () => {
    BROKEN_SPRINTS = [
      { id: "sp_bad", index: 1, rawText: "id: sp_bad\nend_date: 2026-01-01\nstart_date: 2026-06-01", error: "end_date must not be before start_date" },
    ];
    await renderView();

    const notice = await screen.findByTestId("sprints-broken-config");
    // Named by its id (the loader could read one).
    expect(notice.textContent).toContain("sp_bad");
    // Marked broken, and the validator's message shown.
    expect(notice.textContent).toContain("(broken)");
    expect(notice.textContent).toContain("end_date must not be before start_date");
    // The healthy sprint still renders its column — one bad entry never
    // blanks the surface.
    expect(await screen.findByTestId("sprint-column-sp_12")).toBeTruthy();
  });

  it("names a broken entry by position when its id could not be read", async () => {
    BROKEN_SPRINTS = [
      { index: 2, rawText: "start_date: nope", error: "id: Required" },
    ];
    await renderView();

    const notice = await screen.findByTestId("sprints-broken-config");
    // index 2 → "#3" (1-based for humans).
    expect(notice.textContent).toContain("#3");
  });

  it("does not read as empty when the only sprint is broken (tell broken from none)", async () => {
    SPRINTS = [];
    BROKEN_SPRINTS = [
      { id: "sp_only", index: 0, rawText: "id: sp_only", error: "state: Required" },
    ];
    await renderView();

    // The broken notice appears...
    expect(await screen.findByTestId("sprints-broken-config")).toBeTruthy();
    // ...and the "No sprints yet" empty state does NOT — a corrupt-only
    // tracker is not an empty one (A138).
    await waitFor(() => {
      expect(screen.queryByTestId("sprints-empty")).toBeNull();
    });
  });

  it("shows no broken notice when every sprint parsed", async () => {
    BROKEN_SPRINTS = [];
    await renderView();
    expect(await screen.findByTestId("sprint-column-sp_12")).toBeTruthy();
    expect(screen.queryByTestId("sprints-broken-config")).toBeNull();
  });
});

describe("SprintsView — corrupt task on a sprint card", () => {
  it("keeps a task carrying health in its sprint column (does not vanish or crash)", async () => {
    TASKS = [
      {
        id: "t_1",
        key: "WEB-1",
        title: "Healthy task",
        sprint: "sp_12",
      },
      {
        // A corrupt task: `due_date` lifted into `health`, so it is
        // absent from frontmatter. Identity (id/key) is intact, so it
        // loads via tolerant core. It must still bucket into sp_12.
        id: "t_2",
        key: "WEB-2",
        title: "Task with a bad due date",
        sprint: "sp_12",
        health: [
          { field: "due_date", kind: "wrong_type", rawText: "not-a-date", error: "expected YYYY-MM-DD", repair: "set_or_remove" },
        ],
      },
    ];
    await renderView();

    // Both cards render in the sprint column; the corrupt one has not
    // vanished, and the view did not crash.
    expect(await screen.findByTestId("board-card-WEB-1")).toBeTruthy();
    expect(await screen.findByTestId("board-card-WEB-2")).toBeTruthy();
  });
});
