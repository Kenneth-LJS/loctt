// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comboValue, pickCombo } from "../ui/selectComboboxTestUtils.ts";
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
  // K102: a saved view carries an ORDERED `filters` list and no query
  // string. A `{kind:"simple"}` filter seeds a DROPDOWN ROW in the edit
  // dialog — never query text.
  queries: [{
    id: "v1",
    name: "Open bugs",
    filters: [{ kind: "simple", field: "status", op: "in", values: ["backlog"] }],
  }],
};

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url, init) => {
    const u = String(url);
    // An advanced filter row validates its DSL as the user types.
    if (u.includes("/api/query/validate")) {
      return Promise.resolve(jsonResponse({ valid: true }));
    }
    if (u.endsWith("/api/views") && (init as RequestInit | undefined)?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "vNew", name: "n", filters: [] }, 201));
    }
    if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "PUT") {
      return Promise.resolve(jsonResponse({ id: "v1", name: "n", filters: [] }));
    }
    if (u.endsWith("/api/views") || u.includes("/api/views?")) {
      return Promise.resolve(jsonResponse(ONE_VIEW));
    }
    if (u.includes("/api/workflow")) return Promise.resolve(jsonResponse({ workflow: {} }));
    // Entity pickers the value dropdowns load (projects/users/labels/…).
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
  it("opens the dialog on the simple-filter picker and POSTs an ordered filters list", async () => {
    // K102: the create dialog opens the human-readable FILTER PICKER, not
    // the visual AST builder and not a raw DSL box, and saves `filters`.
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByTestId("saved-views-new"));
    await screen.findByTestId("view-filter-field-0");
    expect(screen.queryByTestId("query-builder")).toBeNull();
    expect(screen.queryByTestId("advanced-query-editor")).toBeNull();

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "My open bugs" } });
    pickCombo("view-filter-field-0", "title");
    fireEvent.change(screen.getByTestId("view-filter-value-0"), { target: { value: "login" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    const [post] = writeCalls("POST");
    if (post === undefined) throw new Error("no POST call");
    expect(post.url).toContain("/api/views");
    const body = post.body as { name: string; filters?: unknown; conditions?: unknown; query?: unknown };
    expect(body.name).toBe("My open bugs");
    expect(body.filters).toEqual([
      { kind: "simple", field: "title", op: "~", values: ["login"] },
    ]);
    // The pre-K102 shapes are gone from the wire entirely.
    expect(body.conditions).toBeUndefined();
    expect(body.query).toBeUndefined();
  });

  // @verifies VUE-40
  it("keeps Save disabled until the name exists and every started filter is finished", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");
    fireEvent.click(screen.getByTestId("saved-views-new"));
    await screen.findByTestId("view-filter-field-0");

    const save = screen.getByTestId<HTMLButtonElement>("view-form-save");
    // No name → disabled.
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "X" } });
    // K102: an UNTOUCHED blank row is dropped, not a blocker — a view with
    // no filters is legitimate (it matches everything in its scope).
    await waitFor(() => { expect(save.disabled).toBe(false); });

    // But a STARTED filter with no value blocks, because saving it would
    // silently discard the field the user just chose.
    pickCombo("view-filter-field-0", "title");
    await waitFor(() => { expect(save.disabled).toBe(true); });
    fireEvent.change(screen.getByTestId("view-filter-value-0"), { target: { value: "x" } });
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

describe("SavedViewsPanel — failed archive / delete are surfaced (ERR-13)", () => {
  // Before the fix the archive/unarchive/permanent-delete mutations had no
  // onError: a failed archive read as done, and a failed delete just left
  // the confirm dialog open with no word of why. Both are red-proven —
  // without the error props these testids/messages do not render.

  // @verifies ERR-13
  it("a failed permanent delete shows the reason inside the confirm dialog", async () => {
    fetchMock.mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes("/api/query/validate")) return Promise.resolve(jsonResponse({ valid: true }));
      if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "DELETE") {
        return Promise.resolve(
          jsonResponse({ message: "queries.yaml is read-only", code: "rejected_write" }, 500),
        );
      }
      return Promise.resolve(jsonResponse(ONE_VIEW));
    });

    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-delete"));
    fireEvent.click(screen.getByTestId("view-delete-confirm"));

    // The failure is shown in the dialog, not swallowed by a confirm that
    // just closes.
    const err = await screen.findByTestId("confirm-dialog-error");
    expect(err.textContent).toContain("read-only");
    // Dialog stays open (it only closes onSuccess).
    expect(screen.getByTestId("view-delete-dialog")).toBeTruthy();
  });

  // @verifies ERR-13
  it("a failed archive is surfaced on the row rather than read as done", async () => {
    fetchMock.mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes("/api/query/validate")) return Promise.resolve(jsonResponse({ valid: true }));
      // Archive is a soft DELETE (?soft=true) — fail it.
      if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "DELETE") {
        return Promise.resolve(
          jsonResponse({ message: "could not write queries.yaml", code: "rejected_write" }, 500),
        );
      }
      return Promise.resolve(jsonResponse(ONE_VIEW));
    });

    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-archive"));

    const err = await screen.findByTestId("view-archive-error");
    expect(err.textContent).toContain("could not write");
  });
});

