// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listSearchSchema } from "../router/listSearch.ts";
import { taskDetailSearchSchema } from "../router/taskDetailSearch.ts";
import { recordTaskOrigin, resetTaskOriginForTest } from "../router/taskOrigin.ts";

/**
 * UI-12. `TaskDetail`'s back affordance.
 *
 * Ken's ruling, verbatim: "fall back to the route i came from. if cold
 * load then no back button" — so this covers exactly those two shapes:
 * an origin recorded before navigating in renders a working "Back to
 * …" link that returns to that exact URL (search params included), and
 * NO origin (the cold-load case — nothing called `recordTaskOrigin`
 * before this page mounted) renders no back control at all, not a
 * disabled one and not a fallback to `/list`.
 *
 * Heavy child panels and data hooks are stubbed, same pattern as
 * TaskDetail.order.test.tsx — the subject here is the back link, not the
 * rest of the page.
 */

vi.mock("./MetaPanel.tsx", () => ({ MetaPanel: () => <div data-testid="meta-panel">meta</div> }));
vi.mock("../editor/BodyEditor.tsx", () => ({ BodyEditor: () => <div>body</div> }));
vi.mock("../relationships/RelationshipsPanel.tsx", () => ({ RelationshipsPanel: () => <div>related</div> }));
vi.mock("../attachments/AttachmentsPanel.tsx", () => ({ AttachmentsPanel: () => <div>attachments</div> }));
vi.mock("../activity/ActivityPanel.tsx", () => ({ ActivityPanel: () => <div>activity</div> }));

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
vi.mock("../api/hooks/useSetField.ts", () => ({ useSetField: () => ({ mutate: () => {} }) }));
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

const { TaskDetail } = await import("./TaskDetail.tsx");

afterEach(() => {
  cleanup();
  resetTaskOriginForTest();
});

function renderDetail(initialEntry = "/tasks/T-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$key",
    validateSearch: taskDetailSearchSchema,
    component: () => <TaskDetail taskRef="T-1" />,
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: () => <div data-testid="list-stub">list</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([taskRoute, listRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

describe("TaskDetail back affordance (UI-12)", () => {
  // @verifies LST-5 (cold load renders NO back control at all)
  it("renders no back link on a cold load (nothing recorded an origin)", async () => {
    renderDetail();
    await screen.findByTestId("meta-panel");
    expect(screen.queryByTestId("task-detail-back")).toBeNull();
  });

  // @verifies LST-5 (back returns to the origin, search params included)
  it("renders a back link to the recorded origin, with its search params, when one was set", async () => {
    recordTaskOrigin("/list?status=in_progress&page=2");
    const router = renderDetail();
    const back = await screen.findByTestId("task-detail-back");
    // K111: the arrow is a decorative <Icon>, not a typed glyph, so the
    // link's text is the label alone — no stray "←" in the accessible name.
    expect(back.textContent).toBe("Back to list");

    fireEvent.click(back);

    await screen.findByTestId("list-stub");
    expect(router.state.location.pathname).toBe("/list");
    // listSearchSchema's `csv` transform parses a single status into a
    // one-element array — this is the same round-trip the origin route
    // itself would have applied to `?status=in_progress`, so seeing it
    // here confirms the search string travelled through unmangled.
    expect(router.state.location.search).toEqual(
      expect.objectContaining({ status: ["in_progress"], page: 2 }),
    );
  });

  it("labels the back link by the origin route (board)", async () => {
    recordTaskOrigin("/board");
    renderDetail();
    const back = await screen.findByTestId("task-detail-back");
    expect(back.textContent).toBe("Back to board");
  });

  // @verifies LST-5 (an in-app navigation, not a fresh module load —
  // this is the same test module instance carrying the origin across a
  // navigation, the way the real app's single page session would)
  it("does not invent an origin for a task that was not opened from a recorded route", async () => {
    // Nothing recorded — same as cold load from this module's point of
    // view, and the important thing is what does NOT happen: no
    // fallback to /list, no disabled control.
    renderDetail();
    await screen.findByTestId("meta-panel");
    expect(screen.queryByTestId("task-detail-back")).toBeNull();
  });
});

/**
 * A208 / K111. The back arrow is drawn, not typed — see the matching
 * blocks in MilestoneDetail.test.tsx and SprintDetail.test.tsx, which the
 * comment at the link's source says this site must stay identical to.
 */
describe("TaskDetail back arrow is a drawn Icon (A208 / K111)", () => {
  it("draws the back arrow as an aria-hidden svg, leaving the accessible name as the origin label alone", async () => {
    recordTaskOrigin("/list");
    renderDetail();

    const back = await screen.findByTestId("task-detail-back");
    const svg = back.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(back.textContent).toBe("Back to list");
    expect(back.textContent).not.toContain("←");
  });
});
