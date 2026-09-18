// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
});
