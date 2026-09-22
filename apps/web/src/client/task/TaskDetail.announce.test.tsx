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
 * A11Y-24 — a field save's outcome is announced in the shell's live
 * region, so a non-sighted user knows the edit landed (or did not)
 * without inspecting the field.
 *
 * The mutation success/error handlers live in TaskDetail's `writeField`
 * (MetaPanel's `onSet`/`onUnset` forward straight to it), so that is
 * where the announce is wired and where it is proven here. The heavy
 * children and data hooks are stubbed; MetaPanel is replaced with two
 * buttons that fire `onSet` — the panel's own rendering is covered by
 * MetaPanel.test.tsx, and the subject here is purely the announcement.
 *
 * `useSetField` is stubbed to a controllable mutate that either resolves
 * (invokes `onSuccess`) or rejects (invokes `onError`) so success and
 * failure are both exercised against the real Announcer regions.
 *
 * Red-proof (recorded, done by hand, restored):
 *  - Delete the `announce(... "saved")` call → the success test goes red
 *    (`announcer-polite` never contains "Status saved").
 *  - Delete the `announce(failure.message, "assertive")` call → the
 *    failure test goes red (`announcer-assertive` stays empty).
 *  - Move either announce into render (announce on every paint) → the
 *    once-per-event test goes red (announce fires without a save, and
 *    more than once per save).
 */

// The current mutate behaviour, swapped per test. Default: succeed.
let mutateBehaviour: "success" | "error" = "success";
const FAILURE_MESSAGE = "Could not write the task file: the disk is full.";

// How many times the announce channel was written, so "once per event"
// is a real count and not just a presence check.
const announceCalls: { message: string; politeness: string }[] = [];

vi.mock("./MetaPanel.tsx", () => ({
  MetaPanel: ({ onSet }: { onSet: (field: string, value: unknown) => void }) => (
    <div data-testid="meta-panel">
      <button data-testid="fire-set" onClick={() => { onSet("status", "done"); }}>
        set status
      </button>
    </div>
  ),
}));
vi.mock("../editor/BodyEditor.tsx", () => ({ BodyEditor: () => <div>body</div> }));
vi.mock("../relationships/RelationshipsPanel.tsx", () => ({
  RelationshipsPanel: () => <div>related</div>,
}));
vi.mock("../attachments/AttachmentsPanel.tsx", () => ({
  AttachmentsPanel: () => <div>attachments</div>,
}));
vi.mock("../activity/ActivityPanel.tsx", () => ({
  ActivityPanel: () => <div>activity</div>,
}));
vi.mock("./EditableTitle.tsx", () => ({
  EditableTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// Spy the real announce so we can count events. The provider still
// renders the real live regions (we do NOT mock Announcer), so the DOM
// assertions are about what a screen reader would actually read.
vi.mock("../ui/Announcer.tsx", async () => {
  const actual = await vi.importActual<typeof import("../ui/Announcer.tsx")>(
    "../ui/Announcer.tsx",
  );
  return {
    ...actual,
    useAnnouncer: () => {
      const { announce } = actual.useAnnouncer();
      return {
        announce: (message: string, politeness = "polite") => {
          announceCalls.push({ message, politeness });
          announce(message, politeness as "polite" | "assertive");
        },
      };
    },
  };
});

const TASK = {
  frontmatter: { id: "01ABC", key: "T-1", title: "A task", key_history: [], status: "todo" },
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
vi.mock("../api/hooks/useSetField.ts", async () => {
  const { ApiError } = await import("../api/client.ts");
  return {
    useSetField: () => ({
      mutate: (
        vars: { field: string; value?: unknown },
        opts?: {
          onSuccess?: () => void;
          onError?: (err: Error) => void;
        },
      ) => {
        if (mutateBehaviour === "success") {
          opts?.onSuccess?.();
        } else {
          const err = new ApiError(FAILURE_MESSAGE, {
            status: 500,
            body: {},
            endpoint: "/api/tasks/T-1/set",
            envelope: {
              code: "io_failed",
              message: FAILURE_MESSAGE,
              error: FAILURE_MESSAGE,
              field: vars.field,
              data_state: "not_saved",
              recovery: { kind: "retry" },
            } as never,
          });
          opts?.onError?.(err);
        }
      },
    }),
  };
});
vi.mock("../api/hooks/useCreateLabel.ts", () => ({
  useCreateLabel: () => ({ mutateAsync: () => Promise.resolve({ id: "l1" }) }),
}));
vi.mock("../api/hooks/useCurrentUser.ts", () => ({
  useCurrentUser: () => ({ data: null }),
}));
vi.mock("../api/hooks/useTaskMutations.ts", () => ({
  useArchiveTask: () => ({ mutate: () => {} }),
  useDeleteTask: () => ({ mutate: () => {}, isPending: false }),
  useMoveTask: () => ({ mutate: () => {}, isPending: false }),
  useDuplicateTask: () => ({ mutate: () => {} }),
}));
vi.mock("../api/hooks/useCalendar.ts", () => ({ useCalendar: () => ({ data: undefined }) }));
vi.mock("../api/hooks/useWorkflow.ts", () => ({
  useWorkflow: () => ({
    data: {
      statuses: [
        { key: "todo", label: "To do" },
        { key: "done", label: "Done" },
      ],
      priorities: [],
      task_types: [],
    },
  }),
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
const { AnnouncerProvider } = await import("../ui/Announcer.tsx");

afterEach(() => {
  cleanup();
  announceCalls.length = 0;
  mutateBehaviour = "success";
});

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
      <AnnouncerProvider>
        <RouterProvider router={router as never} />
      </AnnouncerProvider>
    </QueryClientProvider>,
  );
}

describe("A11Y-24 — a field save's outcome is announced", () => {
  // @verifies A11Y-24
  it("announces success politely, naming the field, without moving focus", async () => {
    mutateBehaviour = "success";
    renderDetail();

    const trigger = await screen.findByTestId("fire-set");
    // Focus is on the trigger before the save; announcing must not steal
    // it — a save confirmation that moves focus is a worse regression
    // than a silent one (A11Y-24's first bullet: "without moving focus").
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    // Polite region carries "<Field> saved"; the assertive region stays
    // empty (a success is not an interruption).
    expect(screen.getByTestId("announcer-polite").textContent).toContain("Status saved");
    expect(screen.getByTestId("announcer-assertive").textContent).toBe("");
    // Focus did not move.
    expect(document.activeElement).toBe(trigger);
  });

  // @verifies A11Y-24
  it("announces failure assertively with the same message the notice shows", async () => {
    mutateBehaviour = "error";
    renderDetail();

    fireEvent.click(await screen.findByTestId("fire-set"));

    // The failure is spoken assertively so it interrupts (a silent
    // failure is A11Y-24's named worst case) and carries the SAME text
    // the field's `role="alert"` notice renders (`failure.message`).
    const assertive = screen.getByTestId("announcer-assertive");
    expect(assertive.textContent).toContain(FAILURE_MESSAGE);
    const failureAnnounce = announceCalls.find(c => c.message.includes("disk is full"));
    expect(failureAnnounce?.politeness).toBe("assertive");
    // A failure is not also announced as a success.
    expect(screen.getByTestId("announcer-polite").textContent).not.toContain("saved");
  });

  // @verifies A11Y-24
  it("announces once per save event, not on re-render or before any save", async () => {
    mutateBehaviour = "success";
    renderDetail();

    const trigger = await screen.findByTestId("fire-set");
    // Nothing announced before the user saves anything.
    expect(announceCalls).toHaveLength(0);

    fireEvent.click(trigger);
    // Exactly one announcement for one save.
    expect(announceCalls).toHaveLength(1);
    expect(announceCalls[0]?.message).toBe("Status saved");

    // A second, identical save announces again (once per event) — the
    // Announcer's per-message key is what makes the repeat audible.
    fireEvent.click(trigger);
    expect(announceCalls).toHaveLength(2);
  });
});
