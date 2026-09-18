// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSetField } from "./useSetField.ts";

/**
 * DEG-31: a field write must refresh the global integrity badge.
 *
 * A `set`/`unset` can repair a corrupt field (the value that lifted into
 * `health` is replaced with a valid one), which changes the integrity
 * count. The badge (`["integrity"]`) is refreshed by the same `onSettled`
 * that invalidates `["tasks"]`, so it stays in step without polling.
 *
 * `invalidateQueries` is the observable: measured over the network a build
 * that invalidates `["integrity"]` and one that does not produce identical
 * request counts (React Query will not refetch an unobserved query), so the
 * decision has to be tested at the invalidation call, not the wire.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const invalidatedKeys = () =>
    spy.mock.calls
      .map(c => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0])
      .filter((k): k is string => typeof k === "string");
  return { wrapper, invalidatedKeys };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("useSetField integrity invalidation (DEG-31)", () => {
  // @verifies DEG-31
  it("invalidates the integrity badge alongside the task list after a write", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: "01M15", key: "T-1", title: "A task", status: "todo" }),
    );
    const { wrapper, invalidatedKeys } = harness();
    const { result } = renderHook(() => useSetField("T-1"), { wrapper });

    result.current.mutate({ field: "status", value: "done" });

    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    // onSettled fires after success; wait for the invalidation to be recorded.
    await waitFor(() => {
      expect(invalidatedKeys()).toContain("integrity");
    });
    // It rides with the list invalidation it is paired to.
    expect(invalidatedKeys()).toContain("tasks");
  });
});
