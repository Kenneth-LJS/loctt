// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type SyncProgress, useGitSync } from "./useGit.ts";

/**
 * GIT-23 bullets 3-4 turn on *which* React Query keys a sync
 * invalidates, and that is invisible to a Playwright test: the main
 * list reads `["tasks-feed"]` and the sidebar saved-view badges read
 * `["builtin-count"]`, neither of which is a prefix of `["tasks"]`.
 * A sync that invalidated only `["tasks"]` (as the hook did before this
 * change) left both stale — the list kept the pre-sync population and
 * the badges kept the pre-sync counts. `invalidateQueries` is the
 * observable; spying it counts the calls directly.
 */

function ndjsonResponse(lines: string[]): Response {
  return new Response(lines.map(l => l + "\n").join(""), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

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
    spy.mock.calls.map(c => {
      const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
      return Array.isArray(key) ? key[0] : undefined;
    });
  return { wrapper, invalidatedKeys };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("useGitSync invalidation (GIT-23)", () => {
  // @verifies GIT-23
  it("invalidates the list feed and saved-view badges after a sync, not just tasks", async () => {
    // A no-op JSON reply is enough — the invalidation runs onSettled
    // regardless of the body, and this isolates the key set from the
    // streaming transport.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ updated: false }));
    const { wrapper, invalidatedKeys } = harness();
    const { result } = renderHook(() => useGitSync(), { wrapper });

    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    const keys = invalidatedKeys();
    // The population the list actually renders (GIT-23 bullet 3)…
    expect(keys).toContain("tasks-feed");
    // …and the sidebar saved-view count badges (GIT-23 bullet 4).
    expect(keys).toContain("builtin-count");
    // The pre-existing keys are still invalidated too.
    expect(keys).toContain("git");
    expect(keys).toContain("tasks");
  });

  // @verifies GIT-23
  it("forwards streamed progress and resolves with the terminal result", async () => {
    // GIT-23 bullet 1/2: the NDJSON transport delivers each progress tick
    // to the caller and resolves the mutation with the terminal result
    // (counts), never a phantom success.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ndjsonResponse([
      JSON.stringify({ progress: { applied: 0, total: 3 } }),
      JSON.stringify({ progress: { applied: 2, total: 3 } }),
      JSON.stringify({ progress: { applied: 3, total: 3 } }),
      JSON.stringify({ result: { updated: true, copied: 3, merged: 0, deleted: 0 } }),
    ]));
    const ticks: SyncProgress[] = [];
    const { wrapper } = harness();
    const { result } = renderHook(() => useGitSync(p => ticks.push(p)), { wrapper });

    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });

    expect(ticks).toEqual([
      { applied: 0, total: 3 },
      { applied: 2, total: 3 },
      { applied: 3, total: 3 },
    ]);
    expect(result.current.data).toEqual({ updated: true, copied: 3, merged: 0, deleted: 0 });
  });

  // @verifies GIT-23
  it("reconstructs an ApiError from a terminal error line", async () => {
    // A mid-write failure arrives after the 200 stream header, as a
    // terminal { error } line. The hook must turn it back into the same
    // ApiError (with its envelope) the plain JSON error path would throw,
    // so downstream branching (code, reconcile detection) is unchanged.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ndjsonResponse([
      JSON.stringify({ progress: { applied: 0, total: 5 } }),
      JSON.stringify({ error: { status: 500, message: "disk full", code: "git_failed", data_state: "unknown" } }),
    ]));
    const { wrapper } = harness();
    const { result } = renderHook(() => useGitSync(), { wrapper });

    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    const err = result.current.error as { status?: number; code?: string; message: string };
    expect(err.status).toBe(500);
    expect(err.code).toBe("git_failed");
    expect(err.message).toBe("disk full");
  });
});
