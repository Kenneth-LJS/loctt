// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tasksParamsFromSearch, useTasks } from "./useTasks.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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
    jsonResponse({ items: [], total: 0, offset: 0, limit: 50 }),
  );
});
afterEach(() => vi.restoreAllMocks());

function calledUrl(): string {
  const call = vi.mocked(globalThis.fetch).mock.calls[0]?.[0];
  if (typeof call === "string") return call;
  if (call instanceof URL) return call.href;
  return call?.url ?? "";
}

describe("tasksParamsFromSearch", () => {
  it("maps q/view/sort/dir and the first project entry", () => {
    const params = tasksParamsFromSearch({
      q: "text ~ bug",
      view: "v1",
      project: ["p_web", "p_api"],
      sort: "priority",
      dir: "desc",
      page: 2,
    });
    expect(params).toEqual({
      query: "text ~ bug",
      view: "v1",
      project: "p_web", // single until M1.3 multi-select
      sort: "priority",
      dir: "desc",
      page: 2,
    });
  });

  it("omits absent params", () => {
    expect(tasksParamsFromSearch({})).toEqual({});
  });
});

describe("useTasks", () => {
  it("builds the query string with limit/offset from page and sort/dir", async () => {
    const { result } = renderHook(
      () => useTasks({ sort: "updated_at", dir: "desc", page: 2, limit: 50 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("/api/tasks?");
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=50"); // (page 2 - 1) * 50
    expect(url).toContain("sort=updated_at");
    expect(url).toContain("dir=desc");
  });

  it("defaults to limit 50 / offset 0 when page is unset", async () => {
    const { result } = renderHook(() => useTasks({}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = calledUrl();
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=0");
  });

  it("url-encodes the query param", async () => {
    const { result } = renderHook(
      () => useTasks({ query: "priority in [high, critical]" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledUrl()).toContain("query=priority+in+%5Bhigh%2C+critical%5D");
  });
});
