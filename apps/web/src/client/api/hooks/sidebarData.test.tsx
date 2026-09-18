// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLabels, useMilestones, useProjects, useSprints, useUsers } from "./sidebarData.ts";

/**
 * Every picker's list must be requested at a size that can hold the
 * whole config list.
 *
 * ## What this catches
 *
 * These hooks sent no `limit`, and `GET /api/*` paginates at
 * `DEFAULT_PAGE_LIMIT = 100` when none is given. Measured against a
 * real tracker seeded with 150 labels:
 *
 *     GET /api/labels            -> { total: 150, items: 100 }
 *     GET /api/labels?limit=1000 -> { total: 150, items: 150 }
 *
 * The damage is not a short list. The create modal's label field
 * decides whether to offer "Create «name»" by searching the list it
 * was given, so a label sitting at position 140 on disk is invisible
 * to the client and the form offers to create a duplicate of something
 * that already exists (NEW-7's inline-create branch, NEW-25's
 * searchable picker). The same reasoning covers the milestone, sprint,
 * assignee and reporter pickers, which is why all five are asserted
 * rather than only the one that motivated the fix.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ items: [], total: 0, offset: 0, limit: 1000 }),
  );
});
afterEach(() => { vi.restoreAllMocks(); });

function calledUrl(): string {
  const call = vi.mocked(globalThis.fetch).mock.calls[0]?.[0];
  if (typeof call === "string") return call;
  if (call instanceof URL) return call.href;
  return call?.url ?? "";
}

describe("sidebar picker hooks request a limit past the server's default page", () => {
  const cases = [
    ["labels", useLabels],
    ["milestones", useMilestones],
    ["sprints", useSprints],
    ["projects", useProjects],
    ["users", useUsers],
  ] as const;

  for (const [name, hook] of cases) {
    it(`useProjects/${name} asks for more than the 100-row default page`, async () => {
      const { result } = renderHook(() => hook(), { wrapper: wrapper() });
      await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

      const url = calledUrl();
      expect(url).toContain(`/api/${name}`);

      // Assert the *number*, not merely that a `limit` appears: a
      // `limit=50` would satisfy "has a limit" while making the
      // truncation worse than the default it replaced.
      const limit = new URL(url, "http://x").searchParams.get("limit");
      expect(limit).not.toBeNull();
      expect(Number(limit)).toBeGreaterThan(100);
      // The server's MAX_PAGE_LIMIT. Asking past it is a 400, which
      // would break every picker at once.
      expect(Number(limit)).toBeLessThanOrEqual(1000);
    });
  }

  it("keeps archived users in the request that also carries the limit", async () => {
    // The limit was added to a URL that already had a query string.
    // Appending with `?` instead of `&` would silently drop
    // `include_archived`, and LST-25 depends on it — an assignee
    // archived since is otherwise rendered as a raw id.
    const { result } = renderHook(() => useUsers(), { wrapper: wrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    const params = new URL(calledUrl(), "http://x").searchParams;
    expect(params.get("include_archived")).toBe("true");
    expect(Number(params.get("limit"))).toBeGreaterThan(100);
  });
});
