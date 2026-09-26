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

/**
 * A description Save adds a `body_edited` entry to the task's history,
 * so the Activity tab must refetch. `onSaved` refreshed the task and the
 * list queries but not `["activity", ref]`, and the tab kept showing the
 * old history until the next poll (found verifying K124).
 */

// --- Stub the heavy children with lightweight markers. -------------------
vi.mock("./MetaPanel.tsx", () => ({
  MetaPanel: () => <div data-testid="meta-panel">meta</div>,
}));
vi.mock("../editor/BodyEditor.tsx", () => ({
  BodyEditor: ({ onSaved }: { onSaved?: () => void }) => (
    <button type="button" onClick={() => onSaved?.()}>stub save</button>
  ),
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

function renderDetail(qc: QueryClient) {
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

describe("TaskDetail after a description save", () => {
  it("refreshes the task's activity feed", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderDetail(qc);

    fireEvent.click(await screen.findByRole("button", { name: "stub save" }));

    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(["activity", "T-1"]));
  });
});
