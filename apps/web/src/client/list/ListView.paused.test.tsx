// @vitest-environment jsdom
/**
 * The failure mode three gate rounds could not pin down.
 *
 * TanStack's retryer checks `onlineManager.isOnline()` *between* the
 * first failure and the retry (`retryer.ts`). If the browser reports
 * offline it pauses the query **indefinitely**: `status` stays
 * "pending", `fetchStatus` becomes "paused", and the error is never
 * recorded — so `isError` is false forever and every error branch keyed
 * on it is unreachable.
 *
 * That produced three separate wrong screens: stale rows under a new
 * filter's chips, "No tasks match these filters" on a cold navigation,
 * and a Load-more button that failed silently. One mechanism, three
 * symptoms, none of them reachable in a settled error state — which is
 * why every predicate written against `isError` failed, and why a
 * Playwright browser (always online) could not reproduce any of it.
 *
 * `networkMode: "always"` is the fix, and these tests hold the browser
 * offline to prove the app no longer depends on that flag. The server
 * is on loopback; `navigator.onLine` says nothing about whether it is
 * reachable.
 */
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../api/queryClient.ts";
import { listSearchSchema } from "../router/listSearch.ts";
import { ListView } from "./ListView.tsx";

function stubFetch(handler: (path: string) => Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url.replace(/^https?:\/\/[^/]+/, "")));
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mount(search = "") {
  // The *production* client, not a throwaway. The whole point is that
  // the defaults are what decide this.
  const qc = createQueryClient();
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: ListView,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: [`/list${search}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe("ListView while the browser reports offline", () => {
  // @verifies ERR-1
  it("states the failure rather than rendering the empty state", async () => {
    stubFetch(path => {
      if (path.startsWith("/api/tasks")) return Promise.reject(new Error("connection refused"));
      return ok({ items: [], total: 0, offset: 0, limit: 100 });
    });
    // The browser thinks it is offline. The server is on loopback and
    // is fine; under `networkMode: "online"` the query would pause here
    // and never resolve either way.
    onlineManager.setOnline(false);

    mount();

    // ERR-1: a server that is down and a tracker that is empty must be
    // visibly different screens. Conflating them reads as data loss.
    await screen.findByText(/Loading tasks/i, undefined, { timeout: 5_000 });
    expect(screen.queryByText(/No tasks match these filters/i)).toBeNull();
  });

  // @verifies ERR-2
  it("does not keep the previous filter's rows under a new filter", async () => {
    let failing = false;
    stubFetch(path => {
      if (path.startsWith("/api/tasks")) {
        if (failing) return Promise.reject(new Error("connection refused"));
        return ok({
          items: [{
            id: "t1", key: "WEB-1", title: "First task",
            created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          }],
          total: 1, offset: 0, limit: 50,
        });
      }
      return ok({ items: [], total: 0, offset: 0, limit: 100 });
    });

    const router = mount();
    await screen.findByText("First task");

    // The server dies and the browser reports offline, then the user
    // changes the filter — a new query key over held rows.
    failing = true;
    onlineManager.setOnline(false);
    await router.navigate({ to: "/list", search: { status: "done" } as never });

    // The rows belonged to the previous filter. Showing them under the
    // new one asserts an answer to a question that was never asked.
    await waitFor(
      () => { expect(screen.queryByText("First task")).toBeNull(); },
      { timeout: 5_000 },
    );
    expect(screen.queryByText(/No tasks match these filters/i)).toBeNull();
  });

  // @verifies ERR-2
  it("recovers on its own when the server comes back", async () => {
    let down = true;
    stubFetch(path => {
      if (path.startsWith("/api/tasks")) {
        if (down) return Promise.reject(new Error("connection refused"));
        return ok({
          items: [{
            id: "t1", key: "WEB-1", title: "Back again",
            created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          }],
          total: 1, offset: 0, limit: 50,
        });
      }
      return ok({ items: [], total: 0, offset: 0, limit: 100 });
    });

    mount();
    await screen.findByText(/Loading tasks/i, undefined, { timeout: 5_000 });

    // The server comes back. No reload, no click — the user does not
    // have to dismiss the error to see live data, and the poll only
    // runs while the query is in an error state.
    down = false;
    await screen.findByText("Back again", undefined, { timeout: 15_000 });
    expect(screen.queryByText(/Loading tasks/i)).toBeNull();
  }, 20_000);
});
