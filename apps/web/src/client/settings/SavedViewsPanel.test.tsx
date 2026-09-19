// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SavedViewsPanel } from "./SavedViewsPanel.tsx";

/**
 * SavedViewsPanel — VUE-40 (create) and VUE-41 (rename / edit-query).
 *
 * Both are client wiring to routes that already exist (`POST /api/views`,
 * `PUT /api/views/:id`). The assertions turn on the *request* the panel
 * issues — the method, the URL, and the body — because a view written to
 * the wrong endpoint or with the wrong shape would still close the dialog
 * and look successful.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

const ONE_VIEW = {
  queries: [{ id: "v1", name: "Open bugs", query: "type:bug AND status:open" }],
};

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url, init) => {
    const u = String(url);
    // The advanced editor validates the query as the user types.
    if (u.includes("/api/query/validate")) {
      return Promise.resolve(jsonResponse({ valid: true }));
    }
    if (u.endsWith("/api/views") && (init as RequestInit | undefined)?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "vNew", name: "n", query: "q" }, 201));
    }
    if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "PUT") {
      return Promise.resolve(jsonResponse({ id: "v1", name: "n", query: "q" }));
    }
    // GET /api/views
    return Promise.resolve(jsonResponse(ONE_VIEW));
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
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function parseBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

function writeCalls(method: string) {
  return fetchMock.mock.calls
    .filter(c => (c[1] as RequestInit | undefined)?.method === method)
    .map(c => ({ url: String(c[0]), body: parseBody(c[1] as RequestInit | undefined) }));
}

describe("SavedViewsPanel — create (VUE-40)", () => {
  // @verifies VUE-40
  it("opens a create dialog and POSTs name + query to /api/views", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByTestId("saved-views-new"));
    // The reused advanced query editor is present in the dialog.
    await screen.findByTestId("advanced-query-editor");

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "My open bugs" } });
    fireEvent.change(screen.getByTestId("dsl-input"), { target: { value: "status:open" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    const [post] = writeCalls("POST");
    if (post === undefined) throw new Error("no POST call");
    expect(post.url).toContain("/api/views");
    expect(post.body).toEqual({ name: "My open bugs", query: "status:open" });
  });

  // @verifies VUE-40
  it("keeps Create disabled until both name and query are non-empty", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");
    fireEvent.click(screen.getByTestId("saved-views-new"));
    await screen.findByTestId("advanced-query-editor");

    const save = screen.getByTestId<HTMLButtonElement>("view-form-save");
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "X" } });
    // Still disabled: query is empty.
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("dsl-input"), { target: { value: "status:open" } });
    expect(save.disabled).toBe(false);
  });
});

describe("SavedViewsPanel — edit (VUE-41)", () => {
  // @verifies VUE-41
  it("opens an edit dialog prefilled with the view and PUTs to /api/views/:id", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-edit"));
    await screen.findByTestId("advanced-query-editor");

    // Prefilled from the existing view.
    expect(screen.getByTestId<HTMLInputElement>("view-form-name").value).toBe("Open bugs");
    expect(screen.getByTestId<HTMLTextAreaElement>("dsl-input").value).toBe("type:bug AND status:open");

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByTestId("dsl-input"), { target: { value: "status:done" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    const [put] = writeCalls("PUT");
    if (put === undefined) throw new Error("no PUT call");
    expect(put.url).toContain("/api/views/v1");
    expect(put.body).toEqual({ name: "Renamed", query: "status:done" });
  });

  // @verifies VUE-41
  it("a rejected save keeps the dialog open with an anchored error (SET-51)", async () => {
    fetchMock.mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes("/api/query/validate")) return Promise.resolve(jsonResponse({ valid: true }));
      if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "PUT") {
        return Promise.resolve(
          jsonResponse({ message: "invalid query near 'xyz'", code: "rejected_write", data_state: "unchanged" }, 400),
        );
      }
      return Promise.resolve(jsonResponse(ONE_VIEW));
    });

    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");
    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-edit"));
    await screen.findByTestId("advanced-query-editor");
    fireEvent.change(screen.getByTestId("dsl-input"), { target: { value: "xyz" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    const err = await screen.findByTestId("view-form-error");
    expect(err.textContent).toContain("invalid query");
    // Dialog still open.
    expect(screen.getByTestId("view-edit-dialog")).toBeTruthy();
  });
});
