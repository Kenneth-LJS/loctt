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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppBootstrap } from "./AppBootstrap.tsx";

/**
 * UI-18: `<main>` occupies only the grid's `auto` column on any
 * viewport where `Sidebar` renders `null` (R2, < 900px — no in-grid
 * rail, the drawer is an overlay outside this grid). With nothing else
 * to auto-place into row 2's first cell, an implicit `<main>`
 * (`grid-column: auto`) fell into that now-empty `auto` track itself
 * instead of the `1fr` content column — sized to its own content
 * rather than the remaining width, leaving a bare gap on the right.
 *
 * Reproduced live at a settled 800×900 load (below the 900px
 * `NARROW_PX` breakpoint, so `Sidebar` returns `null`): `<main>`
 * measured 494.89px of 800px, `gridTemplateColumns` resolving to
 * "494.891px 305.109px". jsdom has no layout engine, so this test
 * cannot re-measure the pixel gap; it locks in the explicit
 * `col-start-2` class that is the actual fix — `<main>` always
 * targets the `1fr` content column by construction rather than by
 * auto-placement order, which is what made the bug viewport-dependent
 * in the first place.
 */

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    let body: unknown = {};
    if (path.startsWith("/api/views")) body = { queries: [] };
    else if (path.startsWith("/api/info")) {
      body = {
        exists: true,
        initState: "ready",
        taskCount: 0,
        keyPrefix: "T",
        nextKey: "T-1",
        schemaStatus: { kind: "current" },
        cwd: "~/tracker",
        today: "2026-06-08",
      };
    } else if (path.startsWith("/api/user/current")) {
      body = { id: "u_ken", name: "Ken" };
    }
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
}

beforeEach(() => {
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

describe("AppShell main pane grid placement (UI-18)", () => {
  it("explicitly targets the content column rather than relying on auto-placement", async () => {
    mount();
    await screen.findByText("list pane");

    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.className).toMatch(/\bcol-start-2\b/);
  });
});
