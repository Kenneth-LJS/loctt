// @vitest-environment jsdom
import type {
  ResolvedRelationshipResponse,
  TaskFrontmatterPublic,
  WorkflowConfig,
} from "@loctt/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rerank mutation is the thing under test: REL-15's third bullet is
 * that a keyboard reorder cancelled with Escape "restores the original
 * position without a write ever leaving". A test asserting only the
 * "Move cancelled" announcement passes against the broken code (it did
 * announce that, and still wrote on every arrow). So this file asserts
 * the write itself — the `mutate` spy below — and the rendered order.
 */
const rerankMutate = vi.fn();
const linkMutate = vi.fn();
const unlinkMutate = vi.fn();

vi.mock("../api/hooks/useRelationships.ts", () => ({
  useLinkTask: () => ({ mutate: linkMutate, isPending: false }),
  useUnlinkTask: () => ({ mutate: unlinkMutate, isPending: false }),
  useRerankRelationship: () => ({ mutate: rerankMutate, isPending: false }),
}));

// Imported after the mock is registered.
const { RelationshipsPanel } = await import("./RelationshipsPanel.tsx");

const WORKFLOW = {
  statuses: [],
  priorities: [],
  task_types: [],
  relationships: [
    {
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
      inverse_label: "Is blocked by",
      graph: "acyclic",
      ranked: true,
    },
  ],
  custom_fields: [],
} as unknown as WorkflowConfig;

function resolved(target: string, key: string): ResolvedRelationshipResponse {
  return {
    type: "blocks",
    target,
    resolvedKey: key,
    resolvedTitle: `Title ${key}`,
    resolvedStatus: "backlog",
    missing: false,
  };
}

/** Three ranked `blocks` edges, in on-disk order A, B, C. */
const RESOLVED: readonly ResolvedRelationshipResponse[] = [
  resolved("id-a", "T-A"),
  resolved("id-b", "T-B"),
  resolved("id-c", "T-C"),
];
const STORED: TaskFrontmatterPublic["relationships"] = [
  { type: "blocks", target: "id-a", rank: "a" },
  { type: "blocks", target: "id-b", rank: "b" },
  { type: "blocks", target: "id-c", rank: "c" },
];

function renderPanel(): void {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <RelationshipsPanel
        taskRef="T-1"
        taskId="id-root"
        taskKey="T-1"
        taskTitle="Root"
        taskKeyHistory={[]}
        relationships={RESOLVED}
        stored={STORED}
        workflow={WORKFLOW}
        statusOf={() => undefined}
        taskIndex={new Map()}
      />
    ),
  });
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$key",
    component: () => <div>task</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, taskRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
}

/** The rendered `data-target` order of the blocks group's rows. */
function renderedOrder(): string[] {
  return Array.from(
    document.querySelectorAll(
      '[data-group="blocks"] [data-testid="relationship-row"]',
    ),
  ).map(el => el.getAttribute("data-target") ?? "");
}

function handleAt(index: number): HTMLElement {
  const handles = screen.getAllByTestId("drag-handle");
  const handle = handles[index];
  if (handle === undefined) throw new Error(`no drag handle at index ${index}`);
  return handle;
}

/** Waits for the router to mount the panel before interacting. */
async function ready(): Promise<void> {
  await screen.findByTestId("relationships-panel");
}

beforeEach(() => {
  rerankMutate.mockClear();
  linkMutate.mockClear();
  unlinkMutate.mockClear();
});

afterEach(cleanup);

describe("RelationshipsPanel keyboard reorder (REL-15)", () => {
  it("arrow keys move the row visually without writing", async () => {
    renderPanel();
    await ready();
    expect(renderedOrder()).toEqual(["id-a", "id-b", "id-c"]);

    const handle = handleAt(0);
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });

    // The picked-up row A moved to the bottom, visually...
    expect(renderedOrder()).toEqual(["id-b", "id-c", "id-a"]);
    // ...but no rerank write has left: the arrows only buffer.
    expect(rerankMutate).not.toHaveBeenCalled();
  });

  it("Escape restores the original position and no write ever leaves", async () => {
    renderPanel();
    await ready();

    const handle = handleAt(0);
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    // Escape targets whichever handle now holds focus in the DOM; the
    // panel re-rendered the buffer, so the row at index 2 is A's handle.
    fireEvent.keyDown(handleAt(2), { key: "Escape" });

    // Row A is back at position 1...
    expect(renderedOrder()).toEqual(["id-a", "id-b", "id-c"]);
    // ...and — REL-15's third bullet — not one rerank write occurred.
    expect(rerankMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("reorder-announcement").textContent).toContain(
      "Move cancelled",
    );
  });

  it("Enter commits the buffered move as exactly one rerank", async () => {
    renderPanel();
    await ready();

    const handle = handleAt(0);
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    // Still no write until the drop.
    expect(rerankMutate).not.toHaveBeenCalled();
    fireEvent.keyDown(handleAt(2), { key: "Enter" });

    // A single rerank, moving A after its new predecessor C (the
    // neighbour it landed next to).
    expect(rerankMutate).toHaveBeenCalledTimes(1);
    const vars = rerankMutate.mock.calls[0]?.[0] as {
      type: string;
      target: string;
      before?: string;
      after?: string;
    };
    expect(vars.type).toBe("blocks");
    expect(vars.target).toBe("T-A");
    // Moved to the end, so anchored after C.
    expect(vars.after).toBe("T-C");
    expect(vars.before).toBeUndefined();
  });
});
