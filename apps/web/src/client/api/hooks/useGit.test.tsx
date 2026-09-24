// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STREAM_INACTIVITY_TIMEOUT_MS, type SyncProgress, useGitSync } from "./useGit.ts";

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

  // @verifies GIT-13, GIT-12 (A342)
  it("a plain-JSON planning-phase failure is read off the one response, not re-fetched", async () => {
    // `handleGitSync` answers a planning-phase refusal (reconcile
    // needed, a conflict, …) as ordinary JSON — no NDJSON header — and
    // by then it has already written whatever sentinel that refusal
    // implies (e.g. the reconcile.yaml a `reconcile_needed` leaves for
    // the panel to read). `streamSync` used to react to "not NDJSON" by
    // POSTing to `/api/git/sync` a SECOND time to re-derive the
    // ApiError via `apiClient.post` — sending a non-idempotent write
    // twice. The second call landed on the sentinel the first call's
    // failure had just written and reported a DIFFERENT, wrong error
    // ("a previous sync was interrupted") instead of the original
    // refusal. Fixed by parsing the `Response` already in hand
    // (`resolveResponse`) instead of re-fetching.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { code: "reconcile_needed", message: "reconciliation needed", data_state: "not_saved", recovery: { kind: "none" } },
        409,
      ),
    );
    const { wrapper } = harness();
    const { result } = renderHook(() => useGitSync(), { wrapper });

    result.current.mutate();
    await waitFor(() => { expect(result.current.isError).toBe(true); });

    // Exactly one request went out — no repeat POST.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const err = result.current.error as { status?: number; code?: string; message: string };
    expect(err.status).toBe(409);
    expect(err.code).toBe("reconcile_needed");
    expect(err.message).toBe("reconciliation needed");
  });
});

/**
 * B12: `createDeadline` (`../client.ts`, A314/K115) is `streamSync`'s
 * (this file) and `streamDoctor`'s (`settings/DiagnosticsPanel.tsx`)
 * shared inactivity-timeout primitive, and neither caller had a test
 * exercising the deadline itself — only the happy/error NDJSON paths
 * above. Driven here through `streamSync`, the exported function that
 * actually calls it, rather than by testing `createDeadline` in
 * isolation: what matters is the real behaviour a caller observes, and
 * `DiagnosticsPanel.tsx` (settings/, out of scope for this change) is
 * covered by the identical mechanism, not a second copy of these tests.
 */
describe("streamSync inactivity deadline (B12, createDeadline / K115)", () => {
  /**
   * A `Response` whose body the test pushes into by hand, so it can
   * assert state *between* chunks — the same shape as
   * `settings/dataPanels.test.tsx`'s `controllableNdjson`, duplicated
   * locally rather than imported from a settings/-owned test file.
   *
   * Unlike a bare `ReadableStream`, this one is wired to the `signal`
   * `streamSync` passes into `fetch` (`withTimeout`'s
   * `deadlineCtl.signal`, forwarded to `getReader().read()` calls
   * indirectly through the real body): a REAL fetch response body
   * rejects a pending `reader.read()` when the request's controller
   * aborts (the underlying connection tears down); a hand-built
   * `ReadableStream` with no such wiring leaves `read()` pending
   * forever, which would make a deadline test hang instead of
   * exercising `streamSync`'s `catch` branch. `signal` reproduces just
   * that one piece of real `fetch` behaviour.
   */
  function controllableNdjson(signal: AbortSignal): {
    response: Response;
    push: (obj: unknown) => void;
    close: () => void;
  } {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        signal.addEventListener("abort", () => {
          c.error(new DOMException("aborted", "AbortError"));
        });
      },
    });
    return {
      response: new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      }),
      push: (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")),
      close: () => controller.close(),
    };
  }

  afterEach(() => { vi.useRealTimers(); });

  // @verifies K115
  it("a stream silent past the deadline ends with an unknown-outcome error", async () => {
    vi.useFakeTimers();
    // The deadline's `AbortController` is created inside `streamSync`
    // and its signal passed to `fetch` — capture it from the mock call
    // so the test body can wire the SAME signal `streamSync` will later
    // abort, rather than a disconnected one of the test's own.
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const { response } = controllableNdjson(init?.signal as AbortSignal);
      return Promise.resolve(response);
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useGitSync(), { wrapper });

    result.current.mutate();
    // Let the header arrive and the reader start waiting on the body —
    // no chunk sent, so the inactivity window starts ticking.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.isError).toBe(false);

    // Just under the deadline: still nothing, matching BoardView.test.tsx's
    // precedent of driving the real (fixed at module-load) constant
    // rather than an env override, which only a fresh module load picks
    // up.
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_INACTIVITY_TIMEOUT_MS - 1); });
    expect(result.current.isError).toBe(false);

    // Past it: the deadline aborts the read, and the hook reports the
    // "cannot tell whether it finished" outcome (P4's rare "unknown"
    // exception), not a silent hang and not a false failure/success.
    // `vi.waitFor`/`waitFor` poll on real timers by default, which never
    // fire while the fake clock is frozen — advance the fake clock in a
    // loop instead, giving React Query's own microtask chain (abort →
    // reject → mutation settle → re-render) room to drain between ticks.
    await act(async () => {
      for (let i = 0; i < 20 && !result.current.isError; i++) {
        await vi.advanceTimersByTimeAsync(2);
      }
    });
    expect(result.current.isError).toBe(true);

    const err = result.current.error as { message: string; envelope?: { data_state?: string } };
    expect(err.message).toContain("went silent");
  });

  // @verifies K115
  it("a slow stream that keeps sending chunks does NOT time out", async () => {
    vi.useFakeTimers();
    let push!: (obj: unknown) => void;
    let close!: () => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const c = controllableNdjson(init?.signal as AbortSignal);
      push = c.push;
      close = c.close;
      return Promise.resolve(c.response);
    });
    const { wrapper } = harness();
    const { result } = renderHook(() => useGitSync(), { wrapper });

    result.current.mutate();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // Three chunks, each arriving just under the deadline after the
    // last — total elapsed time is roughly 3x the deadline, which a
    // FIXED (non-resetting) timeout would have already failed on. Each
    // chunk must reset the inactivity window, per K115 item 3 ("time out
    // only on silence").
    for (let i = 0; i < 3; i++) {
      push({ progress: { applied: i, total: 3 } });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_INACTIVITY_TIMEOUT_MS - 1); });
      expect(result.current.isError).toBe(false);
    }

    push({ result: { updated: true, copied: 3, merged: 0, deleted: 0 } });
    close();
    await act(async () => {
      for (let i = 0; i < 20 && !result.current.isSuccess; i++) {
        await vi.advanceTimersByTimeAsync(2);
      }
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual({ updated: true, copied: 3, merged: 0, deleted: 0 });
  });
});
