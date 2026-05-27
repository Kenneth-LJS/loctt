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

  it("forwards an AbortSignal to fetch", async () => {
    mockFetchOnce({ body: {} });
    const ctrl = new AbortController();
    await apiClient.get("/api/info", { signal: ctrl.signal });
    const [, init] = fetchCalls()[0] ?? [] as unknown as FetchArgs;
    expect(init?.signal).toBe(ctrl.signal);
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
