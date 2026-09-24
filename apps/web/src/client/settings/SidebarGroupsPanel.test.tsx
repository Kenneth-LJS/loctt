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
  return render(
    <QueryClientProvider client={client}>
      <SidebarGroupsPanel />
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
    // @verifies SHL-45. Amended (K125, Ken 2026-09-24): the built-in
    // filters nest under one "Filters" group row, so their own labels
    // dropped the "Filter · " prefix (the nesting itself now says what
    // they are) — was "Filter · Overdue".
    renderPanel();
    await screen.findByText("Projects");
    screen.getByText("Recently viewed");
    screen.getByText("Filters");
    screen.getByText("Overdue");
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

  it("K125: the built-in filters render nested under one 'Filters' row, not six top-level rows", async () => {
    renderPanel();
    await screen.findByText("Projects");
    // The group itself is one top-level reorderable row…
    expect(await screen.findByTestId("sidebar-group-row-filters")).toBeTruthy();
    // …its own row is NOT the same testid space as its children.
    expect(screen.queryByTestId("sidebar-group-row-overdue")).toBeNull();
    // Every built-in still renders, as a nested (filter-prefixed testid) row.
    for (const id of [
      "assigned-to-me", "reported-by-me", "mentions-me",
      "due-this-week", "overdue", "high-priority",
    ]) {
      expect(await screen.findByTestId(`sidebar-filter-row-${id}`)).toBeTruthy();
    }
  });

  it("K125: switching the 'Filters' group off disables every child's switch and drag handle", async () => {
    renderPanel();
    await screen.findByText("Projects");
    const groupToggle = await screen.findByTestId("sidebar-group-toggle-filters");
    fireEvent.click(groupToggle);
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });

    const childToggle = await screen.findByTestId("sidebar-filter-toggle-overdue");
    expect((childToggle as HTMLInputElement).disabled).toBe(true);
    const childHandle = await screen.findByTestId("sidebar-filter-handle-overdue");
    expect((childHandle as HTMLButtonElement).disabled).toBe(true);
    // Still VISIBLE, just inactive — Ken: "disable switching/reordering
    // its child items too", not hide them.
    expect(childToggle.hidden).toBe(false);
    expect(getComputedStyle(childToggle).display).not.toBe("none");
  });

  it("K125: a child filter's own switch stays enabled while the group is on", async () => {
    renderPanel();
    await screen.findByText("Projects");
    const childToggle = await screen.findByTestId("sidebar-filter-toggle-overdue");
    expect((childToggle as HTMLInputElement).disabled).toBe(false);
    const childHandle = await screen.findByTestId("sidebar-filter-handle-overdue");
    expect((childHandle as HTMLButtonElement).disabled).toBe(false);
  });

  it("K125: hiding one child filter persists only that child, not the group", async () => {
    renderPanel();
    await screen.findByText("Projects");
    fireEvent.click(await screen.findByTestId("sidebar-filter-toggle-overdue"));
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });
    const last = PUTS[PUTS.length - 1];
    const groups = last?.["sidebar_groups"] as { hidden?: string[]; order?: string[] };
    expect(groups.hidden).toContain("overdue");
    expect(groups.hidden ?? []).not.toContain("filters");
  });

  it("K125: no row uses strikethrough for hidden — the switch alone carries the state", async () => {
    renderPanel();
    await screen.findByText("Projects");
    fireEvent.click(await screen.findByTestId("sidebar-group-toggle-labels"));
    await waitFor(() => { expect(PUTS.length).toBeGreaterThan(0); });
    const row = await screen.findByTestId("sidebar-group-row-labels");
    expect(row.innerHTML).not.toMatch(/line-through/);
  });

  it("MIGRATION (A339): an existing flat stored order with an individual filter placement still loads, group placed at its position", async () => {
    // Pre-K125 stored shape: the user had moved "overdue" to lead the
    // top-level order (the only kind of move that existed then).
    SETTINGS = { sidebar_groups: { order: ["overdue", "projects", "labels"] } };
    renderPanel();
    await screen.findByText("Projects");
    const rows = await screen.findAllByTestId(/^sidebar-group-row-/);
    // "filters" (the migrated group) leads, where "overdue" used to be.
    expect(rows[0]?.getAttribute("data-testid")).toBe("sidebar-group-row-filters");
    // "overdue" itself no longer occupies a top-level slot.
    expect(screen.queryByTestId("sidebar-group-row-overdue")).toBeNull();
    // It is still there, nested, leading the group's own inner order.
    const filterRows = await screen.findAllByTestId(/^sidebar-filter-row-/);
    expect(filterRows[0]?.getAttribute("data-testid")).toBe("sidebar-filter-row-overdue");
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
