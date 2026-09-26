// @vitest-environment jsdom
import type { UserProfile } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { Header } from "./Header.tsx";

/**
 * Header tests: the avatar menu's three affordances (SHL-3) and the
 * theme control (SHL-14).
 *
 * The theme assertions are about the *control*, not the hook — the hook
 * has always supported "system"; the header offered no way to reach it
 * and reported an active system preference as an explicit Light.
 */

const KEN: UserProfile = {
  id: "u_ken",
  name: "Ken Loh",
  email: "ken@example.com",
  timezone: "UTC",
};

const USERS = {
  items: [
    KEN,
    { id: "u_sam", name: "Sam Patel", timezone: "UTC" },
    { id: "u_old", name: "Retired Rita", timezone: "UTC", archived: true },
  ],
  total: 3,
  offset: 0,
  limit: 100,
  current: "u_ken",
};

const switchCalls: string[] = [];

/** Renders the header in its unknown-identity state (SHL-40). */
let UNKNOWN = false;

/** Search hits returned by /api/search, per-test (SHL-46). */
let SEARCH_HITS: { key: string; title: string }[] = [];

/** Every /api/search request path, in order (SHL-46). */
const SEARCH_CALLS: string[] = [];

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path.startsWith("/api/user/switch")) {
        switchCalls.push(typeof init?.body === "string" ? init.body : "");
        return Promise.resolve(
          new Response(JSON.stringify({ current: "u_sam" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (path.startsWith("/api/search")) {
        SEARCH_CALLS.push(path);
        return Promise.resolve(
          new Response(JSON.stringify({ items: SEARCH_HITS, total: SEARCH_HITS.length, offset: 0, limit: 8 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      const body = path.startsWith("/api/users") ? USERS : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );
}

/** jsdom has no matchMedia; the theme hook reads it on mount. */
function installMatchMedia(dark: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }) as unknown as typeof window.matchMedia;
}

async function renderHeader() {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    // The provider is required because the header's "+ New task"
    // button opens the shared create modal (M3.4, NEW-1) — one modal
    // for all three entry points, so the button reaches it through
    // context rather than owning its own copy.
    component: () => (
      <CreateTaskProvider>
        {UNKNOWN
          ? <Header currentUser={null} identityUnknown onToggleSidebar={() => undefined} />
          : <Header currentUser={KEN} onToggleSidebar={() => undefined} />}
      </CreateTaskProvider>
    ),
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <div>settings pane</div>,
  });
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$key",
    component: () => <div>task detail</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, settingsRoute, taskRoute]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText(/^User menu/);
  return router;
}


/** Click and let effects/queries settle. */
async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(el);
    // Let the click's queries/mutations settle before asserting.
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  switchCalls.length = 0;
  UNKNOWN = false;
  SEARCH_HITS = [];
  SEARCH_CALLS.length = 0;
  installMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Header avatar menu", () => {
  /**
   * @verifies SHL-3
   *
   * The menu must offer Switch user, Settings and a theme control, list
   * only non-archived users, and mark who is current. A menu that lists
   * everyone including the archived and does not say who you are makes
   * "switch" a guess.
   */
  it("offers switch-user, settings and theme, marks the current user, and hides archived users", async () => {
    await renderHeader();

    await click(screen.getByLabelText("User menu"));

    const menu = await screen.findByText("Switch user");
    const panel = menu.closest("div")?.parentElement?.parentElement as HTMLElement;

    // The current user is identified in the menu, not merely absent
    // from the switch list.
    expect(within(panel).getByText("Ken Loh")).toBeTruthy();
    expect(within(panel).getByText("ken@example.com")).toBeTruthy();

    // Switchable users: the other live user only.
    expect(within(panel).getByText("Sam Patel")).toBeTruthy();
    expect(within(panel).queryByText("Retired Rita")).toBeNull();
    // The current user is not offered as a switch target.
    const switchGroup = menu.parentElement as HTMLElement;
    expect(within(switchGroup).queryByRole("button", { name: /Ken Loh/ })).toBeNull();

    expect(within(panel).getByText("Settings")).toBeTruthy();
    // The theme control is reachable from the header chrome.
    expect(screen.getByLabelText("Theme")).toBeTruthy();
  });

  /**
   * @verifies SHL-48
   *
   * P4/config-discoverability: the menu's one generic "Settings" link
   * taught nothing about *where* a user's own settings live. The menu now
   * offers differentiated deep links — My profile (to the current user's
   * row), My preferences, Customize sidebar — each pointing at the exact
   * section that owns the concept, alongside the kept catch-all Settings.
   */
  it("deep-links the user-menu items to the sections that own them", async () => {
    await renderHeader();
    await click(screen.getByLabelText("User menu"));

    const profile = (await screen.findByTestId("user-menu-profile")).closest("a") as HTMLAnchorElement;
    // My profile → the Users section, anchored at the current user's row
    // (the `#row-<id>` anchor UsersPanel exposes).
    expect(profile.getAttribute("href")).toBe("/settings/users#row-u_ken");

    const prefs = screen.getByTestId("user-menu-preferences").closest("a") as HTMLAnchorElement;
    expect(prefs.getAttribute("href")).toContain("/settings/preferences");

    const sidebar = screen.getByTestId("user-menu-sidebar").closest("a") as HTMLAnchorElement;
    expect(sidebar.getAttribute("href")).toContain("/settings/sidebar-groups");

    // The catch-all Settings link is kept.
    const settings = screen.getByTestId("user-menu-settings").closest("a") as HTMLAnchorElement;
    expect(settings.getAttribute("href")).toContain("/settings/");
  });

  /**
   * @verifies SHL-48
   *
   * "My profile" anchors at the *current* user's row, so an unknown
   * identity (SHL-40) has no row to point at — the item is omitted rather
   * than deep-linking to `#row-` with no id.
   */
  it("omits My profile when the signed-in user is unknown", async () => {
    UNKNOWN = true;
    await renderHeader();
    await click(screen.getByLabelText(/^User menu/));
    expect(screen.queryByTestId("user-menu-profile")).toBeNull();
    // Preferences and Customize sidebar do not depend on the identity and
    // stay reachable.
    expect(screen.getByTestId("user-menu-preferences")).toBeTruthy();
    expect(screen.getByTestId("user-menu-sidebar")).toBeTruthy();
  });

  /**
   * @verifies SHL-3
   *
   * Selecting a different user has to actually attribute subsequent
   * writes to them — which means the switch reaches the server, not
   * just the local avatar.
   */
  it("posts the chosen user to /api/user/switch and closes the menu", async () => {
    await renderHeader();

    await click(screen.getByLabelText("User menu"));
    await click(await screen.findByText("Sam Patel"));

    expect(switchCalls.length).toBe(1);
    expect(switchCalls[0]).toContain("u_sam");
    expect(screen.queryByText("Switch user")).toBeNull();
  });
});

describe("Header theme control", () => {
  /**
   * @verifies SHL-14
   *
   * "System" must be reachable. Before this the header rendered two
   * buttons and pressed them from the *resolved* value, so a user on
   * `system` with a light OS was shown "Light" as their choice and had
   * no control that would put them back.
   */
  it("offers light, dark and system, and reflects the stored preference", async () => {
    await renderHeader();

    const theme = screen.getByLabelText("Theme");
    for (const label of ["Light", "Dark", "System"]) {
      expect(within(theme).getByRole("button", { name: label })).toBeTruthy();
    }

    // Default preference is system, even though it resolves to light.
    expect(
      within(theme).getByRole("button", { name: "System" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(theme).getByRole("button", { name: "Light" }).getAttribute("aria-pressed"),
    ).toBe("false");

    await click(within(theme).getByRole("button", { name: "Dark" }));
    expect(window.localStorage.getItem("tt-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // And back to system — the control that did not exist.
    await click(within(theme).getByRole("button", { name: "System" }));
    expect(window.localStorage.getItem("tt-theme")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

/**
 * @verifies SHL-40
 *
 * A failed current-user read used to blank the entire app. Not knowing
 * *who* you are does not stop you reading tasks or reaching Settings —
 * which is where the user list is fixed — so a full-page error both
 * overstated the failure and removed the route to its own fix.
 */
describe("Header with an unknown identity (SHL-40)", () => {
  it("marks the avatar explicitly rather than showing a blank or a guessed name", async () => {
    UNKNOWN = true;
    await renderHeader();

    const trigger = screen.getByLabelText("User menu, signed-in user unknown");
    // Not blank, and not initials derived from nothing.
    expect(trigger.textContent).toBe("?");
    expect(trigger.getAttribute("title")).toMatch(/could not be determined/i);
    // No fabricated identity anywhere in the chrome.
    expect(screen.queryByText("Ken Loh")).toBeNull();
  });

  it("still opens the menu, explains the block, and keeps Settings reachable", async () => {
    UNKNOWN = true;
    await renderHeader();

    await click(screen.getByLabelText("User menu, signed-in user unknown"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/signed-in user unknown/i);
    // The consequence is named, not left for the user to discover on
    // the next write.
    expect(alert.textContent).toMatch(/blocked/i);

    const settings = screen.getByText("Settings").closest("a") as HTMLAnchorElement;
    expect(settings.getAttribute("href")).toContain("/settings/");
  });
});

describe("Header search (SHL-46)", () => {
  it("fires a real /api/search request as the user types", async () => {
    // @verifies SHL-46
    SEARCH_HITS = [{ key: "WEB-3", title: "Fix login" }];
    await renderHeader();
    const box = screen.getByTestId("header-search");
    await act(async () => {
      fireEvent.change(box, { target: { value: "login" } });
      await Promise.resolve();
    });
    // Debounced — wait for the request to fire.
    await vi.waitFor(() => {
      expect(SEARCH_CALLS.some(p => p.includes("q=login"))).toBe(true);
    });
    // And the matching task shows in the dropdown.
    await screen.findByTestId("header-search-hit-WEB-3");
  });

  it("navigates to a task when a result is clicked", async () => {
    // @verifies SHL-46
    SEARCH_HITS = [{ key: "WEB-3", title: "Fix login" }];
    const router = await renderHeader();
    const box = screen.getByTestId("header-search");
    await act(async () => {
      fireEvent.change(box, { target: { value: "login" } });
      await Promise.resolve();
    });
    const hit = await screen.findByTestId("header-search-hit-WEB-3");
    await act(async () => { fireEvent.click(hit); await Promise.resolve(); });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe("/tasks/WEB-3");
    });
  });

  it("navigates to the list with a valid DSL text-search clause on Enter", async () => {
    // @verifies SHL-46 — Enter must produce a query the list can PARSE.
    // A plain word sent as `q: "bug"` is fed to the query DSL as `(bug)`
    // and fails to parse ("Could not load tasks"); the header must wrap
    // it in the same `text ~ "<q>"` clause /api/search builds.
    const router = await renderHeader();
    const box = screen.getByTestId("header-search");
    await act(async () => {
      fireEvent.change(box, { target: { value: "bug" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe("/list");
      expect(router.state.location.search).toMatchObject({ q: 'text ~ "bug"' });
    });
  });

  it("quotes/escapes a word so a plain search never injects DSL structure", async () => {
    // @verifies SHL-46 — `(bug)` used to become `((bug))` → ParseError.
    const router = await renderHeader();
    const box = screen.getByTestId("header-search");
    await act(async () => {
      fireEvent.change(box, { target: { value: "(bug)" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(router.state.location.search).toMatchObject({ q: 'text ~ "(bug)"' });
    });
  });

  // The `/` → focus-search binding is owned by the shell's global
  // shortcut registry (AppShell → useGlobalShortcuts → the `focus-search`
  // shortcut, which finds this input by `type="search"`), and is covered
  // there (useShortcuts.test.tsx, shortcuts.test.ts). Header no longer
  // adds its own `/` document listener — that was a duplicate binding
  // that bypassed the registry's dialog guard (B2 fix-review, bug 2) —
  // so there is deliberately no Header-isolation test for `/` here.
});
