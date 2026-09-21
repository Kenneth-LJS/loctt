// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let SPRINTS: {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  state: string;
  archived?: boolean;
  progress?: { done: number; total: number; discarded: number; fraction: number };
}[] = [
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

describe("SprintsView — titled header (Ken 2026-09-20)", () => {
  it("renders a 'Sprints' h1 title with the manage link in the header", async () => {
    await renderView();
    const heading = await screen.findByRole("heading", { name: "Sprints", level: 1 });
    expect(heading.tagName).toBe("H1");
    // The manage link moved into the PageHeader actions slot; still there.
    expect(screen.getByTestId("sprints-manage-link")).toBeTruthy();
  });
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

  // @verifies DEG-11
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

describe("SprintsView — SPR-39 at-a-glance data on the overview card", () => {
  // @verifies SPR-39
  it("shows progress done/total on the sprint column header from core's ?progress=true", async () => {
    SPRINTS = [
      {
        id: "sp_12",
        name: "Sprint 12",
        start_date: "2026-06-01",
        end_date: "2026-06-14",
        state: "active",
        progress: { done: 3, total: 8, discarded: 1, fraction: 3 / 8 },
      },
    ];
    await renderView();

    const readout = await screen.findByTestId("sprint-progress-sp_12");
    expect(readout.textContent).toContain("3");
    expect(readout.textContent).toContain("8");
    // The mini-bar (burndown equivalent, A165) reflects the same numbers.
    const bar = await screen.findByTestId("sprint-progress-bar-sp_12");
    expect(bar.getAttribute("data-fill")).toBe((3 / 8).toFixed(4));
  });

  // @verifies SPR-39
  it("shows a No-tasks readout, not 0/0, when a sprint has no counted tasks", async () => {
    SPRINTS = [
      {
        id: "sp_12",
        name: "Sprint 12",
        start_date: "2026-06-01",
        end_date: "2026-06-14",
        state: "active",
        progress: { done: 0, total: 0, discarded: 0, fraction: 0 },
      },
    ];
    await renderView();

    const readout = await screen.findByTestId("sprint-progress-sp_12");
    expect(readout.textContent).toContain("No tasks");
    expect(readout.textContent).not.toContain("0/0");
    expect(readout.textContent).not.toContain("NaN");
  });

  // @verifies SPR-39
  it("shows days-remaining while the window is open and overdue once its end has passed", async () => {
    // info.today is stubbed to 2026-06-08 in routeFetch.
    SPRINTS = [
      { id: "sp_open", name: "Open", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" },
      { id: "sp_past", name: "Past", start_date: "2026-05-01", end_date: "2026-05-14", state: "active" },
    ];
    await renderView();

    // 2026-06-08 → 2026-06-14 is 6 days out.
    const open = await screen.findByTestId("sprint-countdown-sp_open");
    expect(open.textContent).toMatch(/6 days/);
    // 2026-05-14 is in the past → overdue wording.
    const past = await screen.findByTestId("sprint-countdown-sp_past");
    expect(past.textContent).toMatch(/overdue/i);
  });

  // @verifies SPR-39
  it("opens the sprint when the whole header card is clicked", async () => {
    SPRINTS = [
      { id: "sp_12", name: "Sprint 12", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" },
    ];
    await renderView();

    const card = await screen.findByTestId("sprint-card-sp_12");
    expect(card.getAttribute("role")).toBe("link");
    // Its label names the sprint so the affordance is not mouse-only.
    expect(card.getAttribute("aria-label")).toContain("Sprint 12");
  });
});

describe("SprintsView — SPR-40 overview affordances (show archived + manage link)", () => {
  // @verifies SPR-40
  it("hides archived sprints by default and reveals them behind a show-archived toggle", async () => {
    SPRINTS = [
      { id: "sp_live", name: "Live", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" },
      { id: "sp_old", name: "Old", start_date: "2025-01-01", end_date: "2025-01-14", state: "completed", archived: true },
    ];
    await renderView();

    // The archived one is absent until the toggle is enabled.
    expect(await screen.findByTestId("sprint-column-sp_live")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId("sprint-column-sp_old")).toBeNull();
    });

    const toggle = await screen.findByTestId("sprints-show-archived");
    // The label names the affordance and its count.
    expect(toggle.closest("label")?.textContent).toContain("Show archived");
    (toggle as HTMLInputElement).click();

    await waitFor(() => {
      expect(screen.queryByTestId("sprint-column-sp_old")).not.toBeNull();
    });
  });

  // @verifies SPR-40
  it("creates in place via '+ New sprint' and reaches roster actions via the settings entry (K105)", async () => {
    // K105 changed the SPR-40 lifecycle affordances: CREATE is now an
    // in-place "+ New sprint" dialog (not the manage link), while
    // delete/archive/reorder stay in the Settings panel reached by a
    // proper gear entry (not a prose link). This replaces the old
    // assertion that create lived behind the manage-in-settings link.
    await renderView();
    // Create in place:
    expect(await screen.findByTestId("sprints-new")).toBeTruthy();
    expect(screen.queryByTestId("sprint-create-dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("sprints-new"));
    expect(await screen.findByTestId("sprint-create-dialog")).toBeTruthy();
    // Roster actions still reachable via the settings entry:
    expect(screen.getByTestId("sprints-manage-link")).toBeTruthy();
  });

  // @verifies SPR-40
  it("shows no show-archived toggle when nothing is archived", async () => {
    SPRINTS = [
      { id: "sp_live", name: "Live", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" },
    ];
    await renderView();
    await screen.findByTestId("sprint-column-sp_live");
    expect(screen.queryByTestId("sprints-show-archived")).toBeNull();
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
