// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RelationshipRow as Row } from "./group.ts";
import { RelationshipRowView } from "./RelationshipRow.tsx";

/**
 * RelationshipRow: two things this file covers.
 *
 * 1. The corrupt-vs-missing-vs-healthy treatments (corruption sweep S4).
 *    A target corrupt in `title` used to render as an ordinary
 *    untitled-but-fine row, and an object-fatally unreadable target used
 *    to render identically to a *deleted* one ("no task with id"). A
 *    corrupt target must read as corrupt (⚠), distinct from both.
 *
 * 2. The revised REL-12 remove affordance (Ken's ruling): a persistent
 *    kebab (⋯) in a fixed slot → a dropdown offering Remove → a brief
 *    confirm dialog. This replaces the old hover-only `✕` that removed on
 *    one click. These tests assert the NEW shape, so they edit the
 *    previously-green REL-12 tests per CLAUDE.md's "editing a green test"
 *    rule — they now assert the kebab+confirm behavior.
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
function renderRow(
  row: Row,
  opts: { onRemove?: (() => void) | undefined; removing?: boolean } = {},
) {
  const onRemove = "onRemove" in opts ? opts.onRemove : (): void => undefined;
  const rootRoute = createRootRoute();
  const rowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <RelationshipRowView
        row={row}
        statusOf={() => undefined}
        removing={opts.removing ?? false}
        onRemove={onRemove}
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

describe("RelationshipRow remove: persistent kebab + confirm (REL-12, revised)", () => {
  // @verifies REL-12
  it("exposes a persistent kebab that is in the DOM and focusable, not a hover-only remove", async () => {
    renderRow({ ...base, resolvedKey: "T-2", resolvedTitle: "Beta" });

    // The kebab is present without any hover — it is a real, always-mounted
    // control, so querying it (not waiting for a hover state) finds it.
    // (`findBy` only to let the router's initial async render settle.)
    const kebab = await screen.findByTestId("relationship-kebab");
    expect(kebab).toBeTruthy();
    // Reachable by keyboard focus: focusing it succeeds (a `display:none`
    // or unmounted control could not become the active element).
    kebab.focus();
    expect(document.activeElement).toBe(kebab);

    // No stray one-click remove control is exposed until the menu opens:
    // the remove path is behind the kebab, not sitting in the row.
    expect(screen.queryByTestId("relationship-remove")).toBeNull();
    // And no old hover-`✕` button remains anywhere.
    expect(screen.queryByRole("button", { name: /^Remove link to/i })).toBeNull();
  });

  // @verifies REL-12
  it("removal is a deliberate two-step: kebab → Remove → confirm, not a one-click write", async () => {
    const onRemove = vi.fn();
    renderRow({ ...base, resolvedKey: "T-2", resolvedTitle: "Beta" }, { onRemove });

    // Open the kebab menu.
    fireEvent.click(await screen.findByTestId("relationship-kebab"));
    const removeItem = screen.getByTestId("relationship-remove");
    expect(removeItem).toBeTruthy();

    // Choosing Remove does NOT write immediately — it opens a confirm.
    fireEvent.click(removeItem);
    expect(onRemove).not.toHaveBeenCalled();
    const confirm = screen.getByTestId("relationship-remove-confirm");
    expect(confirm).toBeTruthy();
    // A real dialog stands between the choice and the write.
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Confirming performs the removal exactly once.
    fireEvent.click(screen.getByTestId("relationship-remove-confirm-button"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  // @verifies REL-12
  it("Cancel in the confirm dismisses it and writes nothing", async () => {
    const onRemove = vi.fn();
    renderRow({ ...base, resolvedKey: "T-2", resolvedTitle: "Beta" }, { onRemove });

    fireEvent.click(await screen.findByTestId("relationship-kebab"));
    fireEvent.click(screen.getByTestId("relationship-remove"));
    expect(screen.getByTestId("relationship-remove-confirm")).toBeTruthy();

    fireEvent.click(screen.getByTestId("relationship-remove-cancel"));
    expect(screen.queryByTestId("relationship-remove-confirm")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  // @verifies REL-24
  it("a broken (dangling) row's confirm still offers removal in those words", async () => {
    const onRemove = vi.fn();
    renderRow({ ...base, missing: true }, { onRemove });

    fireEvent.click(await screen.findByTestId("relationship-kebab"));
    // REL-24's third bullet: the broken row offers "Remove this link".
    expect(screen.getByTestId("relationship-remove").textContent).toMatch(/Remove this link/i);
    fireEvent.click(screen.getByTestId("relationship-remove"));
    fireEvent.click(screen.getByTestId("relationship-remove-confirm-button"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  // @verifies REL-12
  it("a row whose edge is not this task's to remove shows no kebab, only the reserved slot", async () => {
    // onRemove undefined — a tree descendant. No remove affordance at all,
    // but the fixed slot keeps the layout aligned (K-4).
    renderRow({ ...base, resolvedKey: "T-9", resolvedTitle: "Descendant" }, { onRemove: undefined });
    // Wait for the row to actually render before asserting the kebab's
    // absence — otherwise the query would pass against an empty tree that
    // has not mounted yet, asserting nothing.
    await screen.findByRole("link");
    expect(screen.queryByTestId("relationship-kebab")).toBeNull();
    expect(screen.queryByTestId("relationship-remove")).toBeNull();
  });
});