describe("SavedViewsPanel — edit (VUE-41)", () => {
  // @verifies VUE-41
  it("opens the edit dialog seeded as DROPDOWN ROWS from the stored filters, and PUTs filters", async () => {
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    await screen.findByTestId("saved-views-list");

    fireEvent.click(screen.getByRole("button", { name: /Actions for view/ }));
    fireEvent.click(screen.getByTestId("view-edit"));

    // K102's whole point: a stored `{kind:"simple"}` filter reopens as the
    // picker row it was authored as — NOT as query text.
    await screen.findByTestId("view-filter-field-0");
    expect(screen.getByTestId<HTMLInputElement>("view-form-name").value).toBe("Open bugs");
    expect(comboValue("view-filter-field-0")).toBe("status");
    expect(comboValue("view-filter-op-0")).toBe("in");
    expect(screen.queryByTestId("view-filter-query-0")).toBeNull();

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    const [put] = writeCalls("PUT");
    if (put === undefined) throw new Error("no PUT call");
    expect(put.url).toContain("/api/views/v1");
    const body = put.body as { name: string; filters?: unknown };
    expect(body.name).toBe("Renamed");
    // Round-tripped unchanged — an edit of the NAME must not rewrite the
    // filters (no reordering, no operator rewriting).
    expect(body.filters).toEqual([
      { kind: "simple", field: "status", op: "in", values: ["backlog"] },
    ]);
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
    await screen.findByTestId("view-filter-field-0");
    // Rename and save; the server rejects it (400).
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    const err = await screen.findByTestId("view-form-error");
    expect(err.textContent).toContain("invalid query");
    // Dialog still open.
    expect(screen.getByTestId("view-edit-dialog")).toBeTruthy();
  });
});

/**
 * Broken saved views (VUE-22) in the settings panel.
 *
 * A hand-edited `queries.yaml` entry whose `filters` do not validate is
 * degraded per-entry; its FULL original YAML survives on disk in
 * `rawText` and is re-emitted verbatim by every unrelated write (P-11 /
 * K28 / Phase-Z-C2).
 *
 * This panel never offered a plain Edit on a broken row, so it did not
 * carry the sidebar's silent-overwrite defect. What it did carry is the
 * weaker gap: it told the user to fix the file without ever showing them
 * what is in it, and offered no in-app repair at all. Both are covered
 * here, along with the same confirmation guard on the write.
 */
describe("SavedViewsPanel — broken views (VUE-22)", () => {
  const BROKEN = {
    id: "v_bad",
    name: "Bad view",
    summary: "status WAT done",
    error: "filters[0].op is not a comparison operator",
    index: 1,
    rawText: "id: v_bad\nname: Bad view\nfilters:\n  - kind: simple\n    field: status\n    op: WAT\n    values: [done]\n",
  };

  function withBroken(): void {
    fetchMock.mockImplementation((url, init) => {
      const u = String(url);
      if (u.includes("/api/query/validate")) return Promise.resolve(jsonResponse({ valid: true }));
      if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "PUT") {
        return Promise.resolve(jsonResponse({ id: "v_bad", name: "Bad view", filters: [] }));
      }
      if (u.endsWith("/api/views") || u.includes("/api/views?")) {
        return Promise.resolve(jsonResponse({ ...ONE_VIEW, broken: [BROKEN] }));
      }
      if (u.includes("/api/workflow")) return Promise.resolve(jsonResponse({ workflow: {} }));
      return Promise.resolve(jsonResponse({ items: [] }));
    });
  }

  // @verifies VUE-22
  it("shows the broken entry's original YAML, not just advice to go edit the file", async () => {
    withBroken();
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    const raw = await screen.findByTestId("view-broken-raw-v_bad");
    // The bytes still on disk — the only surviving record of what the
    // user meant, and what makes "fix it by hand" actionable.
    expect(raw.textContent).toBe(BROKEN.rawText);
  });

  // @verifies VUE-42
  it("Replace… will not write until the user confirms the text will be discarded", async () => {
    withBroken();
    render(<SavedViewsPanel />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("view-broken-replace-v_bad"));
    await screen.findByTestId("view-edit-dialog");

    // The preserved text is in front of the user before any choice.
    expect(screen.getByTestId<HTMLTextAreaElement>("view-form-broken-raw").value).toBe(BROKEN.rawText);

    const save = screen.getByTestId<HTMLButtonElement>("view-form-save");
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await waitFor(() => { expect(screen.getByTestId("view-edit-dialog")).toBeTruthy(); });
    expect(writeCalls("PUT")).toEqual([]);

    // Confirmed, it writes — replacement stays possible, just deliberate.
    fireEvent.click(screen.getByTestId("view-form-confirm-replace"));
    fireEvent.click(screen.getByTestId("view-form-save"));
    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
  });
});
