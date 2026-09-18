// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegionErrorBoundary } from "./RegionErrorBoundary.tsx";

/**
 * The render-crash boundary.
 *
 * The scoping is the substance: ERR-34 calls a white page for a crash
 * in one row "a failing result", so a test that only checks the copy
 * would pass against a root-level boundary that swallows the app.
 */

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error("kaboom in the row");
  return <div>row content</div>;
}

beforeEach(() => {
  // React logs caught render errors; the boundary logs its own detail.
  // Both are expected here and would otherwise flood the run.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RegionErrorBoundary", () => {
  /**
   * @verifies ERR-34
   *
   * A throw inside one boundary leaves its siblings mounted. This is
   * the difference between a contained failure and a white page.
   */
  it("contains a throw to its own region, leaving siblings rendered", () => {
    render(
      <>
        <RegionErrorBoundary region="the task list">
          <Boom explode />
        </RegionErrorBoundary>
        <RegionErrorBoundary region="the sidebar">
          <div>sidebar content</div>
        </RegionErrorBoundary>
      </>,
    );

    expect(screen.getByRole("alert").textContent).toContain("the task list");
    // The neighbour is untouched.
    expect(screen.getByText("sidebar content")).toBeTruthy();
  });

  /**
   * @verifies ERR-35
   *
   * "The single most reassuring true thing the app can say here" — and
   * it must stay true: with a write in flight it says what it does not
   * know rather than claiming the last action landed.
   */
  it("says the data on disk is unaffected, and does not overclaim a write", () => {
    const { unmount } = render(
      <RegionErrorBoundary region="the task list">
        <Boom explode />
      </RegionErrorBoundary>,
    );
    const text = screen.getByRole("alert").textContent ?? "";
    // "Something in the app failed to display — a display fault, not a
    // data fault." SHL-42 wants the same thing said as "a bug rather
    // than a data problem", so the copy says both halves.
    expect(text).toMatch(/failed to draw/i);
    expect(text).toMatch(/not a problem with your data/i);
    expect(text).toContain(".loctt/");
    // Nothing was in flight, so no claim either way is made about one.
    expect(text).not.toMatch(/being saved/i);
    unmount();

    render(
      <RegionErrorBoundary region="the task list" writeInFlight>
        <Boom explode />
      </RegionErrorBoundary>,
    );
    const inflight = screen.getByRole("alert").textContent ?? "";
    expect(inflight).toMatch(/can.t tell you whether that one landed/i);
  });

  /**
   * @verifies ERR-36
   *
   * The headline names the region in user terms, and recovery is
   * offered at two widths — retry this region, or reload the page —
   * so the user is not forced to lose the whole page.
   */
  it("names the region and offers both a narrow retry and a reload", () => {
    render(
      <RegionErrorBoundary region="the description editor">
        <Boom explode />
      </RegionErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    // The headline is what the user reads first; the component name may
    // appear in the collapsed detail, which is where ERR-37 puts it.
    const headline = alert.querySelector("h2")?.textContent ?? "";
    expect(headline).toContain("the description editor");
    expect(headline).not.toContain("Boom");
    expect(screen.getByRole("button", { name: /Try the description editor again/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  /**
   * @verifies ERR-36
   *
   * "Try again" has to actually remount the subtree, not just clear the
   * flag — a boundary that re-renders the same broken instance shows
   * the error again and reads as a dead button.
   */
  it("retry remounts the region and recovers when the cause is gone", () => {
    let shouldExplode = true;
    function Flaky() {
      if (shouldExplode) throw new Error("kaboom in the row");
      return <div>row content</div>;
    }

    render(
      <RegionErrorBoundary region="the task list">
        <Flaky />
      </RegionErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    shouldExplode = false;
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Try the task list again/ }));
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("row content")).toBeTruthy();
  });

  /**
   * @verifies ERR-37
   *
   * The detail is retrievable but not the headline: behind a
   * disclosure, and carrying enough for a bug report.
   */
  it("keeps the stack out of the headline but exposes copyable detail", () => {
    render(
      <RegionErrorBoundary region="the task list">
        <Boom explode />
      </RegionErrorBoundary>,
    );

    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    // Closed by default — the user does not read the stack first.
    expect(details?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Show details")).toBeTruthy();

    const pre = details?.querySelector("pre")?.textContent ?? "";
    expect(pre).toContain("kaboom in the row");
    expect(pre).toContain("Region: the task list");
    expect(pre).toMatch(/Route:/);
    expect(pre).toMatch(/LocTT:/);
    expect(screen.getByRole("button", { name: "Copy details" })).toBeTruthy();
  });

  /**
   * @verifies ERR-37
   *
   * The stack reaches the console, which is where a bug report picks
   * it up.
   */
  it("logs the error and component stack to the console", () => {
    render(
      <RegionErrorBoundary region="the task list">
        <Boom explode />
      </RegionErrorBoundary>,
    );
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("render error in the task list");
    expect(logged).toContain("kaboom in the row");
  });
});

/**
 * The error surface's own robustness, and its keyboard operability.
 *
 * ERR-33 asks for proof the generic fallback is "reachable at all, and
 * is tested" rather than dead code. ERR-38 asks that a throw *inside*
 * the error surface not cascade. A11Y-54 asks that the fallback be
 * keyboard-operable and that focus reach it.
 */
describe("the error surface itself", () => {
  /**
   * @verifies ERR-33
   *
   * The case's first bullet: "an intentionally unattributable fault
   * produces the ERR-30 surface rather than an unhandled rejection, a
   * blank region, or a console-only error."
   *
   * An error with no message and no name is as unattributable as it
   * gets — nothing about it can be mapped to a specific cause, so it
   * must land in the generic fallback. The assertion is that the
   * region still *renders something legible*, which is what
   * distinguishes this from the blank region the case forbids.
   */
  it("renders the generic fallback for a fault it cannot attribute", () => {
    function Unattributable(): never {
      // No message, no name, no code — nothing to key a specific
      // message off.
      throw new Error("");
    }

    render(
      <RegionErrorBoundary region="the task list">
        <Unattributable />
      </RegionErrorBoundary>,
    );

    // Not blank, and not console-only: the region names itself in user
    // terms and offers a way out, which is the ERR-30 surface.
    expect(screen.getByRole("heading").textContent).toContain("the task list");
    expect(screen.getByRole("button", { name: /try/i })).toBeTruthy();
  });

  /**
   * @verifies ERR-38
   *
   * "Force a throw inside the toast provider or the error-boundary
   * fallback itself."
   *
   * The fallback renders a `<pre>` built from the caught error. An
   * error whose `stack` getter throws is the sharpest available probe:
   * the boundary has already caught something, and now the act of
   * *describing* it throws too.
   *
   * The bar the case sets is deliberately low — "at worst a plain
   * static fallback" — but it is a real bar: an infinite
   * render/throw loop or a blank page both fail it.
   */
  it("does not cascade when describing the error itself throws", () => {
    const hostile = new Error("original cause");
    Object.defineProperty(hostile, "stack", {
      get() { throw new Error("secondary failure while reading stack"); },
    });

    function Hostile(): never { throw hostile; }

    // The assertion is that this returns at all. A render/throw loop
    // would blow the stack rather than fail an expectation, and a
    // rethrow would propagate out of `render`.
    expect(() => {
      render(
        <RegionErrorBoundary region="the task list">
          <Hostile />
        </RegionErrorBoundary>,
      );
    }).not.toThrow();

    // Second bullet: "something legible still reaches the user".
    expect(screen.getByRole("heading").textContent).toContain("the task list");

    // Third bullet: "the console still receives the original error,
    // not only the secondary one, so the root cause is not lost".
    //
    // Asserted against **the boundary's own log line**, not against
    // the console as a whole. React logs caught render errors itself,
    // so a whole-console assertion passes even with the boundary's
    // logging deleted — measured: removing `error` from the boundary's
    // `console.error` call left this test green. That is vacuity shape
    // (a), something else doing the work.
    //
    // So the call is located by the boundary's own prefix, and the
    // original error must be among *that* call's arguments.
    const ownCall = vi
      .mocked(console.error)
      .mock.calls.find(args => String(args[0]).includes("[loctt] render error in"));
    expect(ownCall, "the boundary did not log its own line").toBeDefined();
    expect(String((ownCall ?? []).map(a => String(a)).join(" "))).toContain("original cause");
  });

  /**
   * @verifies A11Y-54
   *
   * The fallback's recovery actions must be reachable and activatable
   * by keyboard, and the stack must not be the first thing announced.
   */
  it("exposes a heading and keyboard-activatable recovery actions", () => {
    render(
      <RegionErrorBoundary region="the task list">
        <Boom explode />
      </RegionErrorBoundary>,
    );

    // First bullet: the heading is announced. A real heading element,
    // not a styled div — `getByRole` resolves the browser's semantics,
    // so this fails if the copy is rendered as a bare `<span>`.
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toContain("the task list");

    // First bullet, second half: the recovery actions are focusable
    // and activatable. Buttons are keyboard-activatable by nature —
    // the real risk is a `<div onClick>`, which `getByRole("button")`
    // would not find.
    const retry = screen.getByRole("button", { name: /try/i });
    retry.focus();
    expect(document.activeElement).toBe(retry);

    // Third bullet: "a raw stack trace, if shown at all, is behind a
    // collapsed disclosure that is not the first thing announced."
    const details = document.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    // And the disclosure comes *after* the heading in document order,
    // so a screen reader reaches the explanation before the stack.
    expect(
      heading.compareDocumentPosition(details as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/**
 * @verifies SHL-42
 *
 * The route-level boundary owes more than the region ones: the whole
 * main pane is gone, so "reload" alone leaves the user reloading the
 * same broken route. A way *out* is the other half.
 */
describe("RegionErrorBoundary at route level", () => {
  function mountWithRouter(offerListLink: boolean) {
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const boomRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/board",
      component: () => (
        <RegionErrorBoundary region="the board" offerListLink={offerListLink}>
          <Boom explode />
        </RegionErrorBoundary>
      ),
    });
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/list",
      component: () => <div>the list</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([boomRoute, listRoute]),
      history: createMemoryHistory({ initialEntries: ["/board"] }),
    });
    render(<RouterProvider router={router as never} />);
    return router;
  }

  it("offers a way back to the list alongside reload", async () => {
    mountWithRouter(true);

    const alert = await screen.findByRole("alert");
    // Says what was being displayed, in user terms.
    expect(alert.querySelector("h2")?.textContent).toContain("the board");
    // A bug on our side, not a data problem.
    expect(alert.textContent).toMatch(/bug on our side/i);
    expect(alert.textContent).toMatch(/not a problem with your data/i);
    // No raw stack as the primary message — it is behind the
    // disclosure, which is closed.
    expect(alert.querySelector("details")?.hasAttribute("open")).toBe(false);

    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    const back = screen.getByRole("link", { name: /Back to the task list/ });
    expect(back.getAttribute("href")).toContain("/list");
  });

  it("does not offer to navigate to the page the user is already on", async () => {
    mountWithRouter(false);

    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: /Back to the task list/ })).toBeNull();
    // Reload and the narrow retry are still there.
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try the board again/ })).toBeTruthy();
  });
});
