import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient, ApiError, apiRequest } from "./client.ts";

type FetchArgs = Parameters<typeof fetch>;
type FetchMockCalls = readonly FetchArgs[];

function mockFetchOnce(response: {
  status?: number;
  body?: unknown;
  contentType?: string;
}): void {
  const status = response.status ?? 200;
  const contentType = response.contentType ?? "application/json";
  // The fetch spec forbids a body on 204/205/304 — match real network
  // behavior by passing null in those cases.
  const noBody = status === 204 || status === 205 || status === 304;
  const bodyText = noBody
    ? null
    : typeof response.body === "string"
      ? response.body
      : JSON.stringify(response.body ?? null);
  const res = new Response(bodyText, {
    status,
    headers: { "Content-Type": contentType },
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(res);
}

function fetchCalls(): FetchMockCalls {
  return vi.mocked(globalThis.fetch).mock.calls as unknown as FetchMockCalls;
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiRequest deadlines", () => {
  /** A fetch that honours the signal it is given and never resolves. */
  function hangingFetch(): void {
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
  }

  // @verifies BLK-41
  it("reports its own deadline as an unknown outcome", async () => {
    hangingFetch();
    const err = await apiRequest("/api/tasks/bulk/archive", {
      method: "POST", body: {}, timeoutMs: 10,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).envelope?.data_state).toBe("unknown");
    // Reload, not retry: retrying a write that may have landed is how
    // one archive becomes two.
    expect((err as ApiError).envelope?.recovery?.kind).toBe("reload");
  });

  // @verifies BLK-41
  it("does not report a caller's own abort as unknown, even once the deadline has passed", async () => {
    // The fetch rejects on the caller's abort, but only reaches the
    // catch block after the deadline has also elapsed. That ordering is
    // the bug: `AbortSignal.timeout` keeps running once the caller
    // aborts, so a check of `deadline.aborted` in the catch block reads
    // true and reports a routine unmount as "LocTT cannot tell whether
    // this was saved". Real code hits this whenever the microtask queue
    // is busy between the rejection and the handler.
    const caller = new AbortController();
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          setTimeout(() => { reject(new DOMException("aborted", "AbortError")); }, 30);
        });
      }),
    );
    const p = apiRequest("/api/tasks/bulk/archive", {
      method: "POST", body: {}, timeoutMs: 10, signal: caller.signal,
    }).catch((e: unknown) => e);
    caller.abort();
    const err = await p;

    expect(err).toBeInstanceOf(Error);
    expect((err as ApiError).envelope?.data_state).not.toBe("unknown");
  });
});

