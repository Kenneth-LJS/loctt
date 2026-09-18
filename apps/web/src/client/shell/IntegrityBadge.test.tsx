// @vitest-environment jsdom
import type { IntegritySummaryResponse } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrityBadge } from "./IntegrityBadge.tsx";

/**
 * DEG-31: the global integrity badge.
 *
 * It renders ONLY when `/api/integrity` reports `ok:false`; a clean tracker
 * shows nothing. When shown it is a `role="status"` link naming the total
 * and pointing at Diagnostics — not a toast, not an `alert`.
 */

let SUMMARY: IntegritySummaryResponse = { ok: true, counts: { tasks: 0, config: 0 }, total: 0 };

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/integrity")) {
      return Promise.resolve(
        new Response(JSON.stringify(SUMMARY), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  });
}

function renderBadge() {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <IntegrityBadge />,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <div>diagnostics pane</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([home, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  SUMMARY = { ok: true, counts: { tasks: 0, config: 0 }, total: 0 };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IntegrityBadge (DEG-31)", () => {
  // @verifies DEG-31
  it("is absent when the tracker is clean (ok:true)", async () => {
    SUMMARY = { ok: true, counts: { tasks: 0, config: 0 }, total: 0 };
    renderBadge();
    // Give the query time to resolve, then assert nothing rendered.
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("integrity-badge")).toBeNull();
  });

  // @verifies DEG-31
  it("renders a status link with the total and points at Diagnostics when ok:false", async () => {
    SUMMARY = { ok: false, counts: { tasks: 2, config: 1 }, total: 3 };
    renderBadge();
    const badge = await screen.findByTestId("integrity-badge");
    // Standing context, announced politely — not a toast/alert.
    expect(badge.getAttribute("role")).toBe("status");
    expect(badge.getAttribute("aria-live")).toBe("polite");
    // The total is shown (pluralised) and it links to the diagnostics section.
    expect(badge.textContent).toContain("3 data issues");
    expect(badge.getAttribute("href")).toBe("/settings/diagnostics");
  });

  // @verifies DEG-31
  it("uses the singular form for a lone issue", async () => {
    SUMMARY = { ok: false, counts: { tasks: 1, config: 0 }, total: 1 };
    renderBadge();
    const badge = await screen.findByTestId("integrity-badge");
    expect(badge.textContent).toContain("1 data issue");
    expect(badge.textContent).not.toContain("issues");
  });
});
