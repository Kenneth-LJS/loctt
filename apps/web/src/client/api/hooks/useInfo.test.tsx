// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInfo } from "./useInfo.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({
      exists: true,
      taskCount: 12,
      keyPrefix: "T-",
      nextKey: "T-13",
      schemaStatus: { kind: "current", version: 3 },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useInfo", () => {
  it("calls /api/info and returns the parsed response", async () => {
    const { result } = renderHook(() => useInfo(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.taskCount).toBe(12);
    expect(result.current.data?.nextKey).toBe("T-13");
    expect(result.current.data?.schemaStatus.kind).toBe("current");
  });

  it("propagates an ApiError when the server returns 500", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ error: "boom" }, 500),
    );
    const { result } = renderHook(() => useInfo(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("boom");
  });

  it("sends the CSRF header on the underlying fetch", async () => {
    const { result } = renderHook(() => useInfo(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)["X-Loctt-Client"]).toBe("web");
  });
});
