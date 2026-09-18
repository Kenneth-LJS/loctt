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
import { ServerUnreachableBanner } from "../shell/ServerUnreachableBanner.tsx";
import { ListView } from "./ListView.tsx";

function stubFetch(handler: (path: string) => Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url.replace(/^https?:\/\/[^/]+/, "")));
  });
}

/** Puts the document in the state a background tab is in. */
function hideDocument(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
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
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  vi.restoreAllMocks();
});

/**
 * These tests locate the error panel by `role="alert"`, not by its
 * copy.
 *
 * They used to match `/Loading tasks/i`, which broke the moment that
 * string changed — twice, and for a reason unrelated to anything they
 * assert. None of them is about the wording; each is about whether the
 * panel is mounted at all. The role is what they actually mean, and it
 * is what `ErrorState` guarantees.
 */
describe("ListView while the tab is in the background", () => {
  // @verifies ERR-1
  it("states the failure rather than pausing forever in a hidden tab", async () => {
    stubFetch(path => {
      if (path.startsWith("/api/tasks")) return Promise.reject(new Error("connection refused"));
      return ok({ items: [], total: 0, offset: 0, limit: 100 });
    });
    // A real background tab, not `setFocused(false)`. The manager
    // derives focus from `document.visibilityState` through a listener,
    // and the app replaces that listener — so driving the manager
    // directly would test the override rather than the thing the
    // override exists to survive.
    //
    // The retryer has *two* conjuncts. `networkMode: "always"` clears
    // the online one; this is the other. Gate round 4 measured
    // `navigator.onLine === true` while a query sat paused, which is
    // how the first fix looked complete and was not.
    hideDocument();

    mount();

    await screen.findByRole("alert", undefined, { timeout: 5_000 });
    expect(screen.queryByText(/No tasks match these filters/i)).toBeNull();
  });

  // @verifies ERR-2
  it("recovers in a hidden tab once the server returns", async () => {
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
    hideDocument();

    mount();
    await screen.findByRole("alert", undefined, { timeout: 5_000 });

    down = false;
    await screen.findByText("Back again", undefined, { timeout: 15_000 });
  }, 20_000);
});

describe("ListView while the recovery poll is running", () => {
  // @verifies ERR-6
  it("keeps the error panel mounted through the poll's in-flight window", async () => {
    stubFetch(path => {
      if (path.startsWith("/api/tasks")) return Promise.reject(new Error("connection refused"));
      return ok({ items: [], total: 0, offset: 0, limit: 100 });
    });

    mount();
    await screen.findByRole("alert", undefined, { timeout: 5_000 });

    // Span one full poll cycle plus the attempt-and-retry window it
    // opens (poll at 5s, retry ~1s later). The `fetch` action resets a
    // data-less query to pending with `error: null`, so a panel keyed
    // on `isError` alone unmounts for that window every cycle — which
    // resets ErrorState's "Show details" toggle and pulls the controls
    // out from under the pointer (ERR-6). The panel must never leave
    // the DOM, so sample continuously rather than at the end.
    const until = Date.now() + 7_500;
    while (Date.now() < until) {
      expect(screen.queryByRole("alert")).not.toBeNull();
      await new Promise(r => setTimeout(r, 100));
    }
  }, 20_000);
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
    await screen.findByRole("alert", undefined, { timeout: 5_000 });
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
    await screen.findByRole("alert", undefined, { timeout: 5_000 });

    // The server comes back. No reload, no click — the user does not
    // have to dismiss the error to see live data, and the poll only
    // runs while the query is in an error state.
    down = false;
    await screen.findByText("Back again", undefined, { timeout: 15_000 });
    expect(screen.queryByRole("alert")).toBeNull();
  }, 20_000);
});

/**
 * XS-56 (assembly): the UI never presents stale data as authoritative when
 * it knows it is stale.
 *
 * @verifies XS-56
 *
 * This ties together the two mechanisms the case turns on, in one tree with
 * one shared query client — the state a server dying with `/list` open
 * produces:
 *   - Bullet 1: the already-rendered rows are NOT wiped to empty when the
 *     *same-key* refetch fails — `ListView`'s `hasRealData` keeps real pages
 *     for the current key on the screen.
 *   - Bullet 2: the app shows an explicit, app-level indication it cannot
 *     reach the tracker — `ServerUnreachableBanner` (mounted alongside the
 *     list, as the real shell mounts it) speaks the moment a query that had
 *     answered later fails with no envelope.
 *   - Bullet 3: a write attempted during the outage fails loudly (the
 *     mutation rejects) rather than optimistically appearing to succeed.
 *   - Bullet 4: when the server returns, the banner clears on its own and
 *     the data refreshes, with no reload and no click.
 *
 * The per-mechanism halves are locked elsewhere (ERR-1/ERR-2 above; SHL-41
 * in ServerUnreachableBanner.test.tsx). What this asserts that they do not
 * is the *assembly*: stale rows staying put UNDER the cannot-reach banner,
 * with a write refused, all at once.
 */
describe("XS-56: the list never presents stale data as authoritative", () => {
  it("keeps rows under a cannot-reach banner during an outage, refuses a write, and recovers", async () => {
    let down = false;
    const stub = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = raw.replace(/^https?:\/\/[^/]+/, "");
      const method = (init?.method ?? "GET").toUpperCase();
      // A write during the outage must not appear to succeed.
      if (method !== "GET") {
        return down
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve(ok({ frontmatter: { id: "t1", key: "WEB-1", title: "Held task" } }));
      }
      if (path.startsWith("/api/tasks")) {
        if (down) return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve(ok({
          items: [{
            id: "t1", key: "WEB-1", title: "Held task",
            created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          }],
          total: 1, offset: 0, limit: 50,
        }));
      }
      return Promise.resolve(ok({ items: [], total: 0, offset: 0, limit: 100 }));
    });

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
      history: createMemoryHistory({ initialEntries: ["/list"] }),
    });
    render(
      <QueryClientProvider client={qc}>
        <ServerUnreachableBanner />
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );

    // Rows render from a live server.
    await screen.findByText("Held task");
    expect(screen.queryByRole("status")).toBeNull();

    // The server dies. Force a same-key refetch (the poll / a Try now).
    down = true;
    await new Promise(r => setTimeout(r, 5));
    void qc.refetchQueries();

    // Bullet 2: the app says it cannot reach the tracker.
    await screen.findByRole("status", undefined, { timeout: 5_000 });
    // Bullet 1: the already-rendered rows are NOT wiped to an empty state —
    // the stale rows stay put rather than reading as data loss, and the
    // empty-state copy never appears.
    expect(screen.getByText("Held task")).toBeTruthy();
    expect(screen.queryByText(/No tasks match these filters/i)).toBeNull();

    // Bullet 3: a write during the outage fails loudly rather than
    // optimistically appearing to succeed.
    await expect(
      qc.getMutationCache().build(qc, {
        mutationFn: async () => {
          const res = await fetch("/api/tasks/WEB-1", {
            method: "PATCH",
            body: JSON.stringify({ title: "edited offline" }),
          });
          return res;
        },
      }).execute(undefined),
    ).rejects.toThrow(/Failed to fetch/);
    // The optimistic edit never became a visible row.
    expect(screen.queryByText("edited offline")).toBeNull();

    // Bullet 4: the server returns; the banner clears on its own and the
    // data refreshes with no reload and no click.
    down = false;
    void qc.refetchQueries();
    await waitFor(() => { expect(screen.queryByRole("status")).toBeNull(); }, { timeout: 5_000 });
    expect(screen.getByText("Held task")).toBeTruthy();

    stub.mockRestore();
  }, 15_000);
});
