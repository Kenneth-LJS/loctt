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

import { SprintDetail } from "./SprintDetail.tsx";

/**
 * SprintDetail sprint-progress test (F1 / K30 parity).
 *
 * The guarantee under test: the web client now CONSUMES
 * `/api/sprints?progress=true` — the done/total core computes for the
 * CLI (`sprint list --progress`) and MCP (`list_sprints` progress arg).
 * Before F1 no client requested it, so the "all three surfaces" claim
 * was over-broad for sprints. The readout also surfaces the K28
 * `unreadable` list, so a short progress total is explained.
 *
 * Harness mirrors SprintsView.test.tsx.
 */

const SPRINT = { id: "sp_1", name: "Sprint 1", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" };

let SPRINT_PROGRESS: { done: number; total: number; discarded: number; fraction: number } | undefined = {
  done: 1, total: 3, discarded: 0, fraction: 1 / 3,
};
let SPRINT_UNREADABLE: { id: string; path: string; reason: string }[] = [];

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  // The progress-bearing sprints read (`?progress=true`).
  if (path.startsWith("/api/sprints") && path.includes("progress=true")) {
    return {
      items: [{ ...SPRINT, ...(SPRINT_PROGRESS ? { progress: SPRINT_PROGRESS } : {}) }],
      total: 1,
      offset: 0,
      limit: 1000,
      ...(SPRINT_UNREADABLE.length > 0 ? { unreadable: SPRINT_UNREADABLE } : {}),
    };
  }
  // The plain sidebar sprints read (resolves the header's sprint).
  if (path.startsWith("/api/sprints") && !path.includes("/burndown")) {
    return { items: [SPRINT], total: 1, offset: 0, limit: 1000 };
  }
  if (path.includes("/burndown")) {
    return { sprintId: "sp_1", start: "2026-06-01", end: "2026-06-14", unit: "count", initialTotal: 0, series: [], ideal: [] };
  }
  if (path.startsWith("/api/tasks")) {
    return { items: [], total: 0, offset: 0, limit: 200 };
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

async function renderDetail() {
  if (priorQc) {
    await priorQc.cancelQueries();
    priorQc.clear();
  }
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  priorQc = qc;

  const rootRoute = createRootRoute();
  const sprintRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sprints/$key",
    component: () => <SprintDetail sprintId="sp_1" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sprintRoute]),
    history: createMemoryHistory({ initialEntries: ["/sprints/sp_1"] }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  SPRINT_PROGRESS = { done: 1, total: 3, discarded: 0, fraction: 1 / 3 };
  SPRINT_UNREADABLE = [];
});

describe("SprintDetail — titled header fold (Ken 2026-09-20)", () => {
  it("renders the sprint name as the page h1 title", async () => {
    await renderDetail();
    const heading = await screen.findByRole("heading", { name: "Sprint 1", level: 1 });
    expect(heading.tagName).toBe("H1");
  });

  it("shows the dates and state in the header subtitle", async () => {
    await renderDetail();
    const window = await screen.findByTestId("sprint-detail-window");
    expect(window.textContent).toContain("2026-06-01");
    expect(window.textContent).toContain("2026-06-14");
    expect(screen.getByTestId("sprint-detail-state").textContent).toBe("Active");
  });

  it("does NOT duplicate the name/dates/state in the meta header below (foldReadMeta)", async () => {
    await renderDetail();
    // The meta header is present (Edit + Goal still live there)...
    expect(await screen.findByTestId("sprint-meta-edit")).toBeTruthy();
    // ...but its read-mode name/dates/state fields are folded out, so
    // they are not rendered a second time under the PageHeader title.
    expect(screen.queryByTestId("sprint-meta-name-value")).toBeNull();
    expect(screen.queryByTestId("sprint-meta-start_date-value")).toBeNull();
    expect(screen.queryByTestId("sprint-meta-state-value")).toBeNull();
  });
});

describe("SprintDetail — sprint progress (F1 / K30)", () => {
  it("renders done/total from core's ?progress=true response", async () => {
    await renderDetail();
    const count = await screen.findByTestId("sprint-progress-count");
    expect(count.textContent).toContain("1/3");
  });

  it("surfaces the unreadable count so a short total is explained (K28)", async () => {
    SPRINT_UNREADABLE = [{ id: "tk_bad", path: ".loctt/tasks/tk_bad/task.md", reason: "invalid YAML" }];
    await renderDetail();
    const notice = await screen.findByTestId("sprint-progress-unreadable");
    expect(notice.textContent).toContain("1");
    expect(notice.textContent?.toLowerCase()).toContain("could not be read");
  });

  it("shows an explicit 'No tasks' rather than a fabricated 0%", async () => {
    SPRINT_PROGRESS = { done: 0, total: 0, discarded: 0, fraction: 0 };
    await renderDetail();
    const none = await screen.findByTestId("sprint-progress-none");
    expect(none.textContent).toContain("No tasks");
    expect(screen.queryByTestId("sprint-progress-count")).toBeNull();
  });
});
