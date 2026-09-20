// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarGroupsPanel } from "./SidebarGroupsPanel.tsx";

/**
 * The sidebar-groups editor (SHL-45).
 *
 * The assertion that matters is the *request*: the editor must persist
 * the user's hide/reorder choice through `PUT /api/user-settings`, so
 * the tests read what the client actually PUT rather than what the
 * panel renders.
 */

/** Stored settings returned by /api/user-settings, per-test. */
let SETTINGS: Record<string, unknown> = {};

/** Every PUT body sent to /api/user-settings, in order. */
let PUTS: Record<string, unknown>[] = [];

function stubFetch(): void {
  vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : String(input);
    const path = raw.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/user-settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(
          typeof init.body === "string" ? init.body : "{}",
        ) as Record<string, unknown>;
        PUTS.push(body);
        SETTINGS = body;
        return Promise.resolve(new Response(JSON.stringify({ user: "u1", settings: body }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ user: "u1", settings: SETTINGS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  }));
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // A cross-link `<Link to="/settings/$section">` needs a router with that
  // route registered, so the panel renders inside a memory router.
  const rootRoute = createRootRoute({ component: () => <SidebarGroupsPanel /> });
  const sectionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([sectionRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  SETTINGS = {};
  PUTS = [];
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SidebarGroupsPanel", () => {
  it("lists every built-in group and filter", async () => {
    // @verifies SHL-45
    renderPanel();
    await screen.findByText("Projects");
    screen.getByText("Recently viewed");
    screen.getByText("Filter · Overdue");
  });

  it("persists a hide choice through PUT /api/user-settings", async () => {
    // @verifies SHL-45 — the editor persists the setting
    renderPanel();
    const toggle = await screen.findByTestId("sidebar-group-toggle-labels");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(PUTS.length).toBeGreaterThan(0);
    });
    const last = PUTS[PUTS.length - 1];
    const groups = last?.["sidebar_groups"] as { hidden?: string[]; order?: string[] };
    expect(groups.hidden).toContain("labels");
    // The full order is written too, so the file and the panel agree.
    expect(groups.order).toEqual(expect.arrayContaining(["projects", "labels"]));
  });

  it("shows the server message and a Retry when the save fails", async () => {
    // The ErrorState standard: the server's reason + a Retry, not a bare
    // "not saved" line. Red-proven — the pre-fix panel had neither testid
    // nor a Retry control.
    const { within } = await import("@testing-library/react");
    vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, "");
      if (path.startsWith("/api/user-settings") && init?.method === "PUT") {
        return Promise.resolve(new Response(
          JSON.stringify({ message: "settings.yaml is read-only", code: "rejected_write" }),
          { status: 500, headers: { "content-type": "application/json" } },
        ));
      }
      if (path.startsWith("/api/user-settings")) {
        return Promise.resolve(new Response(JSON.stringify({ user: "u1", settings: SETTINGS }), {
          status: 200, headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    }));
    renderPanel();
    fireEvent.click(await screen.findByTestId("sidebar-group-toggle-labels"));

    const host = await screen.findByTestId("sidebar-groups-save-error");
    expect(host.textContent).toContain("read-only");
    expect(within(host).getByRole("button", { name: "Retry" })).toBeTruthy();
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(within(host).getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("reset clears the setting entirely", async () => {
    // @verifies SHL-45 — reset returns to the default (absent) setting
    SETTINGS = { sidebar_groups: { hidden: ["labels"] }, theme: "dark" };
    renderPanel();
    const reset = await screen.findByTestId("sidebar-groups-reset");
    fireEvent.click(reset);
    await waitFor(() => {
      expect(PUTS.length).toBeGreaterThan(0);
    });
    const last = PUTS[PUTS.length - 1];
    // sidebar_groups is dropped; the unrelated setting survives.
    expect(last).not.toHaveProperty("sidebar_groups");
    expect(last?.["theme"]).toBe("dark");
  });

  /**
   * Task 1 (A244): the two sidebar-config sections were a confusable pair.
   * This panel cross-links to the sibling "Pinned views" section.
   */
  it("cross-links to the Pinned views section", async () => {
    // @verifies A244 — the cross-link. Red-proof: deleting the <Link>, or
    // pointing it at the wrong section, fails the href assertion.
    renderPanel();
    const link = await screen.findByTestId("sidebar-groups-see-pins");
    expect(link.textContent).toMatch(/Pinned views/);
    expect(link.getAttribute("href")).toContain("/settings/sidebar-pins");
  });

  it("omits its own heading when embedded, so the enclosing sheet titles it", async () => {
    // @verifies A244 — the inline-config reuse (K100 in-place). The gear in
    // the sidebar renders THIS panel inside a Sheet that supplies the
    // title, so `embedded` drops the panel's <h1> to avoid two titles.
    // Red-proof: rendering `embedded` still showing the <h1> fails this;
    // the editor itself (the rows) must still be present.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const rootRoute = createRootRoute({ component: () => <SidebarGroupsPanel embedded /> });
    const sectionRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings/$section",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([sectionRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    // The editor still renders (rows present)...
    await screen.findByTestId("sidebar-groups-panel");
    expect(screen.getByText("Projects")).toBeTruthy();
    // ...but not its own heading. The panel-title testid is only on the <h1>.
    expect(screen.queryByTestId("settings-panel-title")).toBeNull();
  });
});
