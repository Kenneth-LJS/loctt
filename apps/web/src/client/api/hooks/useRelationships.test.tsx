// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLinkTask, useRerankRelationship } from "./useRelationships.ts";

/**
 * B40: the Children tree on an ancestor's page is drawn from the
 * whole-tracker graph (`["task-graph"]`), not from the task response, so
 * a reorder (or link) on a child's page must refresh it — otherwise the
 * grandparent keeps showing the old order until a reload.
 *
 * @verifies REL-13
 */
function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const invalidated = () =>
    spy.mock.calls.map(c => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0]);
  return { wrapper, invalidated };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("relationship writes refresh the task graph (B40)", () => {
  it("a rerank invalidates ['task-graph']", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ rank: "m", rebalanced: false }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useRerankRelationship("T-1"), { wrapper });
    result.current.mutate({ type: "child", target: "T-3", before: "T-2" });
    await waitFor(() => { expect(invalidated()).toContain("task-graph"); });
  });

  it("a link invalidates ['task-graph']", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "x", key: "T-1", title: "t" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    const { wrapper, invalidated } = harness();
    const { result } = renderHook(() => useLinkTask("T-1"), { wrapper });
    result.current.mutate({ type: "child", target: "T-3" });
    await waitFor(() => { expect(invalidated()).toContain("task-graph"); });
  });
});
