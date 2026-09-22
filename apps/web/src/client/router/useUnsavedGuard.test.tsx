// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUnsavedGuard } from "./useUnsavedGuard.ts";

/**
 * The in-app navigation guard (A246).
 *
 * This drives a REAL memory router — `useBlocker` intercepts client-side
 * navigations, which no unit-level stub reproduces. A route with an
 * "unsaved editor" navigates to another route; the guard flushes first
 * and blocks the navigation unless the flush reports the editor is clean.
 */

afterEach(cleanup);

/**
 * Renders a two-route app: `/edit` mounts an editor that has unsaved work
 * and a "Go" button that navigates to `/other`. `onNavigateAway` is the
 * flush the guard awaits; the test controls whether it reports "safe".
 */
function renderApp(opts: {
  readonly hasUnsavedWork: boolean;
  readonly onNavigateAway: () => Promise<boolean>;
}) {
  function EditPage() {
    const navigate = useNavigate();
    useUnsavedGuard({
      hasUnsavedWork: opts.hasUnsavedWork,
      onNavigateAway: opts.onNavigateAway,
    });
    return (
      <div>
        <span data-testid="on-edit">editing</span>
        <button type="button" onClick={() => { void navigate({ to: "/other" as never }); }}>
          Go
        </button>
      </div>
    );
  }

  const rootRoute = createRootRoute();
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/edit",
    component: EditPage,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/other",
    component: () => <span data-testid="on-other">other page</span>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([editRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: ["/edit"] }),
  });
  return { router, ...render(<RouterProvider router={router as never} />) };
}

describe("useUnsavedGuard — in-app navigation guard (A246)", () => {
  // @verifies A246
  it("blocks the navigation when the flush reports the editor is not safe", async () => {
    // A failed flush (write refused) reports `false`: the editor must stay
    // put so its failed UI is still on screen, rather than the route
    // tearing it down and the text being lost. Red-proof: a guard that did
    // not block (or `disabled`) would let the navigation reach /other.
    const onNavigateAway = vi.fn(() => Promise.resolve(false));
    renderApp({ hasUnsavedWork: true, onNavigateAway });
    await waitFor(() => { expect(screen.getByTestId("on-edit")).toBeTruthy(); });

    await act(async () => {
      screen.getByText("Go").click();
      await Promise.resolve();
    });

    // The flush was attempted, but the navigation was blocked: still on
    // /edit, never reached /other.
    expect(onNavigateAway).toHaveBeenCalled();
    expect(screen.getByTestId("on-edit")).toBeTruthy();
    expect(screen.queryByTestId("on-other")).toBeNull();
  });

  // @verifies A246
  it("lets the navigation through once the flush reports the editor is clean", async () => {
    // A clean flush (write landed) reports `true`: the navigation proceeds,
    // exactly K96's "every exit keeps the text" applied to in-app nav.
    const onNavigateAway = vi.fn(() => Promise.resolve(true));
    renderApp({ hasUnsavedWork: true, onNavigateAway });
    await waitFor(() => { expect(screen.getByTestId("on-edit")).toBeTruthy(); });

    await act(async () => {
      screen.getByText("Go").click();
      await Promise.resolve();
    });

    expect(onNavigateAway).toHaveBeenCalled();
    await waitFor(() => { expect(screen.getByTestId("on-other")).toBeTruthy(); });
  });

  // @verifies A246
  it("does not intercept at all when there is no unsaved work", async () => {
    // A clean editor navigates instantly — the guard is `disabled`, so the
    // flush is never even called. Red-proof: a guard that always ran
    // `onNavigateAway` would call it here.
    const onNavigateAway = vi.fn(() => Promise.resolve(true));
    renderApp({ hasUnsavedWork: false, onNavigateAway });
    await waitFor(() => { expect(screen.getByTestId("on-edit")).toBeTruthy(); });

    await act(async () => {
      screen.getByText("Go").click();
      await Promise.resolve();
    });

    await waitFor(() => { expect(screen.getByTestId("on-other")).toBeTruthy(); });
    expect(onNavigateAway).not.toHaveBeenCalled();
  });
});
