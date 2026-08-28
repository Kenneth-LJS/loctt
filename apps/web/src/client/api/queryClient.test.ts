// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { createQueryClient, STALENESS_WINDOW_MS } from "./queryClient.ts";

/**
 * The staleness contract.
 *
 * XS-2 asks for a *number*, not a behaviour: "the maximum time a value
 * can be wrong is a finite number", and "no view is configured with an
 * infinite staleTime such that a value can be wrong for the lifetime
 * of the tab". Both are configuration claims, so they are tested
 * against the configuration.
 */

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => { setVisibility("visible"); });

describe("query client staleness configuration", () => {
  /**
   * @verifies XS-2
   *
   * A healthy query polls on a finite interval. This was `false`,
   * which makes the maximum time a value can be wrong the lifetime of
   * the tab — the one state the case rules out by name.
   */
  it("bounds how long a healthy value may be wrong", () => {
    const defaults = createQueryClient().getDefaultOptions().queries;

    expect(STALENESS_WINDOW_MS).toBeGreaterThan(0);
    expect(Number.isFinite(STALENESS_WINDOW_MS)).toBe(true);

    const interval = defaults?.refetchInterval;
    expect(typeof interval).toBe("function");
    const healthy = (interval as (q: unknown) => number | false)({
      state: { status: "success" },
    });
    expect(healthy).toBe(STALENESS_WINDOW_MS);

    // No infinite staleTime anywhere in the defaults.
    expect(defaults?.staleTime).not.toBe(Infinity);
    expect(Number(defaults?.staleTime)).toBeLessThan(STALENESS_WINDOW_MS);
  });

  /**
   * @verifies XS-2
   *
   * An errored query still polls faster — recovery must not be gated
   * on the longer staleness window.
   */
  it("polls an errored query faster than the staleness window", () => {
    const interval = createQueryClient().getDefaultOptions().queries
      ?.refetchInterval as (q: unknown) => number | false;
    const errored = interval({ state: { status: "error" } });
    expect(errored).toBeLessThan(STALENESS_WINDOW_MS);
  });

  /**
   * @verifies XS-2
   *
   * "Focus is a refetch trigger, not only time." This was `false` on
   * the reasoning that nothing changes while you tab away — backwards
   * for a tracker whose CLI is the other thing in the terminal you
   * tabbed to.
   */
  it("treats returning to the tab as a refetch trigger", () => {
    expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
  });

  /**
   * @verifies XS-2
   *
   * The focus manager has two jobs that pull against each other: it
   * must report focused while hidden (so retries never stall), *and*
   * produce a false → true edge on return (so the focus refetch
   * fires). Reporting focused forever satisfies the first and
   * silently defeats the second.
   */
  it("still produces a focus transition when the tab comes back", () => {
    setVisibility("hidden");
    // Hidden must not read as blurred, or retries pause indefinitely.
    expect(focusManager.isFocused()).toBe(true);

    const seen: boolean[] = [];
    const unsubscribe = focusManager.subscribe(() => {
      seen.push(focusManager.isFocused());
    });
    setVisibility("visible");
    unsubscribe();

    // The edge TanStack hangs `refetchOnWindowFocus` off.
    expect(seen).toContain(false);
    expect(seen[seen.length - 1]).toBe(true);
    expect(focusManager.isFocused()).toBe(true);
  });
});