describe("apiRequest", () => {
  it("sends the X-Loctt-Client header on every request", async () => {
    mockFetchOnce({ body: { ok: true } });
    await apiRequest("/api/info");
    const [, init] = fetchCalls()[0] ?? [] as unknown as FetchArgs;
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Loctt-Client"]).toBe("web");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("serializes the body and sets Content-Type when a body is provided", async () => {
    mockFetchOnce({ body: { ok: true } });
    await apiClient.post("/api/projects", { name: "Alt" });
    const [, init] = fetchCalls()[0] ?? [] as unknown as FetchArgs;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ name: "Alt" }));
    expect(init?.method).toBe("POST");
  });

  it("does NOT set Content-Type on bodyless requests", async () => {
    mockFetchOnce({ body: {} });
    await apiClient.get("/api/info");
    const [, init] = fetchCalls()[0] ?? [] as unknown as FetchArgs;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("returns the parsed JSON body on success", async () => {
    mockFetchOnce({ body: { taskCount: 7 } });
    const out = await apiRequest<{ taskCount: number }>("/api/info");
    expect(out.taskCount).toBe(7);
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetchOnce({ status: 204, body: "" });
    const out = await apiRequest<void>("/api/something", { method: "DELETE" });
    expect(out).toBeUndefined();
  });

  it("throws ApiError on a 4xx, surfacing the server message", async () => {
    mockFetchOnce({ status: 400, body: { error: "missing field foo" } });
    await expect(apiClient.post("/api/projects", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "missing field foo",
      endpoint: "/api/projects",
    });
  });

  it("throws ApiError on a 5xx with a fallback message when no body shape", async () => {
    mockFetchOnce({ status: 500, body: "internal boom", contentType: "text/plain" });
    const err = await apiClient.get("/api/info").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe("internal boom");
  });

  it("falls back to '<endpoint> responded with <status>' when body has no useful message", async () => {
    mockFetchOnce({ status: 502, body: { unrelated: true } });
    const err = await apiClient.get("/api/info").catch((e: unknown) => e);
    expect((err as ApiError).message).toBe("/api/info responded with 502");
  });

  it("forwards an AbortSignal to fetch, combined with the default deadline (K115)", async () => {
    // K115: a GET with no explicit `timeoutMs` now gets the default
    // read deadline rather than an omitted one, so the signal passed to
    // `fetch` is no longer the caller's raw signal unchanged — it is
    // `AbortSignal.any([caller, deadline])`. This test asserted the OLD
    // "unbounded by default" behaviour (identity equality with the
    // caller's own signal); it was not asserting a bug so much as
    // pinning the exact shape K115 was asked to change. What still
    // matters, and what this now checks, is that the caller's own
    // abort still reaches `fetch` — aborting `ctrl` must abort the
    // signal actually passed through.
    mockFetchOnce({ body: {} });
    const ctrl = new AbortController();
    await apiClient.get("/api/info", { signal: ctrl.signal });
    const [, init] = fetchCalls()[0] ?? [] as unknown as FetchArgs;
    expect(init?.signal).not.toBe(ctrl.signal);
    expect(init?.signal?.aborted).toBe(false);
    ctrl.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it("merges extra headers alongside the CSRF marker", async () => {
    mockFetchOnce({ body: {} });
    await apiClient.get("/api/info", { headers: { "X-Custom": "1" } });
    const [, init] = fetchCalls()[0] ?? [] as unknown as FetchArgs;
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Custom"]).toBe("1");
    expect(headers["X-Loctt-Client"]).toBe("web");
  });

  it("lets callers override the CSRF header (the server checks for presence, not value)", async () => {
    mockFetchOnce({ body: {} });
    await apiClient.get("/api/info", { headers: { "X-Loctt-Client": "vscode-ext" } });
    const [, init] = fetchCalls()[0] ?? [] as unknown as FetchArgs;
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Loctt-Client"]).toBe("vscode-ext");
  });
});

describe("postFile", () => {
  // @verifies REL-47
  it("frames a dropped connection as an incomplete, retryable, not-saved upload", async () => {
    // A killed connection mid-upload: `fetch` rejects with a bare
    // TypeError that names neither the file nor what happened. Without
    // the framing in `postFile`, that reaches the panel verbatim as
    // "Failed to fetch" — no data_state, no recovery — and the panel
    // cannot offer the retry REL-47 requires.
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    const file = new File(["x".repeat(64)], "big.bin", { type: "application/octet-stream" });
    const err = await apiClient
      .postFile("/api/tasks/T-1/attachments", file)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    // Not the P4 "unknown" write case: the route is atomic, so the file
    // was demonstrably not attached — the state is knowable as not_saved
    // and the safe action is retry, not reload.
    expect(api.envelope?.data_state).toBe("not_saved");
    expect(api.envelope?.recovery?.kind).toBe("retry");
    expect(api.envelope?.message).toMatch(/did not complete/i);
    expect(api.status).toBe(0);
  });

  it("still throws the server's own envelope on a 4xx rejection", async () => {
    // The network-error branch must not swallow a real HTTP rejection:
    // a 400 with a server envelope keeps its status and envelope, so the
    // panel's retry-vs-not decision stays the server's to make.
    mockFetchOnce({
      status: 400,
      body: { code: "validation_failed", message: "bad file", field: "file" },
    });
    const file = new File(["x"], "small.txt", { type: "text/plain" });
    const err = await apiClient
      .postFile("/api/tasks/T-1/attachments", file)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).envelope?.code).toBe("validation_failed");
  });
});
