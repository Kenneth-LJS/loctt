// @vitest-environment jsdom
import type { Filter } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as matchers from "@testing-library/jest-dom/matchers";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SaveViewDialog } from "./SaveViewDialog.tsx";

expect.extend(matchers);

/**
 * "Save as view" from the list toolbar (M1.3). K102: it sends the ORDERED
 * `filters` list built from the active filters — each facet as its own
 * `{kind:"simple"}` filter — and never an archived scope (K121 #1: no
 * saved view over archived items). Asserted at the request-body layer.
 *
 * ## The preview (A337)
 *
 * The preview tests below replace the ones this file had for the old
 * `filterToSummary`-based text dump. Ken, on a screenshot of that dump
 * (`project in "01M33FN47B9B55YP89X786V1VB"`): *"why is the filter
 * preview just text?! that's bad UX."* Both faults it had — reading as
 * query text, and printing raw ULIDs (P-4) — are what these tests pin
 * against: field label + resolved value name, never an id, grouped per
 * field, degraded chips for a dangling reference, and the DSL shown only
 * for an advanced filter (still legitimate there — the user typed it).
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The value sources the preview resolves against — same shape FilterBar's
 * own test fixture uses. One milestone id (`m_live`) resolves; the ids
 * used in tests below that are NOT in this list are the dangling case.
 */
function routeFetch(path: string): unknown {
  if (path.startsWith("/api/projects")) {
    return { items: [{ id: "p_web", name: "Web Client", prefix: "WEB-" }], total: 1, offset: 0, limit: 100, default: "p_web" };
  }
  if (path.startsWith("/api/users")) {
    return { items: [{ id: "u_ken", name: "Ken Loh", timezone: "UTC" }], total: 1, offset: 0, limit: 100, current: "u_ken" };
  }
  if (path.startsWith("/api/labels")) {
    return { items: [{ id: "l_bug", name: "bug", color: "#CC0000" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/milestones")) {
    return { items: [{ id: "m_live", name: "Beta launch" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/sprints")) return { items: [], total: 0, offset: 0, limit: 100 };
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: [{ key: "backlog", label: "Backlog", category: "pending" }],
      priorities: [],
      task_types: [],
      relationships: [],
      custom_fields: [],
    };
  }
  return {};
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((...args: [RequestInfo | URL, RequestInit?]) => {
    const [input, init] = args;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.endsWith("/api/views") && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "vNew", name: "n", filters: [] }, 201));
    }
    return Promise.resolve(jsonResponse(routeFetch(path)));
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

/**
 * The list's search passes unknown params through, so a held
 * `?archived=all` bookmark can still be in it. K121 #1: it must not turn
 * into a saved view over archived items.
 */
const STRAY_ARCHIVED = { status: ["backlog"], archived: "all" } as Parameters<typeof SaveViewDialog>[0]["search"];

describe("SaveViewDialog", () => {
  it("POSTs the ORDERED filters list built from the active filters", async () => {
    render(
      <SaveViewDialog search={STRAY_ARCHIVED} onClose={() => {}} />,
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
    // K121 #1: no archived scope, whatever the URL carried.
    expect(body).not.toHaveProperty("archivedScope");
    expect(body?.conditions).toBeUndefined();
    expect(body?.query).toBeUndefined();
  });

  it("shows the resolved status NAME, grouped under its field label — not the DSL", async () => {
    render(
      <SaveViewDialog search={STRAY_ARCHIVED} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    const summary = await screen.findByTestId("save-view-filter-summary");
    // Field label + resolved value name, read together — "Status" then
    // "Backlog" (the workflow label, not the stored key "backlog" alone,
    // and never the DSL shape `status in "backlog"`). Waits for the
    // workflow fetch to resolve so the value is not still degraded.
    await waitFor(() => { expect(summary.textContent).toContain("Backlog"); });
    expect(summary.textContent).toContain("Status");
    expect(summary.textContent).not.toMatch(/archived/i);
    expect(summary.textContent).not.toContain("status in");
    expect(summary.textContent).not.toContain("AND");
  });

  it("carries a free-text q verbatim as the ONE advanced filter", async () => {
    render(
      <SaveViewDialog search={{ q: 'has_link("is_blocked_by")' }} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    // An advanced filter is the only row that shows query text, because
    // that IS what the user typed.
    const summary = await screen.findByTestId("save-view-filter-summary");
    expect(summary.textContent).toContain('has_link("is_blocked_by")');
  });

  it("resolves a milestone id to its NAME, never the raw ULID (P-4)", async () => {
    render(
      <SaveViewDialog
        search={{ milestone: ["m_live"] } as Parameters<typeof SaveViewDialog>[0]["search"]}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    const summary = await screen.findByTestId("save-view-filter-summary");
    await waitFor(() => { expect(summary.textContent).toContain("Beta launch"); });
    expect(summary.textContent).toContain("Milestone");
    expect(summary.textContent).not.toContain("m_live");
  });

  it("shows a MULTI-value filter as a set of chips, not a comma-joined string", async () => {
    render(
      <SaveViewDialog
        search={{ labels: ["l_bug", "l_missing"] } as Parameters<typeof SaveViewDialog>[0]["search"]}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    await screen.findByTestId("save-view-filter-summary");
    // Both values render as their OWN chip element — not one string
    // glued together with commas. A dangling value degrades to "Deleted
    // label" via the resolver, so the second value is expected to read
    // that way once resolved; the assertion that matters here is that
    // there are two SEPARATE chip nodes, not whether the second
    // resolves.
    const row = await screen.findByTestId("save-view-filter-row");
    await waitFor(() => {
      expect(row.querySelectorAll("[data-testid], .inline-flex").length).toBeGreaterThanOrEqual(2);
    });
    // A collapsed comma-joined string would put both labels in ONE text
    // node under a single element — assert they are not siblings of the
    // SAME single node by checking each value has its own element whose
    // OWN textContent is just that value (not both joined).
    const chipTexts = Array.from(row.querySelectorAll("span"))
      .map(el => el.textContent)
      .filter((t): t is string => t !== null && t.length > 0);
    expect(chipTexts).not.toContain("bug, Deleted label");
  });

  it("shows a dangling reference as a degraded chip, never the raw id", async () => {
    render(
      <SaveViewDialog
        search={{ milestone: ["m_deleted_but_gone"] } as Parameters<typeof SaveViewDialog>[0]["search"]}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    const summary = await screen.findByTestId("save-view-filter-summary");
    expect(summary.textContent).toContain("Deleted milestone");
    expect(summary.textContent).not.toContain("m_deleted_but_gone");
  });

  it("shows the messaging.md empty state when there are no filters and no sort", () => {
    render(
      <SaveViewDialog search={{}} onClose={() => {}} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByTestId("save-view-no-filters").textContent)
      .toBe("No filters — this view will show every task.");
    expect(screen.queryByTestId("save-view-filter-summary")).not.toBeInTheDocument();
  });

  it("shows the view's sort as its own row when the search carries one", async () => {
    render(
      <SaveViewDialog
        search={{ sort: "priority", dir: "desc" } as Parameters<typeof SaveViewDialog>[0]["search"]}
        onClose={() => {}}
      />,
      { wrapper: wrapper() },
    );
    const sortRow = await screen.findByTestId("save-view-sort-row");
    expect(sortRow.textContent).toContain("Sort");
    expect(sortRow.textContent).toMatch(/descending/i);
  });
});
