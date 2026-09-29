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

/** Saved views returned by /api/views, per-test (K158). */
let VIEWS: { id: string; name: string; filters: unknown[]; archived?: boolean }[] = [];

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
      return Promise.resolve(new Response(JSON.stringify({ queries: VIEWS }), {
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
  return render(
    <QueryClientProvider client={client}>
      <SidebarGroupsPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  SETTINGS = {};
  PUTS = [];
  VIEWS = [{ id: "v_bugs", name: "Open bugs", filters: [] }];
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SidebarGroupsPanel", () => {
  it("lists every group, and the built-in and saved views under Views", async () => {
    // @verifies SHL-45, SHL-50. K158: the built-in views and the saved
    // views are one "Views" group (K125 had a "Filters" group of the
    // built-ins only; saved views were not in this panel at all). The
    // switcher is labelled "Layouts (List / Board / Timeline)".
    renderPanel();
    await screen.findByText("Projects");
    screen.getByText("Recently viewed");
    screen.getByText("Views");
    screen.getByText("Layouts (List / Board / Timeline)");
    screen.getByText("Overdue");
    screen.getByText("Open bugs");
    expect(screen.queryByText("Filters")).toBeNull();
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

  it("K158: the built-in and saved views are depth-1 children of one Views row, not top-level rows", async () => {
    // @verifies SHL-50
    renderPanel();
    await screen.findByText("Projects");
    const viewsRow = await screen.findByTestId("sidebar-group-row-views");
    expect(viewsRow.getAttribute("data-depth")).toBe("0");
    expect(screen.queryByTestId("sidebar-group-row-overdue")).toBeNull();
    for (const id of [
      "assigned-to-me", "reported-by-me", "mentions-me",
      "due-this-week", "overdue", "high-priority", "view:v_bugs",
    ]) {
      const row = await screen.findByTestId(`sidebar-view-row-${id}`);
      expect(row.getAttribute("data-depth")).toBe("1");
      expect(viewsRow.contains(row)).toBe(true);
    }
  });

  it("K158 (K125's rule): switching the Views group off disables every child's switch and handle", async () => {
    // @verifies SHL-50
    renderPanel();
    await screen.findByText("Projects");
    fireEvent.click(await screen.findByTestId("sidebar-group-toggle-views"));
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });

    for (const id of ["overdue", "view:v_bugs"]) {
      const childToggle = await screen.findByTestId(`sidebar-view-toggle-${id}`);
      await waitFor(() => { expect((childToggle as HTMLInputElement).disabled).toBe(true); });
      const childHandle = await screen.findByTestId(`sidebar-view-handle-${id}`);
      expect((childHandle as HTMLButtonElement).disabled).toBe(true);
      // Still visible, just inactive (K125).
      expect(getComputedStyle(childToggle).display).not.toBe("none");
    }
  });

  it("K158: a child's own switch and handle are enabled while the group is on", async () => {
    renderPanel();
    await screen.findByText("Projects");
    const childToggle = await screen.findByTestId("sidebar-view-toggle-view:v_bugs");
    expect((childToggle as HTMLInputElement).disabled).toBe(false);
    const childHandle = await screen.findByTestId("sidebar-view-handle-view:v_bugs");
    expect((childHandle as HTMLButtonElement).disabled).toBe(false);
  });

  it("K158: unhiding a saved view (hidden from the sidebar's ⋯) persists only that child", async () => {
    // @verifies SHL-52 — Customize sidebar is where a hidden view comes back.
    SETTINGS = { sidebar_groups: { version: 2, hidden: ["view:v_bugs"] } };
    renderPanel();
    const toggle = await screen.findByTestId("sidebar-view-toggle-view:v_bugs");
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });
    const groups = PUTS[PUTS.length - 1]?.["sidebar_groups"] as { version?: number; hidden?: string[]; order?: string[] };
    expect(groups.version).toBe(2);
    expect(groups.hidden ?? []).toEqual([]);
    // The full layout is written, the saved view among the Views children.
    expect(groups.order).toContain("view:v_bugs");
  });

  it("K158: reordering a child by keyboard writes it among the other Views children", async () => {
    // @verifies SHL-50
    renderPanel();
    const handle = await screen.findByTestId("sidebar-view-handle-view:v_bugs");
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("sidebar-view-handle-view:v_bugs"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("sidebar-view-handle-view:v_bugs"), { key: "Enter" });
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });
    const order = (PUTS[PUTS.length - 1]?.["sidebar_groups"] as { order: string[] }).order;
    const at = order.indexOf("views");
    expect(order.slice(at + 1, at + 8)).toEqual([
      "assigned-to-me", "reported-by-me", "mentions-me", "due-this-week", "view:v_bugs", "overdue", "high-priority",
    ]);
  });

  it("K125: no row uses strikethrough for hidden — the switch alone carries the state", async () => {
    renderPanel();
    await screen.findByText("Projects");
    fireEvent.click(await screen.findByTestId("sidebar-group-toggle-labels"));
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });
    const row = await screen.findByTestId("sidebar-group-row-labels");
    expect(row.innerHTML).not.toMatch(/line-through/);
  });

  it("K158 MIGRATION: a pre-K158 value shows migrated, and the first change writes the K158 shape", async () => {
    // @verifies SHL-54 — the K125-era value had Filters leading (with
    // "overdue" first inside it) and the Saved views group hidden.
    SETTINGS = { sidebar_groups: { order: ["filters", "overdue", "projects"], hidden: ["saved-filters", "views"] } };
    renderPanel();
    await screen.findByText("Projects");
    const rows = await screen.findAllByTestId(/^sidebar-group-row-/);
    expect(rows[0]?.getAttribute("data-testid")).toBe("sidebar-group-row-views");
    const children = await screen.findAllByTestId(/^sidebar-view-row-/);
    expect(children[0]?.getAttribute("data-testid")).toBe("sidebar-view-row-overdue");
    // The old switcher id `views` is `layouts` now, still hidden.
    expect(screen.getByTestId<HTMLInputElement>("sidebar-group-toggle-layouts").checked).toBe(false);
    // The hidden Saved views group hid each saved view.
    expect(screen.getByTestId<HTMLInputElement>("sidebar-view-toggle-view:v_bugs").checked).toBe(false);

    fireEvent.click(screen.getByTestId("sidebar-group-toggle-labels"));
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });
    const groups = PUTS[PUTS.length - 1]?.["sidebar_groups"] as { version?: number; hidden?: string[]; order?: string[] };
    expect(groups.version).toBe(2);
    expect(groups.hidden?.sort()).toEqual(["labels", "layouts", "view:v_bugs"]);
    expect(groups.order).not.toContain("filters");
    expect(groups.order).not.toContain("saved-filters");
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
