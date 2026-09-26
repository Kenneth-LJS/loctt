import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

/**
 * A stubbed `/api/user-settings` for the shortcut-settings tests: GET
 * returns `store.settings`, PUT replaces it and is recorded, so a test
 * asserts the request the client actually sent (the far end), not what
 * the component rendered.
 */
export interface SettingsStore {
  settings: Record<string, unknown>;
  puts: Record<string, unknown>[];
  failPut: boolean;
  /**
   * The PUT never answers; it rejects only when its signal aborts, as a
   * real `fetch` does, so the client's write deadline can fire (K134's
   * unknown outcome).
   */
  hangPut: boolean;
}

export function stubSettingsApi(initial: Record<string, unknown> = {}): SettingsStore {
  const store: SettingsStore = { settings: initial, puts: [], failPut: false, hangPut: false };
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn((input: unknown, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : String(input);
    const path = raw.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/user-settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as Record<string, unknown>;
        store.puts.push(body);
        if (store.failPut) return Promise.resolve(json({ error: "boom" }, 500));
        if (store.hangPut) {
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            }, { once: true });
          });
        }
        store.settings = body;
        return Promise.resolve(json({ user: "u1", settings: body }));
      }
      return Promise.resolve(json({ user: "u1", settings: store.settings }));
    }
    return Promise.resolve(json({}));
  }));
  return store;
}

/** Renders `ui` inside a query client and a memory router at `/settings/keyboard`. */
export function renderWithProviders(ui: () => ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <>{ui()}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/settings/keyboard"] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}
