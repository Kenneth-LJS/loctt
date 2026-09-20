// @vitest-environment jsdom
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

import { SidebarPinsPanel } from "./SidebarPinsPanel.tsx";

/**
 * The pins panel's stale sweep (SET-13, SET-27).
 *
 * The assertion that matters is the *request*: SET-27 wants
 * `settings.yaml` rewritten to drop dead references, so the test reads
 * what the client actually PUT rather than what the panel renders. A
 * server that repaired the value would otherwise let a wrong request
 * pass as a correct file.
 */

/** Views returned by /api/views, per-test. */
let VIEWS: { id: string; name: string; query: string }[] = [];

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
    if (path.startsWith("/api/views")) {
      return Promise.resolve(new Response(
        JSON.stringify({ queries: VIEWS, items: VIEWS, total: VIEWS.length, offset: 0, limit: 1000 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 1000 }), {
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
  const rootRoute = createRootRoute({ component: SidebarPinsPanel });
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
  VIEWS = [];
  SETTINGS = {};
  PUTS = [];
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SidebarPinsPanel", () => {
  // @verifies SET-13
  it("lists pinned views in the stored pin order, not view order", () => {
    VIEWS = [
      { id: "v_a", name: "Alpha", query: "status:open" },
      { id: "v_b", name: "Beta", query: "status:open" },
      { id: "v_c", name: "Gamma", query: "status:open" },
    ];
    SETTINGS = { sidebar_pins: ["v_c", "v_a"] };
    renderPanel();

    return waitFor(() => {
      const rows = document.querySelectorAll('[data-testid^="pin-row-"]');
      expect([...rows].map(r => r.getAttribute("data-testid")))
        .toEqual(["pin-row-v_c", "pin-row-v_a"]);
    });
  });

  // @verifies SET-27
  // @verifies SET-13
  it("names the pins it swept and rewrites settings.yaml without them", async () => {
    // Every pinned view has been deleted from queries.yaml while the
    // panel was open — SET-27's exact scenario.
    VIEWS = [];
    SETTINGS = { sidebar_pins: ["v_gone", "v_also_gone"], theme: "dark" };
    renderPanel();

    // It SAYS what went, rather than silently emptying.
    const notice = await screen.findByTestId("pins-swept-notice");
    expect(notice.textContent).toContain("no longer exist");
    expect(document.querySelector('[data-swept-pin="v_gone"]')).not.toBeNull();
    expect(document.querySelector('[data-swept-pin="v_also_gone"]')).not.toBeNull();

    // And the write actually went out with the dead ids removed, so the
    // sweep does not have to re-run every load. Asserting the request,
    // not the render: the panel could show the right thing while
    // sending the wrong body.
    await waitFor(() => { expect(PUTS.length).toBe(1); });
    expect(PUTS[0]?.["sidebar_pins"]).toEqual([]);
    // Unrelated preferences survive the rewrite — a whole-document PUT
    // that forgot them would silently reset the user's theme.
    expect(PUTS[0]?.["theme"]).toBe("dark");
  });

  // @verifies SET-13
  it("does not sweep a pin whose view exists but matches no tasks", async () => {
    // The view is present in queries.yaml; nothing here reports task
    // counts at all. A sweep keyed on results would drop this pin.
    VIEWS = [{ id: "v_empty", name: "Empty view", query: "status:nope" }];
    SETTINGS = { sidebar_pins: ["v_empty"] };
    renderPanel();

    await screen.findByTestId("pin-row-v_empty");
    expect(screen.queryByTestId("pins-swept-notice")).toBeNull();
    // No rewrite is owed when nothing was stale.
    expect(PUTS.length).toBe(0);
  });

  it("shows the server message and a Retry when the pins save fails", async () => {
    // The ErrorState standard: server reason + Retry, not a bare "not
    // saved" line. The stale sweep fires a settings write; fail it.
    // Red-proven — the pre-fix panel had neither testid nor a Retry.
    const { fireEvent, within } = await import("@testing-library/react");
    VIEWS = [];
    SETTINGS = { sidebar_pins: ["v_gone"] };
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
      if (path.startsWith("/api/views")) {
        return Promise.resolve(new Response(
          JSON.stringify({ queries: VIEWS, items: VIEWS, total: 0, offset: 0, limit: 1000 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 1000 }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    }));
    renderPanel();

    const host = await screen.findByTestId("sidebar-pins-save-error");
    expect(host.textContent).toContain("read-only");
    expect(within(host).getByRole("button", { name: "Retry" })).toBeTruthy();
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(within(host).getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before);
    });
  });

  // @verifies VUE-38
  it("warns that the sidebar pin will be dropped before deleting a pinned view", async () => {
    VIEWS = [{ id: "v_a", name: "Alpha", query: "status:open" }];
    SETTINGS = { sidebar_pins: ["v_a"] };
    renderPanel();

    const del = await screen.findByTestId("view-delete-v_a");
    del.click();

    const dialog = await screen.findByTestId("delete-view-dialog");
    // It names the view...
    expect(dialog.textContent).toContain("Alpha");
    // ...and states the pin consequence.
    expect(screen.getByTestId("delete-view-pin-warning").textContent)
      .toContain("pin will be dropped");
  });

  // @verifies VUE-38
  it("does not claim a pin will be dropped for a view that is not pinned", async () => {
    // The warning is gated on the view actually being pinned. Saying it
    // regardless trains the user to stop reading the dialog.
    VIEWS = [{ id: "v_a", name: "Alpha", query: "status:open" }];
    SETTINGS = { sidebar_pins: [] };
    renderPanel();

    (await screen.findByTestId("view-delete-v_a")).click();
    await screen.findByTestId("delete-view-dialog");
    expect(screen.queryByTestId("delete-view-pin-warning")).toBeNull();
  });
});

/**
 * Task 1 (A244): the two sidebar-config sections were a confusable pair.
 * The panel is retitled "Pinned views" and cross-links to the sibling
 * "Sidebar groups" section.
 */
describe("SidebarPinsPanel clarity (A244)", () => {
  it("titles the panel 'Pinned views', not 'Sidebar pins'", async () => {
    // @verifies A244 — the relabel. Red-proof: the old title must be gone,
    // so reverting the <h1> back to "Sidebar pins" fails this.
    renderPanel();
    expect(await screen.findByRole("heading", { name: "Pinned views" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sidebar pins" })).toBeNull();
  });

  it("cross-links to the Sidebar groups section", async () => {
    // @verifies A244 — the cross-link. Red-proof: deleting the <Link>, or
    // pointing it at the wrong section, fails the href assertion.
    renderPanel();
    const link = await screen.findByTestId("sidebar-pins-see-groups");
    expect(link.textContent).toMatch(/Sidebar groups/);
    expect(link.getAttribute("href")).toContain("/settings/sidebar-groups");
  });
});
