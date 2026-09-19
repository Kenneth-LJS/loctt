// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesPanel } from "./PreferencesPanel.tsx";

/**
 * My preferences (SET-11, PRU-14).
 *
 * The theme test asserts the PUT body, not the rendered picker: SET-11
 * requires the choice reach the acting user's `settings.yaml`, and a
 * picker that highlights correctly while sending nothing would satisfy
 * a render-only assertion.
 */

let PROJECTS: { id: string; name: string; prefix: string }[] = [];
let SETTINGS: Record<string, unknown> = {};
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
          status: 200, headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ user: "u1", settings: SETTINGS }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    }
    if (path.startsWith("/api/projects")) {
      return Promise.resolve(new Response(
        JSON.stringify({ items: PROJECTS, total: PROJECTS.length, offset: 0, limit: 1000 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    }
    return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 1000 }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
  }));
}

/**
 * The panel now renders a TanStack `<Link>` (the CONFIG-5 cross-link to
 * Projects), so a bare render throws in `useLinkProps` — the panel always
 * lives under a router in the app. Mount it inside a memory router at
 * `/settings/preferences` in addition to the QueryClient.
 */
function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <PreferencesPanel />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/settings/preferences"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  PROJECTS = [{ id: "p_backend", name: "Backend", prefix: "BE-" }];
  SETTINGS = {};
  PUTS = [];
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PreferencesPanel", () => {
  // @verifies SET-11
  it("writes the picked theme to the user's settings, not only to this browser", async () => {
    SETTINGS = { default_project: "p_backend" };
    renderPanel();

    (await screen.findByTestId("theme-dark")).click();

    // The durable, per-user record — a localStorage-only write would
    // not survive a user switch or reach another browser.
    await waitFor(() => { expect(PUTS.length).toBe(1); });
    expect(PUTS[0]?.["theme"]).toBe("dark");
    // The whole-document PUT carries the other preferences forward.
    expect(PUTS[0]?.["default_project"]).toBe("p_backend");
  });

  // @verifies SET-11
  it("marks the stored theme as the selected option", async () => {
    SETTINGS = { theme: "dark" };
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId("theme-dark").getAttribute("aria-checked")).toBe("true");
    });
  });

  // @verifies PRU-14
  it("names a default project that no longer exists", async () => {
    // Alice's settings point at a hard-deleted project.
    SETTINGS = { default_project: "archive_me" };
    renderPanel();

    const notice = await screen.findByTestId("default-project-unresolvable");
    // It names the dead value — "your default is invalid" would leave
    // the user with nothing to search for.
    expect(notice.textContent).toContain("archive_me");
    // And says what happens meanwhile, so the fall-through is not a
    // silent mystery.
    expect(notice.textContent).toContain("workspace default");
  });

  // @verifies PRU-14
  it("says nothing when the default project resolves", async () => {
    SETTINGS = { default_project: "p_backend" };
    renderPanel();
    await screen.findByTestId("default-project-select");
    expect(screen.queryByTestId("default-project-unresolvable")).toBeNull();
  });

  // @verifies PRU-14
  it("replaces the dead value in settings when a new default is picked", async () => {
    SETTINGS = { default_project: "archive_me" };
    renderPanel();

    // The default-project picker is now a searchable Combobox (A211), not
    // a native <select>; this once drove it via fireEvent.change on the
    // <select> element — the pre-migration control. Open the trigger and
    // click the option instead.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(await screen.findByTestId("default-project-select"));
    fireEvent.click(await screen.findByTestId("default-project-option-p_backend"));

    await waitFor(() => { expect(PUTS.length).toBe(1); });
    expect(PUTS[0]?.["default_project"]).toBe("p_backend");
  });

  /**
   * @verifies CONFIG-5
   *
   * P4: the personal default here and the workspace default in Projects
   * are two different "default project" concepts. This panel cross-links
   * to the other so they are not mistaken for one.
   */
  it("cross-links the personal default to the workspace default in Projects", async () => {
    renderPanel();
    const link = (await screen.findByTestId("preferences-workspace-default-link"))
      .closest("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("/settings/projects");
  });
});
