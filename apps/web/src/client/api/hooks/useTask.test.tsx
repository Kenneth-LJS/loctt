// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTask } from "./useTask.ts";

/**
 * The instrument A8's guards need.
 *
 * A Playwright test cannot see them. Measured over the network, a
 * build with both guards and a build with neither produce identical
 * request counts on the success path, because React Query will not
 * refetch a query that is fresh and already observed however many
 * times it is invalidated — see known-gaps.md § "A8's two guards".
 * A test written at that layer passed with the guard deleted, and was
 * deleted itself rather than shipped.
 *
 * `invalidateQueries` is the observable. Spying it counts the calls
 * directly, which is the thing the decision is about.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TASK = {
  frontmatter: { id: "01M15", key: "T-1", title: "A task" },
  body: "",
  attachments: [],
  lossyConstructs: [],
  relationships: [],
};

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const recentsCalls = () =>
    spy.mock.calls.filter(c => {
      const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
      return Array.isArray(key) && key[0] === "recents";
    }).length;
  return { wrapper, recentsCalls };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("useTask's recents invalidation", () => {
  /**
   * @verifies TSK-3
   *
   * Decision A8's first guard: `if (!isSuccess) return;`. A 404 means
   * nothing was pushed — `pushRecent` runs server-side inside the task
   * GET, and a request that 404s never reaches it — so re-reading
   * recents asks a question whose answer cannot have changed.
   */
  it("does not invalidate recents when the task is not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "not_found", message: 'task not found: "T-9"' }, 404),
    );
    const { wrapper, recentsCalls } = harness();
    const { result } = renderHook(() => useTask("T-9"), { wrapper });

    await waitFor(() => { expect(result.current.isError).toBe(true); });
    expect(recentsCalls()).toBe(0);
  });

  /**
   * @verifies TSK-3
   *
   * And the other half: a successful read *does* invalidate, once.
   * Paired with the test above deliberately — an absence assertion
   * alone is satisfied by a hook that invalidates nothing ever, which
   * is vacuity shape 3 from the M1 sweep.
   */
  it("invalidates recents once when the task loads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(TASK));
    const { wrapper, recentsCalls } = harness();
    const { result } = renderHook(() => useTask("T-1"), { wrapper });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(recentsCalls()).toBe(1);
  });

  /**
   * @verifies TSK-3
   *
   * Decision A8's second guard: the effect is keyed on
   * `dataUpdatedAt`, which changes once per *successful fetch* and is
   * stable across re-renders. An effect keyed on `data` would fire on
   * every render, since a fresh object identity arrives each time.
   *
   * Re-rendering without a new fetch must not invalidate again.
   */
  it("does not invalidate again on a re-render with no new fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(TASK));
    const { wrapper, recentsCalls } = harness();
    const { result, rerender } = renderHook(() => useTask("T-1"), { wrapper });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(recentsCalls()).toBe(1);

    rerender();
    rerender();
    rerender();
    expect(recentsCalls()).toBe(1);
  });
});
