// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuiltinFilter } from "../../sidebar/builtinFilters.ts";
import { useBuiltinCounts } from "./useBuiltinCounts.ts";

/**
 * The count badge's deadline.
 *
 * SHL-23's last clause — "if the count query never resolves, the badge
 * eventually shows an unavailable affordance rather than spinning
 * forever" — turns entirely on this. A test that fails the *request*
 * cannot reach it: a rejection is already an answer, and the badge
 * would report unavailable with no deadline at all.
 */

const OVERDUE: BuiltinFilter = {
  id: "overdue",
  label: "Overdue",
  icon: "!",
  resolve: () => ({ q: "due_date < 2026-06-08" }),
};

const CTX = { currentUserId: "u_ken", today: "2026-06-08" };

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** A fetch that never answers but does honour its abort signal. */
function stubHangingFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => { reject(new DOMException("Aborted", "AbortError")); },
          { once: true },
        );
      }),
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe("useBuiltinCounts", () => {
  /**
   * @verifies SHL-23
   */
  it("gives up on a count that never answers, rather than staying pending", async () => {
    stubHangingFetch();

    const { result } = renderHook(
      () => useBuiltinCounts([OVERDUE], CTX, 30),
      { wrapper },
    );

    // Pending first — the slot is legitimately waiting.
    expect(result.current["overdue"]?.isLoading).toBe(true);
    expect(result.current["overdue"]?.unavailable).toBe(false);

    await waitFor(() => {
      expect(result.current["overdue"]?.unavailable).toBe(true);
    });
    expect(result.current["overdue"]?.isLoading).toBe(false);
    expect(result.current["overdue"]?.count).toBeUndefined();
  });

  /**
   * @verifies SHL-23
   *
   * The deadline must not fire on a request that answered in time —
   * otherwise a slow-but-working tracker loses every badge.
   */
  it("keeps a count that arrives inside the deadline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ total: 42 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { result } = renderHook(
      () => useBuiltinCounts([OVERDUE], CTX, 5_000),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current["overdue"]?.count).toBe(42);
    });
    expect(result.current["overdue"]?.unavailable).toBe(false);
  });
});
