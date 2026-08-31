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
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, settingsRoute]),
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

    const trigger = screen.getByLabelText("User menu — signed-in user unknown");
    // Not blank, and not initials derived from nothing.
    expect(trigger.textContent).toBe("?");
    expect(trigger.getAttribute("title")).toMatch(/could not be determined/i);
    // No fabricated identity anywhere in the chrome.
    expect(screen.queryByText("Ken Loh")).toBeNull();
  });

  it("still opens the menu, explains the block, and keeps Settings reachable", async () => {
    UNKNOWN = true;
    await renderHeader();

    await click(screen.getByLabelText("User menu — signed-in user unknown"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/signed-in user unknown/i);
    // The consequence is named, not left for the user to discover on
    // the next write.
    expect(alert.textContent).toMatch(/blocked/i);

    const settings = screen.getByText("Settings").closest("a") as HTMLAnchorElement;
    expect(settings.getAttribute("href")).toContain("/settings/");
  });
});
