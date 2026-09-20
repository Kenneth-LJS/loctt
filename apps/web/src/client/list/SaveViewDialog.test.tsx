// @vitest-environment jsdom
import type { BuilderTree } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SaveViewDialog } from "./SaveViewDialog.tsx";

/**
 * "Save as view" from the list toolbar (M1.3). Stage 2: it now sends the
 * STRUCTURED `conditions` built from the active filters, not just the
 * derived `query` string — asserted at the request-body layer.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/api/views") && (init as RequestInit | undefined)?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "vNew", name: "n", query: "q" }, 201));
    }
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function postBody(): Record<string, unknown> | undefined {
  const call = fetchMock.mock.calls.find(
    c => (c[1] as RequestInit | undefined)?.method === "POST",
  );
  const body = (call?.[1] as RequestInit | undefined)?.body;
  return typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : undefined;
}

describe("SaveViewDialog", () => {
  it("POSTs structured conditions built from the active filters", async () => {
    render(
      <SaveViewDialog search={{ status: ["backlog"], archived: true }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );

    fireEvent.change(screen.getByPlaceholderText(/My open bugs/), { target: { value: "Backlog view" } });
    fireEvent.click(screen.getByRole("button", { name: /Save view/ }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true);
    });

    const body = postBody();
    expect(body?.name).toBe("Backlog view");
    // The load-bearing assertion: `conditions` is present in the body.
    expect(body?.conditions).toBeDefined();
    const conditions = body?.conditions as BuilderTree;
    expect(conditions.kind).toBe("group");
    // And the single-value facet is membership, never a count-based `=`.
    const group = conditions as Extract<BuilderTree, { kind: "group" }>;
    const statusLeaf = group.children.find(
      (c): c is Extract<BuilderTree, { kind: "leaf" }> => c.kind === "leaf" && c.field === "status",
    );
    expect(statusLeaf?.op).toBe("in");
  });

  it("previews the derived query string read-only", () => {
    render(
      <SaveViewDialog search={{ status: ["backlog"], archived: true }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    // The preview shows the derived DSL (membership form).
    expect(screen.getByText(/status in \(backlog\)/)).toBeTruthy();
  });
});
