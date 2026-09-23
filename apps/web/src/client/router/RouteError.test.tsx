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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RootError, RouteError } from "./index.tsx";

/**
 * A component that throws during render — used below to stand in for
 * `AppBootstrap`/`AppShell`/`Header`, the shell that renders as the
 * root route's own `component` and so above every child route's
 * `errorComponent`.
 */
function ThrowingShell(): never {
  throw new Error("kaboom in the shell");
}

/**
 * Mounts a router whose root route's `component` throws (standing in
 * for the shell) and whose `errorComponent` is `RootError` — the
 * shape `router/index.tsx` wires for real.
 */
function renderThrowingRootAt(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const rootRoute = createRootRoute({
    component: ThrowingShell,
    errorComponent: ({ error, reset }) => <RootError error={error} reset={reset} />,
  });
  const childRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <div>child content</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([childRoute]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  render(<RouterProvider router={router as never} />);
}

/**
 * The **route-level** caller of the shared fallback.
 *
 * `RegionErrorBoundary.test.tsx` covers what the fallback renders when
 * asked. This file covers what this caller *asks for*, which is where
 * the two route-level decisions actually live:
 *
 *   - no narrow retry, ever, at this scope (Ken's call)
 *   - no back link when the broken route *is* `/list` (SHL-42)
 *
 * Both were previously unasserted anywhere: deleting `offerRetry={false}`
 * from `RouteError` left the entire web unit suite green.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Renders `RouteError` inside a router (the fallback's back link is a
 * `<Link>`, which needs one) with `window.location.pathname` set to the
 * route that broke — that pathname is the only input `RouteError` reads.
 */
function renderRouteErrorAt(pathname: string) {
  window.history.replaceState({}, "", pathname);

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const errorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <RouteError error={new Error("kaboom during render")} reset={() => undefined} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([errorRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router as never} />);
}

describe("RouteError — the route-level action row", () => {
  /**
   * @verifies SHL-42
   *
   * The route-level shape: Reload + a way out, and **no** narrow retry.
   *
   * `reset` remounts the route with unchanged props and unchanged data.
   * A route-level render crash is rarely state-dependent, so that
   * button overwhelmingly reproduces the crash it offers to fix —
   * which is why this scope withdraws it rather than rendering a
   * recovery that does not recover.
   */
  it("offers reload and a way out, and withdraws the narrow retry", async () => {
    renderRouteErrorAt("/board");

    const alert = await screen.findByRole("alert");
    // The region is named in user terms, from the route.
    expect(alert.querySelector("h2")?.textContent).toContain("the board");

    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to the task list/ })).toBeTruthy();

    // Matched loosely on purpose: a reworded retry ("Try again") would
    // slip past an exact "Try the board again" and still hand the user
    // a button that re-runs the same crash.
    expect(screen.queryByRole("button", { name: /try/i })).toBeNull();
  });

  /**
   * @verifies SHL-42
   *
   * "Offering to navigate to the page the user is already on is not a
   * way out." On `/list` the back link is suppressed — but Reload must
   * survive that suppression, or the row is left with no action at all.
   */
  it("suppresses the back link when the broken route is the list itself", async () => {
    renderRouteErrorAt("/list");

    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("h2")?.textContent).toContain("the task list");

    expect(screen.queryByRole("link", { name: /Back to the task list/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    // Still no retry: withdrawing it is a property of the scope, not a
    // consolation offered when the back link is unavailable.
    expect(screen.queryByRole("button", { name: /try/i })).toBeNull();
  });
});

/**
 * A320: a throw escaping the shell itself (`AppBootstrap`/`AppShell`/
 * `Header`, which render as the ROOT route's own `component`, above
 * every child route's `errorComponent`) must render this app's own
 * screen, not TanStack Router's built-in fallback.
 *
 * Ken's report: the trigger was a throw from `shell/Header.tsx`, and
 * what reached the screen was TanStack's default — "Something went
 * wrong!" + "Hide Error" + the raw error, unstyled, top-left. That
 * component has no `role="alert"`, no "Reload"/"Back" buttons, and
 * its own literal "Hide Error" toggle rather than our `Disclosure`
 * ("Show details", collapsed by default) — so this test distinguishes
 * the two on exactly those markers, not just on "some error text
 * appeared", which the default fallback would also satisfy.
 */
describe("the root route's errorComponent — a throw from the shell itself", () => {
  it("renders our screen, not TanStack's default fallback", async () => {
    renderThrowingRootAt("/");

    // Ours: a real alert region with our heading copy.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/something went wrong/i);

    // Not TanStack's default: that component's own literal control —
    // present only there, never in our fallback.
    expect(screen.queryByText("Hide Error")).toBeNull();
    expect(screen.queryByText("Something went wrong!")).toBeNull();
  });

  it("offers Reload and Back, with details collapsed", async () => {
    renderThrowingRootAt("/");

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();

    // No narrow retry at this scope either — a remount of the shell
    // with the same throwing code reproduces the same crash.
    expect(screen.queryByRole("button", { name: /try/i })).toBeNull();

    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Show details")).toBeTruthy();
  });
});

/**
 * A320: the full-page variant renders a bounded, centered content box
 * rather than a full-span block — the shape Ken asked for, verified
 * against the structure/classes the fallback actually relies on.
 */
describe("RegionErrorFallback — the full-page card", () => {
  it("is bounded (max-w) and centered on both axes, with a card surface", async () => {
    renderThrowingRootAt("/");

    const alert = await screen.findByRole("alert");
    // The outer region fills and centers within the viewport.
    expect(alert.className).toContain("h-screen");
    expect(alert.className).toContain("place-items-center");

    // The card itself is bounded, not full-span, and reads as a
    // surface distinct from the page behind it.
    const card = screen.getByTestId("error-fallback-card");
    expect(card.className).toContain("max-w-md");
    expect(card.className).toContain("w-full");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("border");
    expect(card.className).toContain("bg-bg-surface-raised");
  });
});
