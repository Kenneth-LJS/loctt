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

/**
 * The loading indicators on the task detail page and its Comments section
 * were bare `<p aria-busy>` elements with NO `role="status"`, so a screen
 * reader was never told the region was loading (design-review §A3). Both
 * now render through `LoadingState`, which carries `role="status"` +
 * `aria-busy`.
 *
 * Each test is red-proven: the pre-fix `<p aria-busy>` has no role, so
 * `getByRole("status")` finds nothing.
 */

// ── TaskDetail ────────────────────────────────────────────────────────
// A pending task query — the load-in-progress state under test.
vi.mock("../api/hooks/useTask.ts", () => ({
  useTask: () => ({ isPending: true, isError: false, data: undefined }),
}));
vi.mock("../api/hooks/useTaskGraph.ts", () => ({ useTaskGraph: () => ({}) }));
vi.mock("../api/hooks/useWorkflow.ts", () => ({
  useWorkflow: () => ({ data: { statuses: [], priorities: [], task_types: [] } }),
}));
vi.mock("../api/hooks/sidebarData.ts", () => ({
  useProjects: () => ({ data: { items: [] } }),
  useUsers: () => ({ data: { items: [] } }),
  useLabels: () => ({ data: { items: [] } }),
  useMilestones: () => ({ data: { items: [] } }),
  useSprints: () => ({ data: { items: [] } }),
}));
vi.mock("../api/hooks/useCalendar.ts", () => ({ useCalendar: () => ({ data: undefined }) }));
vi.mock("../api/hooks/useCurrentUser.ts", () => ({ useCurrentUser: () => ({ data: null }) }));

const { TaskDetail } = await import("./TaskDetail.tsx");
const { AnnouncerProvider } = await import("../ui/Announcer.tsx");

afterEach(() => { cleanup(); });

function renderDetail() {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$key",
    component: () => <TaskDetail taskRef="T-1" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/tasks/T-1"] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AnnouncerProvider>
        <RouterProvider router={router as never} />
      </AnnouncerProvider>
    </QueryClientProvider>,
  );
}

describe("TaskDetail loading is announced", () => {
  it("renders the loading state with role=status", async () => {
    renderDetail();
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Loading T-1/i);
    expect(status.getAttribute("aria-busy")).toBe("true");
  });
});
