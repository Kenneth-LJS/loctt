// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { listSearchSchema } from "../router/listSearch.ts";
import { ListView } from "./ListView.tsx";

/** ListView calls `useCreateTask`; wrap it as the shell does. */
function WrappedListView() {
  return (
    <CreateTaskProvider>
      <ListView />
    </CreateTaskProvider>
  );
}

/**
 * ERR-1: a server that is down and a tracker that is empty must be
 * visibly different screens.
 *
 * The bug: ListView branched on `isLoading` then `items.length === 0`,
 * so a failed `/api/tasks` fell through to the empty state and rendered
 * "No tasks match these filters." A user whose server had stopped was
 * told their tracker was empty, which reads as data loss.
 *
 * The error branch is gated on `items.length === 0`, because a failed
 * *Load more* also sets `isError` and replacing the table there would
 * discard rows the user already has. That interaction is covered by
 * LST-49 in `ListView.test.tsx`; a duplicate here was written and
 * removed after mutation showed it passing whether the guard was
 * present or not.
 */

/** Everything except /api/tasks succeeds, so only the task query fails. */
function stubFetch(taskResponse: () => Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/tasks")) return taskResponse();
    return Promise.resolve(
      new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 100 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: WrappedListView,
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
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the list when /api/tasks fails", () => {
  it("does not render the empty state when the server is unreachable", async () => {
    // A transport failure: fetch rejects, so the error never becomes an
    // ApiError and carries no envelope.
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    mount();

    await screen.findByRole("alert");
    // The load-bearing assertion. Before the fix this string was on
    // screen and the failure was invisible.
    expect(screen.queryByText("No tasks match these filters.")).toBeNull();
  });

  it("names the likely cause rather than blaming the network", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    mount();

    const alert = await screen.findByRole("alert");
    // There is no network in a localhost app; the actual likely cause
    // is that the user stopped the process.
    expect(alert.textContent).toMatch(/not responding/i);
    expect(alert.textContent).toMatch(/loctt ui/);
    expect(alert.textContent).not.toMatch(/network|connection/i);
  });

  it("offers retry as a button, not as prose", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    mount();

    // ERR-15: "Please try again" with no control is a failing result.
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows the server's own message when it sent an envelope", async () => {
    stubFetch(() => Promise.resolve(new Response(
      JSON.stringify({
        code: "config_invalid",
        message: "workflow.yaml could not be read.",
        recovery: { kind: "command", command: "loctt doctor" },
        detail: "EACCES: permission denied",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));
    mount();

    const alert = await screen.findByRole("alert");
    // The server knows the cause, so the generic wording must not win
    // (ERR-31).
    expect(alert.textContent).toContain("workflow.yaml could not be read.");
    expect(alert.textContent).not.toMatch(/not responding/i);
  });

  it("renders a recovery command copyably rather than as a retry button", async () => {
    stubFetch(() => Promise.resolve(new Response(
      JSON.stringify({
        code: "schema_mismatch",
        message: "This tracker needs migrating.",
        recovery: { kind: "command", command: "loctt migrate" },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    )));
    mount();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("loctt migrate");
    // Retry cannot help here, so offering it would be a control that
    // does nothing (ERR-15).
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps technical detail out of the headline", async () => {
    stubFetch(() => Promise.resolve(new Response(
      JSON.stringify({
        code: "io_failed",
        message: "The tracker directory is not writable.",
        detail: "EACCES: permission denied, open '/x/.loctt/state.yaml'",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));
    mount();

    const alert = await screen.findByRole("alert");
    // ERR-16: no raw errno in user-facing copy. It is allowed behind
    // "Show details", which is collapsed until asked for.
    expect(alert.textContent).not.toContain("EACCES");
    expect(screen.getByRole("button", { name: "Show details" })).toBeTruthy();
  });

  it("states the data state when the server reported one", async () => {
    stubFetch(() => Promise.resolve(new Response(
      JSON.stringify({
        code: "unknown",
        message: "The request was cut off.",
        data_state: "unknown",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));
    mount();

    const alert = await screen.findByRole("alert");
    // ERR-18: the user's next action depends on knowing this.
    expect(alert.textContent).toMatch(/not known/i);
  });
});

describe("a query that fails server-side", () => {
  // @verifies VUE-39
  it("is reported as a failure, never as zero results", async () => {
    // VUE-39: a query timing out or failing server-side must not reuse
    // VUE-28's empty-state copy. The distinction matters most here,
    // because both outcomes render an empty table body.
    stubFetch(() => Promise.resolve(new Response(
      JSON.stringify({
        code: "unknown",
        message: "The query could not be completed.",
        recovery: { kind: "retry" },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));
    mount();

    const alert = await screen.findByRole("alert");
    // States what was attempted (ERR-30 / VUE-39's second bullet)...
    expect(alert.textContent).toMatch(/could not load tasks/i);
    // ...and the server's own reason.
    expect(alert.textContent).toContain("The query could not be completed.");

    // The load-bearing half: VUE-28's copy is never reused for this.
    expect(screen.queryByText("No tasks match these filters.")).toBeNull();
  });

  // @verifies VUE-39
  it("offers a retry for a failed query rather than leaving a dead end", async () => {
    stubFetch(() => Promise.resolve(new Response(
      JSON.stringify({
        code: "unknown",
        message: "The query could not be completed.",
        recovery: { kind: "retry" },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));
    mount();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
