// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NotFound } from "./NotFound.tsx";

/**
 * The unmatched-route state.
 *
 * This replaced a stub reading "Route stub: 404" — which names neither
 * the problem nor the path, and offers no way out. The shell claim
 * (header and sidebar survive) comes from where this is mounted: it is
 * the *root* route's `notFoundComponent`, so the root's own component
 * stays rendered around it.
 */

function renderAt(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <div>
        <div>shell chrome</div>
        <Outlet />
      </div>
    ),
    notFoundComponent: NotFound,
  });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    component: () => <div>the list</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router as never} />);
  return router;
}

afterEach(cleanup);

describe("NotFound", () => {
  /**
   * @verifies SHL-16
   *
   * Names the problem, shows the path that was asked for, and offers a
   * way back — inside the shell, with the chrome still mounted.
   */
  it("renders inside the shell, names the path, and links to the list", async () => {
    renderAt("/nonsense");

    expect(await screen.findByText(/doesn.t exist/i)).toBeTruthy();
    // The shell survives: this is the root route's component, and the
    // 404 replaces only the outlet.
    expect(screen.getByText("shell chrome")).toBeTruthy();
    // The requested path is shown — a stale link and a typo are
    // indistinguishable without it.
    expect(screen.getByText("/nonsense")).toBeTruthy();

    const back = screen.getByRole("link", { name: /task list/i });
    expect(back.getAttribute("href")).toContain("/list");
  });

  /**
   * @verifies SHL-30
   *
   * The 404 is a normal history entry reached by navigation, so one
   * Back returns to the previous real view. It must not redirect,
   * which would consume a second entry and hide the dead link.
   */
  it("does not redirect away, so a single Back returns to the previous view", async () => {
    const router = renderAt("/list");
    expect(await screen.findByText("the list")).toBeTruthy();

    await router.navigate({ to: "/nonsense" as never });
    expect(await screen.findByText(/doesn.t exist/i)).toBeTruthy();

    router.history.back();
    expect(await screen.findByText("the list")).toBeTruthy();
  });
});
