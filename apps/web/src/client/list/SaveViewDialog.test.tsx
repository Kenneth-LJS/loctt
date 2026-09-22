// @vitest-environment jsdom
import type { Filter } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SaveViewDialog } from "./SaveViewDialog.tsx";

/**
 * "Save as view" from the list toolbar (M1.3). K102: it sends the ORDERED
 * `filters` list built from the active filters — each facet as its own
 * `{kind:"simple"}` filter — plus the archived SCOPE as a view property,
 * and it shows a HUMAN-READABLE summary rather than the DSL (Ken: "average
 * people dont need to see the fucking DSL QUERY"). Asserted at the
 * request-body layer.
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
      return Promise.resolve(jsonResponse({ id: "vNew", name: "n", filters: [] }, 201));
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
  it("POSTs the ORDERED filters list built from the active filters", async () => {
    render(
      <SaveViewDialog search={{ status: ["backlog"], archived: "all" }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );

    fireEvent.change(screen.getByPlaceholderText(/My open bugs/), { target: { value: "Backlog view" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true);
    });

    const body = postBody();
    expect(body?.name).toBe("Backlog view");
    // The load-bearing assertion: the body carries `filters`, with the
    // facet stored as a SIMPLE filter so reopening the view renders it as
    // a dropdown row (K102). A single-value facet stays MEMBERSHIP — it
    // must not collapse to `=` on value count.
    expect(body?.filters).toEqual([
      { kind: "simple", field: "status", op: "in", values: ["backlog"] },
    ] satisfies Filter[]);
    // Archived is a view property, never a filter row.
    expect(body?.archivedScope).toBe("all");
    expect(body?.conditions).toBeUndefined();
    expect(body?.query).toBeUndefined();
  });

  it("shows a human-readable filter summary, not the DSL", () => {
    render(
      <SaveViewDialog search={{ status: ["backlog"], archived: "all" }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    // One row per filter, read as plain `field op values` — and the
    // archived scope spelled out in words rather than as a query term.
    const summary = screen.getByTestId("save-view-filter-summary");
    expect(summary.textContent).toContain("status in backlog");
    expect(summary.textContent).toContain("Active and archived tasks");
    // Ken's rule: no DSL. The merged query form must not appear.
    expect(summary.textContent).not.toContain("archived !=");
    expect(summary.textContent).not.toContain("AND");
  });

  it("carries a free-text q verbatim as the ONE advanced filter", () => {
    render(
      <SaveViewDialog search={{ q: 'has_link("is_blocked_by")' }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    // An advanced filter is the only row that shows query text, because
    // that IS what the user typed.
    expect(screen.getByTestId("save-view-filter-summary").textContent)
      .toContain('has_link("is_blocked_by")');
  });

});
