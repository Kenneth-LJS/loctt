// @vitest-environment jsdom
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
    expect(text).toMatch(/display problem, not a data problem/i);
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
