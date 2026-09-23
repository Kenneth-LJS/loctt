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
 * @verifies VUE-22 (A313)
 *
 * The defect (verified live, 2026-09-23): `GET /api/tasks?view=<broken>`
 * returns a non-fatal `broken_view` diagnostic AND every task in the
 * tracker, unfiltered — the shape the decision behind `broken_view`
 * (docs/dev/decisions.md, the VUE-22 entry) explicitly chose *against*:
 * "a widened list would read as a legitimate result". `ListView` rendered
 * the banner and then every one of those unfiltered rows beneath it,
 * because the table's row/card/pagination logic only ever branched on
 * `items.length === 0`, which a `broken_view` response never is.
 *
 * `ListView.error.test.tsx` covers the sibling `ApiError` path (a
 * genuinely failed request); this covers the row of the response body
 * that succeeds (200) but carries a diagnostic instead of a real result.
 */
function stubFetch(taskResponseExtra: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/tasks")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              { id: "01A", key: "T-1", title: "Alpha", project: "p1" },
              { id: "01B", key: "T-2", title: "Beta", project: "p1" },
            ],
            total: 2,
            offset: 0,
            limit: 100,
            ...taskResponseExtra,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 100 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mount(initialSearch: string) {
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
    history: createMemoryHistory({ initialEntries: [`/list${initialSearch}`] }),
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

describe("the list under a broken saved view (VUE-22 / A313)", () => {
  it("does not render the unfiltered rows beneath the broken_view banner", async () => {
    stubFetch({
      broken_view: {
        id: "01BROKEN",
        name: "Busted",
        error: "unexpected token at position 9",
        position: 9,
      },
    });
    mount("?view=01BROKEN");

    // The banner is the content.
    await screen.findByTestId("broken-view");
    // The load-bearing assertion: before the fix, both unfiltered rows
    // (Alpha, Beta — from the stub's `items`) rendered underneath it.
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.queryByRole("row", { name: /Alpha|Beta/ })).toBeNull();
  });

  it("does not render 'No tasks match these filters' under the banner either", async () => {
    // A widened-to-zero table must not be mistaken for an ordinary empty
    // result — the exact substitution VUE-22's decision rejected.
    stubFetch({
      broken_view: {
        id: "01BROKEN",
        name: "Busted",
        error: "unexpected token at position 9",
        position: 9,
      },
    });
    mount("?view=01BROKEN");

    await screen.findByTestId("broken-view");
    expect(screen.queryByText(/No tasks match these filters/i)).toBeNull();
  });

  it("does not render the pagination footer's unfiltered count", async () => {
    stubFetch({
      broken_view: {
        id: "01BROKEN",
        name: "Busted",
        error: "unexpected token at position 9",
      },
      total: 14,
    });
    mount("?view=01BROKEN");

    await screen.findByTestId("broken-view");
    // Before the fix this read "Showing 1–14 of 14" — the unfiltered
    // total, presented as if it were the result of the (broken) view.
    expect(screen.queryByText(/Showing/i)).toBeNull();
  });

  it("still renders rows normally once the view is no longer broken (no view param)", async () => {
    // Control: the suppression must be specific to `broken_view`, not a
    // general regression in row rendering.
    stubFetch({});
    mount("");

    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });
});
