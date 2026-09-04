// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSwitchUser } from "./useSwitchUser.ts";
import { useUserSettings } from "./useWorkflow.ts";

/**
 * PRU-9: per-user settings switch with the user.
 *
 * The three surfaces the case names — theme, `list_columns`,
 * `card_layout` — all read `settings.yaml` through the single
 * `["user-settings"]` query. Each of them already applies a change
 * correctly once it arrives; `adoptStoredTheme` exists specifically to
 * overwrite this browser's cached theme with the incoming user's. So
 * the only thing that can break all three at once is the switch
 * failing to invalidate that key, which is exactly what it did.
 *
 * The assertion is therefore on the far end a user would see: after
 * switching, what does the settings query hold? Asserting that
 * `invalidateQueries` was called with the key would pass against a
 * hook that invalidated a *misspelled* key, since nothing would then
 * check that a refetch actually reached the consumers.
 *
 * The server is stubbed so `/api/user-settings` answers as whichever
 * user is currently active — that is the behaviour of the real
 * endpoint, which reads `.current-user` per request, and without it a
 * refetch would return Alice's settings either way and the test could
 * not fail.
 */

/** Who `POST /api/user/switch` has most recently made active. */
let currentUser = "u_alice";

const SETTINGS: Record<string, { theme: string; list_columns: string[] }> = {
  u_alice: { theme: "dark", list_columns: ["key", "title"] },
  u_bob: { theme: "light", list_columns: ["key", "title", "status", "assignee"] },
};

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");

      if (path.startsWith("/api/user/switch")) {
        const body = typeof init?.body === "string" ? init.body : "{}";
        currentUser = (JSON.parse(body) as { ref: string }).ref;
        return json({ current: currentUser });
      }
      if (path.startsWith("/api/user-settings")) {
        // Per-request, per-user — as the real endpoint is.
        return json({ user: currentUser, settings: SETTINGS[currentUser] });
      }
      return json({});
    },
  );
}

function json(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/**
 * `UserSettings` is deliberately schema-less beyond `default_project`,
 * so `list_columns` arrives as `unknown` and has to be narrowed the
 * way a real consumer does (`list/columns.ts` does the same).
 */
function columnsOf(settings: unknown): string {
  if (settings === null || typeof settings !== "object") return "";
  const raw = (settings as { list_columns?: unknown }).list_columns;
  return Array.isArray(raw) ? raw.filter(c => typeof c === "string").join(",") : "";
}

/** Renders the settings a consumer would act on, plus a switch trigger. */
function Harness() {
  const settings = useUserSettings();
  const switchUser = useSwitchUser();
  return (
    <div>
      <span data-testid="theme">{settings.data?.settings.theme ?? "…"}</span>
      <span data-testid="columns">{columnsOf(settings.data?.settings)}</span>
      <button type="button" onClick={() => switchUser.mutate("u_bob")}>
        switch
      </button>
    </div>
  );
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useSwitchUser", () => {
  beforeEach(() => {
    currentUser = "u_alice";
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // @verifies PRU-9
  it("PRU-9: switching users refetches the acting user's settings", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const Wrapper = wrapper(client);
    render(<Harness />, { wrapper: Wrapper });

    // Alice's own settings land first — the positive control. Without
    // this the "Bob" assertion could pass on a query that never
    // resolved at all.
    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("dark");
    });
    expect(screen.getByTestId("columns").textContent).toBe("key,title");

    act(() => {
      screen.getByRole("button", { name: "switch" }).click();
    });

    // The far end: Bob's theme and Bob's column set, reached without a
    // reload. Neither value is Alice's, so a stale cache fails both.
    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("light");
    });
    expect(screen.getByTestId("columns").textContent).toBe("key,title,status,assignee");
  });
});
