// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppBootstrap, useAppContext } from "./AppBootstrap.tsx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const okInfo = {
  exists: true,
  taskCount: 3,
  keyPrefix: "T-",
  nextKey: "T-4",
  schemaStatus: { kind: "current", version: 1 },
};

const outdatedInfo = {
  ...okInfo,
  schemaStatus: { kind: "outdated", on_disk: 1, current: 2 },
};

const futureInfo = {
  ...okInfo,
  schemaStatus: { kind: "future", on_disk: 3, current: 2 },
};

const okUser = {
  id: "u_test",
  name: "Test User",
  email: "test@example.com",
  timezone: "UTC",
  created_at: "2026-01-01T00:00:00Z",
  archived: false,
};

function setupFetch(routes: Record<string, () => Response>): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const path = typeof url === "string" ? url : (url as URL).toString();
    const route = Object.entries(routes).find(([k]) => path.endsWith(k));
    if (!route) throw new Error(`Unhandled mock fetch: ${path}`);
    return Promise.resolve(route[1]());
  });
}

function Probe() {
  const ctx = useAppContext();
  return (
    <div>
      <span data-testid="user">{ctx.currentUser?.name ?? "(none)"}</span>
      <span data-testid="schema">{ctx.schemaStatus.kind}</span>
      <span data-testid="readonly">{ctx.readOnly ? "yes" : "no"}</span>
    </div>
  );
}

function wrap(children: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  // Default to happy path; individual tests override
  setupFetch({
    "/api/info": () => json(okInfo),
    "/api/user/current": () => json(okUser),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppBootstrap", () => {
  it("shows a loading state while the bootstrap queries are in flight", () => {
    let resolveInfo: (r: Response) => void = () => undefined;
    setupFetch({
      "/api/info": () => {
        const p = new Promise<Response>(r => { resolveInfo = r; });
        return (p as unknown as Response);
      },
      "/api/user/current": () => json(okUser),
    });
    render(wrap(<AppBootstrap><Probe /></AppBootstrap>));
    expect(screen.getByText(/loading loctt/i)).toBeTruthy();
    // Resolve so the test doesn't leak the pending fetch
    resolveInfo(json(okInfo));
  });

  it("provides context once both queries resolve", async () => {
    render(wrap(<AppBootstrap><Probe /></AppBootstrap>));
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("Test User"));
    expect(screen.getByTestId("schema").textContent).toBe("current");
    expect(screen.getByTestId("readonly").textContent).toBe("no");
  });

  it("treats a 404 on /api/user/current as 'no user yet', not an error", async () => {
    setupFetch({
      "/api/info": () => json(okInfo),
      "/api/user/current": () => json({ error: "no users registered" }, 404),
    });
    render(wrap(<AppBootstrap><Probe /></AppBootstrap>));
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("(none)"));
    expect(screen.getByTestId("schema").textContent).toBe("current");
  });

  it("shows the error page when /api/info fails", async () => {
    setupFetch({
      "/api/info": () => json({ error: "boom" }, 500),
      "/api/user/current": () => json(okUser),
    });
    render(wrap(<AppBootstrap><Probe /></AppBootstrap>));
    await waitFor(() => expect(screen.getByText(/couldn't reach the loctt api/i)).toBeTruthy());
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("flags read-only when the schema is outdated", async () => {
    setupFetch({
      "/api/info": () => json(outdatedInfo),
      "/api/user/current": () => json(okUser),
    });
    render(wrap(<AppBootstrap><Probe /></AppBootstrap>));
    await waitFor(() => expect(screen.getByTestId("readonly").textContent).toBe("yes"));
    expect(screen.getByTestId("schema").textContent).toBe("outdated");
  });

  it("flags read-only when the schema is from a newer LocTT", async () => {
    setupFetch({
      "/api/info": () => json(futureInfo),
      "/api/user/current": () => json(okUser),
    });
    render(wrap(<AppBootstrap><Probe /></AppBootstrap>));
    await waitFor(() => expect(screen.getByTestId("readonly").textContent).toBe("yes"));
  });
});

describe("useAppContext", () => {
  it("throws if used outside the provider", () => {
    // Render Probe without AppBootstrap. React's error boundary
    // would normally swallow this; capture via console.error to keep
    // the test output clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(wrap(<Probe />))).toThrow(/useAppContext used outside/);
    errSpy.mockRestore();
  });
});
