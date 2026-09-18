// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../api/queryClient.ts";
import { AppBootstrap } from "./AppBootstrap.tsx";

/**
 * What the app does when a *boot* read fails.
 *
 * These use the **production** `createQueryClient()`, not a test
 * client with `retry: false`. That distinction is the whole point:
 * the M1 gate found two blockers here that 2,353 unit tests missed,
 * and both live in states a non-retrying client never reaches —
 * one in the retry window, one after it.
 *
 * `AppBootstrap.test.tsx` stubs `fetch` but only ever drives the
 * schema-409 path, and its sole assertion about the fatal page is
 * that it is *absent*. Nothing exercised a request that simply
 * fails, so nothing caught either bug.
 */

/** How `fetch` should behave for this test. */
let MODE: "unreachable" | "schema-409" | "ok" = "ok";

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");

    if (MODE === "unreachable") {
      // What a killed server actually produces: not a status code, a
      // rejected fetch. There is no envelope, which is what separates
      // "the server is gone" from "the server said no".
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (MODE === "schema-409") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: "schema_mismatch",
            message: "This tracker was created by a newer version of LocTT (schema v9).",
            error: "This tracker was created by a newer version of LocTT (schema v9).",
            recovery: { kind: "none" },
            schema_status: { kind: "future", on_disk: 9, current: 1 },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    // A healthy tracker. `/api/info` and the current user have to be
    // real shapes or the bootstrap takes its "no tracker here yet"
    // branch and the test measures the wrong thing.
    const body = path.startsWith("/api/info")
      ? {
          exists: true,
          taskCount: 3,
          keyPrefix: "T-",
          nextKey: "T-4",
          schemaStatus: { kind: "current", version: 1 },
          cwd: "~/probe",
          today: "2026-08-28",
        }
      : path.startsWith("/api/user/current")
        ? { id: "u_ken", name: "Ken Loh", timezone: "UTC" }
        : path.startsWith("/api/views")
          ? { queries: [] }
          : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mount() {
  stubFetch();
  // The production client: real retry policy, real network mode.
  const qc = createQueryClient();
  const rootRoute = createRootRoute({ component: AppBootstrap });
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <div>list pane</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  MODE = "ok";
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppBootstrap when the server is unreachable", () => {
  /**
   * @verifies SHL-41, ERR-1
   *
   * The M1 gate's F1: killing the server and clicking a nav link
   * replaced the *entire app* with a bare "Something went wrong"
   * page — shell gone, sidebar gone, and no `[role=alert]` anywhere.
   *
   * SHL-41 requires the opposite: a persistent visible state saying
   * the server is not responding, with the shell still there. ERR-1
   * requires the failure to be legible rather than a blank.
   */
  it("keeps the shell up and states the failure", async () => {
    MODE = "unreachable";
    mount();

    // The chrome survives — this is the assertion the gate's repro
    // measured as `shellUp: false`.
    await waitFor(
      () => {
        expect(screen.queryByLabelText("Toggle sidebar")).not.toBeNull();
      },
      { timeout: 10_000 },
    );

    // And the failure is *stated*, not rendered as a blank or as an
    // empty tracker.
    const statuses = await screen.findAllByRole("status", {}, { timeout: 10_000 });
    const text = statuses.map(s => s.textContent ?? "").join(" ");
    expect(text).toMatch(/not responding/i);
    expect(text).toMatch(/loctt ui/);

    // Not the full-page fatal error.
    expect(screen.queryByText("Something went wrong")).toBeNull();
  }, 20_000);

  /**
   * @verifies SHL-41
   *
   * The gate's Repro B: no user interaction at all. `/api/info`
   * carries the app-wide refetch interval, so it re-fetches for the
   * lifetime of the tab — and a single failure used to trip the fatal
   * branch and collapse a working session unprompted.
   */
  it("survives a boot read that fails after the app is already up", async () => {
    MODE = "ok";
    const qc = mount();
    await screen.findByText("list pane");
    expect(screen.queryByLabelText("Toggle sidebar")).not.toBeNull();

    // The server goes away under a live session.
    MODE = "unreachable";
    await qc.refetchQueries({ queryKey: ["info"] });

    // The session is not destroyed by it.
    await waitFor(
      () => {
        expect(screen.queryByLabelText("Toggle sidebar")).not.toBeNull();
      },
      { timeout: 10_000 },
    );
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByText("list pane")).not.toBeNull();
  }, 20_000);
});

describe("AppBootstrap against a schema-mismatched tracker", () => {
  /**
   * @verifies SHL-13, XS-34, XS-35
   *
   * The M1 gate's F3: a cold load against a `future` tracker hung on
   * "Loading…" *forever* — `["info"]` stuck `pending`/`fetching`, so
   * `isLoading` (which is `isPending && isFetching`) never cleared
   * and the spinner branch won before any error branch was reached.
   *
   * The banner this file was previously rewritten to make reachable
   * was unreachable again by a different route. All three cases
   * require the shell up and the banner visible.
   */
  it("renders the banner rather than hanging on a spinner", async () => {
    MODE = "schema-409";
    mount();

    const banner = await screen.findByRole("alert", {}, { timeout: 10_000 });
    expect(banner.getAttribute("data-kind")).toBe("future");
    expect(banner.textContent).toContain("v9");
    expect(banner.textContent).toContain("v1");

    // The shell is up and navigable, per all three cases.
    expect(screen.queryByLabelText("Toggle sidebar")).not.toBeNull();
    expect(screen.queryByText("list pane")).not.toBeNull();

    // Specifically not the spinner the gate measured at 142 seconds.
    expect(screen.queryByText("Loading…")).toBeNull();
  }, 20_000);

  /**
   * @verifies SHL-13
   *
   * A 409 is a permanent answer. Retrying it wastes the retry budget
   * and — before the fix — held the query in a fetching state that
   * kept the spinner up. This pins the *reason* the hang is gone, so
   * a future change to the retry policy cannot quietly restore it.
   */
  it("does not retry a schema mismatch", async () => {
    MODE = "schema-409";
    mount();
    await screen.findByRole("alert", {}, { timeout: 10_000 });

    const infoCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(c => typeof c[0] === "string" && c[0].includes("/api/info"));
    // One attempt. A permanent status must not be retried.
    expect(infoCalls.length).toBe(1);
  }, 20_000);
});
