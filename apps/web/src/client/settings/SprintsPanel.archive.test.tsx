// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SprintsPanel } from "./SprintsPanel.tsx";

/**
 * @verifies A328 (B6)
 *
 * Before this, the archive/unarchive toggle never read `archive.error` —
 * a failure (including a K115 timeout, `data_state: "unknown"`) did
 * nothing visible on the row. This turns on the per-row notice A328
 * specifies, named for the sprint, with a working Try again.
 *
 * Red-proof: remove the `archive.isError && <InlineFailureNotice …>`
 * block from `SprintsPanel.tsx`'s `SprintRow` and both tests below go
 * red — no `sprint-archive-error` node is ever found.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(envelope: Record<string, unknown>, status = 500): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SPRINTS = {
  items: [
    { id: "sp_active", name: "Active one", start_date: "2026-06-01", end_date: "2026-06-14", state: "active", taskCount: 0 },
  ],
  total: 1,
  offset: 0,
  limit: 500,
};

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;
let archiveOutcome: "unknown" | "not_saved";

beforeEach(() => {
  archiveOutcome = "not_saved";
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method;
    if (u.includes("/api/sprints/sp_active/archive") && method === "POST") {
      if (archiveOutcome === "unknown") {
        return Promise.resolve(errorResponse({ code: "unknown", message: "boom", data_state: "unknown" }, 504));
      }
      return Promise.resolve(errorResponse({ code: "git_failed", message: "boom", data_state: "not_saved" }, 500));
    }
    if (u.includes("/api/sprints")) {
      return Promise.resolve(jsonResponse(SPRINTS));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function renderPanel(): void {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const rootRoute = createRootRoute({ component: SprintsPanel });
  const idxRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: SprintsPanel });
  const sprintRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sprints/$key", component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([idxRoute, sprintRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function openArchiveToggle(): void {
  const kebab = screen.getByRole("button", { name: /Actions for sprint/ });
  fireEvent.click(kebab);
  fireEvent.click(screen.getByTestId("sprint-archive-toggle"));
}

describe("SprintsPanel — archive inline failure notice (A328/B6)", () => {
  it("names the sprint and shows the unknown-state copy on a timeout", async () => {
    archiveOutcome = "unknown";
    renderPanel();
    await screen.findByTestId("sprints-list");

    openArchiveToggle();

    const notice = await screen.findByTestId("sprint-archive-error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("Couldn't confirm Active one was archived. Reload to check.");
  });

  it("names the sprint and re-fires the toggle from Try again on a plain rejection", async () => {
    archiveOutcome = "not_saved";
    renderPanel();
    await screen.findByTestId("sprints-list");

    openArchiveToggle();

    const notice = await screen.findByTestId("sprint-archive-error");
    expect(notice.textContent).toContain("Active one wasn't archived. Try again.");

    const before = fetchMock.mock.calls.filter(c => String(c[0]).includes("/archive")).length;
    fireEvent.click(screen.getByTestId("sprint-archive-error-retry"));
    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(c => String(c[0]).includes("/archive")).length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
