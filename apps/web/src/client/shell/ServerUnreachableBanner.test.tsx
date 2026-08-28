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

    const banner = await screen.findByRole("alert");
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
    expect(screen.queryByRole("alert")).toBeNull();
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
    expect(await screen.findByRole("alert")).toBeTruthy();

    await seed(qc, "b", "success");
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
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
    expect(screen.queryByRole("alert")).toBeNull();

    await seed(qc, "b", new TypeError("Failed to fetch"));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeNull();
    });
  });

  /**
   * @verifies SHL-41
   *
   * A page-2 request failing inside a query whose page 1 arrived is a
   * failed request, not a stopped process. Telling the user to go
   * restart a terminal that is running fine is worse than saying
   * nothing — and this is not hypothetical: the list's "Load more"
   * failure path produces exactly this state.
   */
  it("stays quiet when a query that has been answered loses a later request", () => {
    const { qc, Wrapper } = harness();
    // A query with data *and* an error: page 1 landed, page 2 did not.
    qc.setQueryData(["feed"], { pages: [{ items: [] }] });
    const query = qc.getQueryCache().find({ queryKey: ["feed"] });
    query?.setState({
      status: "error",
      error: new TypeError("Failed to fetch"),
      errorUpdatedAt: Date.now() + 1_000,
    });

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers an immediate retry rather than only waiting for the poll", async () => {
    const { qc, Wrapper } = harness();
    await seed(qc, "a", new TypeError("Failed to fetch"));
    const refetch = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined);

    render(<ServerUnreachableBanner />, { wrapper: Wrapper });
    (await screen.findByRole("button", { name: "Try now" })).click();

    expect(refetch).toHaveBeenCalled();
  });
});
