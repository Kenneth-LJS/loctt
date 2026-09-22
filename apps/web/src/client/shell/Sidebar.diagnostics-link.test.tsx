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

import { Sidebar } from "./Sidebar.tsx";

/**
 * Config-discoverability (audit P3, K100): a sidebar group whose read
 * fails because the config would not parse must not dead-end at "run
 * `loctt doctor`" in a terminal. The group error now links straight to
 * Settings → Diagnostics, mirroring IntegrityBadge.
 */

const OK = { items: [], total: 0, offset: 0, limit: 100 };

/**
 * Fails `failing` endpoints with a structured `config_invalid`
 * envelope (a non-ok JSON body), the case where the fix the user can
 * actually make lives in Settings; everything else resolves empty.
 */
function stubConfigInvalid(...failing: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (failing.some(f => path.startsWith(f))) {
      return Promise.resolve(new Response(
        JSON.stringify({ code: "config_invalid", message: "config did not parse" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ));
    }
    if (path.startsWith("/api/views")) {
      return Promise.resolve(new Response(JSON.stringify({ queries: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify(OK), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  });
}

async function renderSidebar() {
  stubConfigInvalid("/api/projects");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => (
      <Sidebar collapsed={false} currentUserId="u_ken" today="2026-06-08" />
    ),
  });
  // A `/settings/$section` route must exist for the Link to resolve.
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByRole("alert");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a sidebar group failing on invalid config", () => {
  it("links to Diagnostics rather than dead-ending at the CLI", async () => {
    await renderSidebar();
    const link = screen.getByTestId("group-error-diagnostics-link");
    expect(link.getAttribute("href")).toBe("/settings/diagnostics");
  });
});
