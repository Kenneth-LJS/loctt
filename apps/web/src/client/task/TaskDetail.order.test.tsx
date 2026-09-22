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
 * TaskDetail metadata ordering (mobile blocker, B3 review).
 *
 * On a single column the meta panel (Status / Priority / Assignee / Due)
 * must sit directly under the title — above the description and comments —
 * so the most-used fields are reachable on a phone. It was rendered LAST,
 * so it landed below the comments and was effectively unreachable. The fix
 * is grid `order`: the meta wrapper is `order-1 lg:order-none` and the
 * content column `order-2 lg:order-none`, restoring source order (content
 * left, meta right) at `lg`.
 *
 * The heavy child panels and data hooks are stubbed — the subject here is
 * the grid *order*, not the panels' own behaviour (which their own tests
 * cover). What this asserts: the meta panel's grid item precedes the
 * content column's in DOM order *and* carries the mobile-first order class,
 * which is exactly the regression a reverted class swap would reintroduce.
 */

// --- Stub the heavy children with lightweight markers. -------------------
vi.mock("./MetaPanel.tsx", () => ({
  MetaPanel: () => <div data-testid="meta-panel">meta</div>,
}));
vi.mock("../editor/BodyEditor.tsx", () => ({
  BodyEditor: () => <div data-testid="body-editor-stub">body</div>,
}));
vi.mock("../relationships/RelationshipsPanel.tsx", () => ({
  RelationshipsPanel: () => <div>related</div>,
}));
vi.mock("../attachments/AttachmentsPanel.tsx", () => ({
  AttachmentsPanel: () => <div>attachments</div>,
}));
vi.mock("../activity/ActivityPanel.tsx", () => ({
  ActivityPanel: () => <div data-testid="activity-stub">activity</div>,
}));

// --- Stub the data hooks. -----------------------------------------------
const TASK = {
  frontmatter: { id: "01ABC", key: "T-1", title: "A task", key_history: [] },
  body: "",
  bodyToken: "tok",
  lossyConstructs: [],
  relationships: [],
  attachments: [],
};

vi.mock("../api/hooks/useTask.ts", () => ({
  useTask: () => ({ isPending: false, isError: false, data: TASK }),
}));
vi.mock("../api/hooks/useTaskGraph.ts", () => ({ useTaskGraph: () => ({}) }));
vi.mock("../api/hooks/useSetField.ts", () => ({
  useSetField: () => ({ mutate: () => {} }),
}));
vi.mock("../api/hooks/useCreateLabel.ts", () => ({
  useCreateLabel: () => ({ mutateAsync: () => Promise.resolve({ id: "l1" }) }),
}));
vi.mock("../api/hooks/useTaskMutations.ts", () => ({
  useArchiveTask: () => ({ mutate: () => {} }),
  useDeleteTask: () => ({ mutate: () => {}, isPending: false }),
  useMoveTask: () => ({ mutate: () => {}, isPending: false }),
  useDuplicateTask: () => ({ mutate: () => {} }),
}));
vi.mock("../api/hooks/useCalendar.ts", () => ({ useCalendar: () => ({ data: undefined }) }));
vi.mock("../api/hooks/useWorkflow.ts", () => ({
  useWorkflow: () => ({ data: { statuses: [], priorities: [], task_types: [] } }),
}));
vi.mock("../api/hooks/sidebarData.ts", () => ({
  useProjects: () => ({ data: { items: [] } }),
  useUsers: () => ({ data: { items: [] } }),
  useLabels: () => ({ data: { items: [] } }),
  useMilestones: () => ({ data: { items: [] } }),
  useSprints: () => ({ data: { items: [] } }),
  searchLabels: () => Promise.resolve([]),
  searchMilestones: () => Promise.resolve([]),
  searchSprints: () => Promise.resolve([]),
  searchUsers: () => Promise.resolve([]),
}));

// Imported AFTER the mocks so TaskDetail binds to the stubs.
const { TaskDetail } = await import("./TaskDetail.tsx");

afterEach(cleanup);

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("TaskDetail metadata order (mobile blocker)", () => {
  it("renders the meta panel before the content column, ordered first on mobile", async () => {
    renderDetail();

    const meta = await screen.findByTestId("meta-panel");
    const activity = screen.getByTestId("activity-stub");
    expect(meta).toBeTruthy();
    expect(activity).toBeTruthy();

    // On a single column the meta panel is visually ordered FIRST (via CSS
    // `order`, which jsdom does not compute — so we assert the classes that
    // drive it). The meta wrapper is `order-1 lg:order-none`; the content
    // column (holding the activity feed) is `order-2 lg:order-none`, so on
    // mobile meta sits above the description/comments and both reset to
    // source order at `lg`. Red-proof: without the class swap the wrappers
    // carry neither `order-*` class, so every assertion below fails.
    const metaItem = meta.closest("[class*='order-1']");
    expect(metaItem).not.toBeNull();
    expect(metaItem?.className).toContain("lg:order-none");

    const contentItem = activity.closest("[class*='order-2']");
    expect(contentItem).not.toBeNull();
    expect(contentItem?.className).toContain("lg:order-none");

    // The two are distinct grid items (meta is not nested inside content).
    expect(metaItem).not.toBe(contentItem);
    expect(contentItem?.contains(meta)).toBe(false);
  });
});
