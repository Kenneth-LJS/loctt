// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client.ts";
import { ServerUnreachableBanner } from "./ServerUnreachableBanner.tsx";

/**
 * The server going away mid-session.
 *
 * SHL-41 asks for a *persistent, app-level* state, which is what this
 * component is for: a per-view error tells a user nothing while they
 * are looking at a cached board, and "views do not render as empty in
 * the meantime" cannot be enforced one view at a time.
 *
 * The signal is deliberately not `navigator.onLine`. The server is on
 * loopback: it can stop while the network never changes, and the
 * network can drop while it keeps running.
 */

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, Wrapper };
}

/** Drives one query to a given outcome. */
async function seed(
  qc: QueryClient,
  key: string,
  outcome: "success" | Error,
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: [key],
    queryFn: () => (outcome === "success" ? Promise.resolve({ ok: true }) : Promise.reject(outcome)),
    retry: false,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ServerUnreachableBanner", () => {
  /**
   * @verifies SHL-41
   */
  it("says the server is not responding and names the concrete next action", async () => {
    const { qc, Wrapper } = harness();
    await seed(qc, "a", new TypeError("Failed to fetch"));

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });

    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(/not responding/i);
    // "the terminal running `loctt ui` may have stopped; restart it"
    expect(banner.textContent).toMatch(/loctt ui/);
    expect(banner.textContent).toMatch(/restart/i);
  });

  /**
   * @verifies SHL-41
   *
   * A 500 is the server *answering*. Reporting it as "not responding"
   * would send the user to restart a process that is running fine.
   */
  it("stays quiet when the server answered with an error", async () => {
    const { qc, Wrapper } = harness();
    await seed(
      qc,
      "a",
      new ApiError("boom", {
        status: 500,
        body: undefined,
        endpoint: "/api/tasks",
        envelope: { code: "io_failed", message: "boom" },
      }),
    );

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    expect(screen.queryByRole("status")).toBeNull();
  });

  /**
   * @verifies SHL-41
   *
   * "When the server comes back, retrying (or the next successful
   * poll) clears the state without a manual reload."
   */
  it("clears itself when a later request succeeds", async () => {
    const { qc, Wrapper } = harness();
    await seed(qc, "a", new TypeError("Failed to fetch"));

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    expect(await screen.findByRole("status")).toBeTruthy();

    // The timestamps have millisecond resolution and a tie resolves in
    // favour of the failure, so the success has to land in a later
    // millisecond for this to be the ordering the case describes.
    await new Promise(r => setTimeout(r, 5));
    await seed(qc, "b", "success");
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  /**
   * @verifies SHL-41
   *
   * And the reverse: a success from before the outage must not
   * suppress it. The most recent thing that happened is what counts.
   */
  it("appears even when an older success is still cached", async () => {
    const { qc, Wrapper } = harness();
    await seed(qc, "a", "success");
    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    expect(screen.queryByRole("status")).toBeNull();

    await new Promise(r => setTimeout(r, 5));
    await seed(qc, "b", new TypeError("Failed to fetch"));
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeNull();
    });
  });

  /**
   * @verifies SHL-41
   *
   * **This test asserted the bug.** It required silence for a query
   * that has data *and* a more recent failure — and that state is
   * exactly what a server dying with the page open produces, because
   * with the app loaded every query has already been answered.
   *
   * The M1 round-6 gate found the consequence: stop `loctt ui` with
   * the browser open and nothing says so — 50 stale rows under an
   * authoritative "Showing 1–50 of 63". Measured directly, with no
   * reload: the banner never appeared, at 12 seconds and again at 75.
   *
   * Its stated concern was real — a failed "Load more" is a failed
   * request, not a stopped process. But the two are **not
   * distinguishable in the cache**: both leave data plus a later
   * error, and both retry, so neither `errorUpdatedAt` nor
   * `fetchFailureCount` separates them.
   *
   * The cases settle it. SHL-41 (blocker) says "**the next failed
   * request** produces a persistent, visible state" — a failed Load
   * more is one. LST-49 (major) asks for an error near the control
   * and never asks for the banner to stay silent; that was this
   * test's invention. So the banner speaks, and LST-49's own error
   * still appears beside the control.
   */
  it("speaks when an answered query then fails — a dead server looks like this", () => {
    const { qc, Wrapper } = harness();
    // Data *and* a later error: the state a page-2 failure produces,
    // and equally the state of every query once the server dies.
    qc.setQueryData(["feed"], { pages: [{ items: [] }] });
    const query = qc.getQueryCache().find({ queryKey: ["feed"] });
    query?.setState({
      status: "error",
      error: new TypeError("Failed to fetch"),
      errorUpdatedAt: Date.now() + 1_000,
    });

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    expect(screen.queryByRole("status")).not.toBeNull();
  });

  /**
   * @verifies SHL-41
   *
   * The guard the fix must not lose: a failure that is *older* than
   * the last success is stale evidence. The server answered after it,
   * so it is running.
   *
   * Without this, the banner would latch on the first failure of the
   * session and never clear — the timestamp comparison, not the
   * status, is what makes recovery work.
   */
  it("stays quiet when the last thing that happened was a success", () => {
    const { qc, Wrapper } = harness();
    qc.setQueryData(["feed"], { pages: [{ items: [] }] });
    const query = qc.getQueryCache().find({ queryKey: ["feed"] });
    const now = Date.now();
    query?.setState({
      status: "error",
      error: new TypeError("Failed to fetch"),
      // The failure came first; the data landed after it.
      errorUpdatedAt: now - 1_000,
      dataUpdatedAt: now,
    });

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers an immediate retry rather than only waiting for the poll", async () => {
    const { qc, Wrapper } = harness();
    await seed(qc, "a", new TypeError("Failed to fetch"));
    const refetch = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined);

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    (await screen.findByRole("button", { name: "Try now" })).click();

    expect(refetch).toHaveBeenCalled();
  });

  /**
   * @verifies A311
   *
   * "Try now" moved onto `ui/Button`'s `variant="current"`, which
   * inherits this banner's `text-danger-fg` via `currentColor` instead
   * of carrying a fixed tone. A regression to `secondary` (neutral
   * border/surface) would sit wrong on the danger banner without
   * failing any of the text-content assertions above.
   */
  it("renders Try now on the current-tone Button variant, not a fixed tone", async () => {
    const { qc, Wrapper } = harness();
    await seed(qc, "a", new TypeError("Failed to fetch"));

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    const cls = (await screen.findByRole("button", { name: "Try now" })).className;
    expect(cls).toContain("border-current");
    expect(cls).not.toMatch(/border-border-default|bg-bg-surface/);
  });
});
