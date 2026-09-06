// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { RelationshipRow as Row } from "./group.ts";
import { RelationshipRowView } from "./RelationshipRow.tsx";

/**
 * RelationshipRow: the corrupt-vs-missing-vs-healthy treatments
 * (corruption sweep S4).
 *
 * The gap these close: a target corrupt in `title` used to render as an
 * ordinary untitled-but-fine row, and an object-fatally unreadable target
 * used to render identically to a *deleted* one ("no task with id"). A
 * corrupt target must read as corrupt (⚠), distinct from both.
 */

const base: Row = {
  type: "blocks",
  target: "01HZ0000000000000000000000",
  resolvedKey: undefined,
  resolvedTitle: undefined,
  resolvedStatus: undefined,
  missing: false,
  rank: undefined,
  index: 0,
  duplicates: 1,
};

/** Render one row inside a minimal router so `<Link>` resolves. */
function renderRow(row: Row) {
  const rootRoute = createRootRoute();
  const rowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <RelationshipRowView
        row={row}
        statusOf={() => undefined}
        removing={false}
        onRemove={() => undefined}
      />
    ),
  });
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$key",
    component: () => <div>task</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([rowRoute, taskRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
}

afterEach(cleanup);

describe("RelationshipRow corrupt vs missing vs healthy", () => {
  it("renders a healthy target as a plain link with no corrupt marker", async () => {
    renderRow({ ...base, resolvedKey: "T-2", resolvedTitle: "A real task" });
    const link = await screen.findByRole("link");
    expect(within(link).getByText("T-2")).toBeTruthy();
    expect(screen.queryByTestId("relationship-corrupt")).toBeNull();
    expect(screen.queryByTestId("relationship-broken")).toBeNull();
  });

  // @verifies DEG-15
  it("marks a resolved-but-corrupt target with a corrupt affordance AND keeps the link", async () => {
    renderRow({
      ...base,
      resolvedKey: "T-2",
      resolvedTitle: "Has a bad field",
      targetCorrupt: true,
    });
    // Still linkable — the task opens and can be repaired.
    const link = await screen.findByRole("link");
    expect(within(link).getByText("T-2")).toBeTruthy();
    // …but flagged corrupt, distinct from a healthy row.
    const corrupt = screen.getByTestId("relationship-corrupt");
    expect(corrupt.textContent).toContain("corrupt");
    // Not the deleted treatment.
    expect(screen.queryByTestId("relationship-broken")).toBeNull();
  });

  // @verifies DEG-15
  it("marks a missing-AND-corrupt (unreadable) target as corrupt, not deleted", async () => {
    renderRow({ ...base, missing: true, targetCorrupt: true });
    const corrupt = await screen.findByTestId("relationship-corrupt");
    expect(corrupt.textContent).toMatch(/corrupt/i);
    expect(corrupt.textContent).toContain(base.target);
    // It must NOT read as the deleted "no task with id" case.
    expect(screen.queryByTestId("relationship-broken")).toBeNull();
    expect(corrupt.textContent).not.toMatch(/no task with id/i);
  });

  it("renders a genuinely-absent target as the deleted broken-link treatment", async () => {
    renderRow({ ...base, missing: true });
    const broken = await screen.findByTestId("relationship-broken");
    expect(broken.textContent).toMatch(/no task with id/i);
    // Distinct from corrupt.
    expect(screen.queryByTestId("relationship-corrupt")).toBeNull();
  });
});
