// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppBootstrap } from "../context/AppBootstrap.tsx";
import { SchemaBanner } from "./SchemaBanner.tsx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const okUser = {
  id: "u_test",
  name: "Test User",
  email: "test@example.com",
  timezone: "UTC",
  created_at: "2026-01-01T00:00:00Z",
  archived: false,
};

interface FetchHandlers {
  info: () => Response;
  user?: () => Response;
  migrate?: () => Response;
}

function setupFetch(h: FetchHandlers): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const path = typeof url === "string" ? url : (url as URL).toString();
    if (path.endsWith("/api/info")) return Promise.resolve(h.info());
    if (path.endsWith("/api/user/current")) {
      return Promise.resolve((h.user ?? (() => json(okUser)))());
    }
    if (path.endsWith("/api/migrate")) {
      // Spec the body shape so the test asserts call shape too
      expect(init?.method).toBe("POST");
      return Promise.resolve((h.migrate ?? (() => json({ from: 1, to: 2, steps: [{ from: 1, to: 2 }] })))());
    }
    throw new Error(`unhandled mock fetch: ${path}`);
  });
}

function wrap(children: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  }});
  return (
    <QueryClientProvider client={qc}>
      <AppBootstrap>{children}</AppBootstrap>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  setupFetch({
    info: () => json({
      exists: true,
      taskCount: 0,
      keyPrefix: null,
      nextKey: null,
      schemaStatus: { kind: "current", version: 1 },
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SchemaBanner", () => {
  it("renders nothing for a current schema", async () => {
    const { container } = render(wrap(<SchemaBanner />));
    await waitFor(() => expect(container.textContent).not.toMatch(/schema/i));
  });

  it("renders nothing for a missing schema", async () => {
    setupFetch({
      info: () => json({
        exists: false,
        taskCount: 0,
        keyPrefix: null,
        nextKey: null,
        schemaStatus: { kind: "missing" },
      }),
    });
    const { container } = render(wrap(<SchemaBanner />));
    // wait for bootstrap to finish (else we'd be asserting on the
    // loading state)
    await waitFor(() => expect(container.textContent).not.toMatch(/loading loctt/i));
    expect(container.textContent).not.toMatch(/schema/i);
  });

  it("renders the outdated banner with a working Migrate button", async () => {
    setupFetch({
      info: () => json({
        exists: true,
        taskCount: 0,
        keyPrefix: "T-",
        nextKey: "T-1",
        schemaStatus: { kind: "outdated", on_disk: 1, current: 2 },
      }),
    });
    render(wrap(<SchemaBanner />));
    await waitFor(() => expect(screen.getByText(/schema migration available/i)).toBeTruthy());
    expect(screen.getByText(/on v1.*supports v2/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /migrate now/i });
    act(() => { fireEvent.click(btn); });
    await waitFor(() => {
      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const migrateCall = calls.find(c => {
        const url = c[0];
        const str = typeof url === "string" ? url : url instanceof URL ? url.toString() : "";
        return str.endsWith("/api/migrate");
      });
      expect(migrateCall).toBeDefined();
    });
  });

  it("shows future-version banner without a Migrate button", async () => {
    setupFetch({
      info: () => json({
        exists: true,
        taskCount: 0,
        keyPrefix: "T-",
        nextKey: "T-1",
        schemaStatus: { kind: "future", on_disk: 3, current: 2 },
      }),
    });
    render(wrap(<SchemaBanner />));
    await waitFor(() => expect(screen.getByText(/loctt is out of date/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /migrate now/i })).toBeNull();
  });

  it("surfaces a migrate failure inline", async () => {
    setupFetch({
      info: () => json({
        exists: true,
        taskCount: 0,
        keyPrefix: "T-",
        nextKey: "T-1",
        schemaStatus: { kind: "outdated", on_disk: 1, current: 2 },
      }),
      migrate: () => json({ error: "backup failed" }, 500),
    });
    render(wrap(<SchemaBanner />));
    const btn = await screen.findByRole("button", { name: /migrate now/i });
    act(() => { fireEvent.click(btn); });
    await waitFor(() => expect(screen.getByText(/migration failed: backup failed/i)).toBeTruthy());
  });
});
