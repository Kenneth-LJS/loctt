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
  // Post-Stage-1 a saved view carries structured `conditions`; the edit
  // dialog seeds the visual builder from it. `status = backlog` is a plain
  // renderable leaf, so edit opens the builder (not the DSL box).
  queries: [{
    id: "v1",
    name: "Open bugs",
    query: "status = backlog",
    conditions: { kind: "leaf", field: "status", op: "=", value: { type: "string", value: "backlog" } },
  }],
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
    if (u.endsWith("/api/views") || u.includes("/api/views?")) {
      return Promise.resolve(jsonResponse(ONE_VIEW));
    }
    if (u.includes("/api/workflow")) return Promise.resolve(jsonResponse({ workflow: {} }));
    // Entity pickers the builder loads (projects/users/labels/…).
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
  it("opens a builder-first create dialog and POSTs structured conditions", async () => {
    // Stage 2: the create dialog opens the VISUAL builder, not the raw DSL
    // box, and saves `conditions`. (The old test asserted the DSL box was
    // the default and `{name,query}` was posted — the behavior Ken
    // rejected; superseded here.)
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByTestId("saved-views-new"));
    await screen.findByTestId("query-builder");
    expect(screen.queryByTestId("advanced-query-editor")).toBeNull();

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "My open bugs" } });
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.change(screen.getByTestId("qb-field"), { target: { value: "title" } });
    fireEvent.change(screen.getByTestId("qb-op"), { target: { value: "=" } });
    fireEvent.change(screen.getByTestId("qb-value"), { target: { value: "login" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    const [post] = writeCalls("POST");
    if (post === undefined) throw new Error("no POST call");
    expect(post.url).toContain("/api/views");
    const body = post.body as { name: string; conditions?: unknown; query?: unknown };
    expect(body.name).toBe("My open bugs");
    expect(body.conditions).toBeDefined();
  });

  // @verifies VUE-40
  it("keeps Create disabled until the name and at least one condition exist", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");
    fireEvent.click(screen.getByTestId("saved-views-new"));
    await screen.findByTestId("query-builder");

    const save = screen.getByTestId<HTMLButtonElement>("view-form-save");
    // Empty builder + empty name → disabled.
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "X" } });
    // Still disabled: no condition yet.
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fireEvent.change(screen.getByTestId("qb-field"), { target: { value: "title" } });
    fireEvent.change(screen.getByTestId("qb-op"), { target: { value: "=" } });
    fireEvent.change(screen.getByTestId("qb-value"), { target: { value: "x" } });
    await waitFor(() => { expect(save.disabled).toBe(false); });
  });
});

describe("SavedViewsPanel — delete / archive (VUE-38)", () => {
  // @verifies VUE-38
  // The shared useDeleteView hook (lifted from a module-local copy) backs
  // both Delete (hard) and Archive (soft). This asserts the panel still
  // issues the right requests through it, so a broken lift is caught here.
  it("Delete issues a DELETE /api/views/:id after confirming", async () => {
    fetchMock.mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes("/api/query/validate")) return Promise.resolve(jsonResponse({ valid: true }));
      if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ deleted: "v1" }));
      }
      return Promise.resolve(jsonResponse(ONE_VIEW));
    });

    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-delete"));
    // The shared ConfirmDialog opens; its confirm button issues the DELETE.
    fireEvent.click(screen.getByTestId("view-delete-confirm"));

    await waitFor(() => {
      const dels = fetchMock.mock.calls.filter(
        c => (c[1] as RequestInit | undefined)?.method === "DELETE" && String(c[0]).includes("/api/views/v1"),
      );
      expect(dels.length).toBe(1);
      // A hard delete carries no ?soft flag.
      expect(String(dels[0]?.[0])).not.toContain("soft=true");
    });
  });

  // @verifies VUE-25
  it("Archive issues a soft DELETE (?soft=true)", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-archive"));

    await waitFor(() => {
      const softDeletes = fetchMock.mock.calls.filter(
        c => (c[1] as RequestInit | undefined)?.method === "DELETE" && String(c[0]).includes("soft=true"),
      );
      expect(softDeletes.length).toBe(1);
    });
  });
});

describe("SavedViewsPanel — edit (VUE-41)", () => {
  // @verifies VUE-41
  it("opens a builder-first edit dialog seeded from conditions and PUTs conditions", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-edit"));
    // Renderable conditions → the visual builder, seeded from the stored
    // tree (not the DSL string).
    await screen.findByTestId("query-builder");
    expect(screen.getByTestId<HTMLInputElement>("view-form-name").value).toBe("Open bugs");
    await waitFor(() => {
      expect(screen.getByTestId<HTMLSelectElement>("qb-field").value).toBe("status");
    });

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    const [put] = writeCalls("PUT");
    if (put === undefined) throw new Error("no PUT call");
    expect(put.url).toContain("/api/views/v1");
    const body = put.body as { name: string; conditions?: unknown };
    expect(body.name).toBe("Renamed");
    expect(body.conditions).toBeDefined();
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
      if (u.endsWith("/api/views") || u.includes("/api/views?")) return Promise.resolve(jsonResponse(ONE_VIEW));
      if (u.includes("/api/workflow")) return Promise.resolve(jsonResponse({ workflow: {} }));
      return Promise.resolve(jsonResponse({ items: [] }));
    });

    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");
    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-edit"));
    await screen.findByTestId("query-builder");
    // Rename and save through the builder; the server rejects it (400).
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    const err = await screen.findByTestId("view-form-error");
    expect(err.textContent).toContain("invalid query");
    // Dialog still open.
    expect(screen.getByTestId("view-edit-dialog")).toBeTruthy();
  });
});
