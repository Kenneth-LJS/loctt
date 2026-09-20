// @vitest-environment jsdom
import type { BuilderTree, SavedQuery } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ViewFormDialog } from "./ViewFormDialog.tsx";

/**
 * ViewFormDialog is now builder-first (Ken's ruling, Stage 2): "New
 * filter" opens the VISUAL QueryBuilder, NOT a raw DSL box, and saves
 * structured `conditions`. These pin exactly that.
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
    const u = String(url);
    if (u.includes("/api/query/validate")) return Promise.resolve(jsonResponse({ valid: true }));
    if (u.endsWith("/api/views") && (init as RequestInit | undefined)?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "vNew", name: "n", query: "q" }, 201));
    }
    if (u.includes("/api/views/") && (init as RequestInit | undefined)?.method === "PUT") {
      return Promise.resolve(jsonResponse({ id: "v1", name: "n", query: "q" }));
    }
    if (u.includes("/api/workflow")) return Promise.resolve(jsonResponse({ workflow: {} }));
    // Entity pickers (projects/users/labels/milestones/sprints) — empty.
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

function parseBody(init: RequestInit | undefined): Record<string, unknown> | undefined {
  const body = init?.body;
  return typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : undefined;
}

function writeCalls(method: string) {
  return fetchMock.mock.calls
    .filter(c => (c[1] as RequestInit | undefined)?.method === method)
    .map(c => ({ url: String(c[0]), body: parseBody(c[1] as RequestInit | undefined) }));
}

/** Fill a freshly-added leaf as `title = something` (a text-kind leaf). */
function fillTitleLeaf(value: string): void {
  fireEvent.change(screen.getByTestId("qb-field"), { target: { value: "title" } });
  fireEvent.change(screen.getByTestId("qb-op"), { target: { value: "=" } });
  fireEvent.change(screen.getByTestId("qb-value"), { target: { value } });
}

describe("ViewFormDialog — builder-first (Stage 2)", () => {
  it("renders the VISUAL builder by default in create mode, not a bare DSL textarea", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });

    // The visual builder is present…
    await screen.findByTestId("query-builder");
    // …and the raw DSL editor is NOT the default surface. Red-proof: with
    // the old AdvancedQueryEditor-only dialog this element WAS present, so
    // this assertion goes red if the dialog reverts to text-first.
    expect(screen.queryByTestId("advanced-query-editor")).toBeNull();
    expect(screen.queryByTestId("dsl-input")).toBeNull();
  });

  it("reveals the raw DSL editor when Advanced is toggled, and back again", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("query-builder");

    fireEvent.click(screen.getByTestId("view-switch-to-advanced"));
    await screen.findByTestId("advanced-query-editor");
    expect(screen.queryByTestId("query-builder")).toBeNull();

    // The toggle is round-trip: an empty query is renderable, so "Switch
    // to visual" returns to the builder.
    fireEvent.click(screen.getByTestId("view-switch-to-builder"));
    await screen.findByTestId("query-builder");
  });

  it("POSTs structured conditions (not a query string) on save", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("query-builder");

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "My open bugs" } });
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fillTitleLeaf("login");
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    const [post] = writeCalls("POST");
    if (post === undefined) throw new Error("no POST call");
    expect(post.url).toContain("/api/views");
    // The load-bearing assertion (right layer): the body carries a
    // structured `conditions` tree, not merely a `query` string.
    expect(post.body?.name).toBe("My open bugs");
    expect(post.body?.conditions).toBeDefined();
    const conditions = post.body?.conditions as BuilderTree;
    expect(conditions.kind).toBe("group");
    // and it contains the leaf we authored.
    const asGroup = conditions as Extract<BuilderTree, { kind: "group" }>;
    const leaf = asGroup.children.find(
      (c): c is Extract<BuilderTree, { kind: "leaf" }> => c.kind === "leaf" && c.field === "title",
    );
    expect(leaf).toBeDefined();
    expect(leaf?.op).toBe("=");
  });

  it("seeds the builder from the existing view's conditions in edit mode", async () => {
    const existing: Pick<SavedQuery, "id" | "name" | "query" | "conditions"> = {
      id: "v1",
      name: "Backlog",
      query: "status = backlog",
      conditions: {
        kind: "leaf",
        field: "status",
        op: "=",
        value: { type: "string", value: "backlog" },
      },
    };
    render(<ViewFormDialog existing={existing} onClose={() => {}} />, { wrapper: wrapper() });

    // Opens the VISUAL builder (renderable conditions), pre-filled from
    // the stored tree — the field picker shows `status`, not a DSL box.
    await screen.findByTestId("query-builder");
    expect(screen.queryByTestId("advanced-query-editor")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId<HTMLSelectElement>("qb-field").value).toBe("status");
    });
  });

  it("opens Advanced with a note when the existing conditions can't be shown in the builder", async () => {
    // A has_link view (the seeded `blocked` default does this) is not
    // renderable, so edit falls back to Advanced text with the reason.
    const existing: Pick<SavedQuery, "id" | "name" | "query" | "conditions"> = {
      id: "vb",
      name: "Blocked",
      query: 'has_link("is_blocked_by")',
      conditions: { kind: "has_link", linkKind: "is_blocked_by" },
    };
    render(<ViewFormDialog existing={existing} onClose={() => {}} />, { wrapper: wrapper() });

    await screen.findByTestId("advanced-query-editor");
    expect(screen.getByTestId("view-advanced-refuse-note")).toBeTruthy();
    // The DSL box is seeded from the derived query.
    expect(screen.getByTestId<HTMLTextAreaElement>("dsl-input").value).toContain("has_link");
  });

  it("preserves an in-progress condition across a text↔visual round-trip (no silent loss)", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("query-builder");

    // Author a completed condition.
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fillTitleLeaf("login");

    // Switch to text, then straight back to visual without editing the DSL.
    fireEvent.click(screen.getByTestId("view-switch-to-advanced"));
    await screen.findByTestId("advanced-query-editor");
    // The completed condition IS carried into the text box (red-proof: with
    // the pre-fix safeSerialize this could still be present when there was
    // no empty group; the empty-group case below is the harder one).
    expect(screen.getByTestId<HTMLTextAreaElement>("dsl-input").value).toContain("login");

    fireEvent.click(screen.getByTestId("view-switch-to-builder"));
    await screen.findByTestId("query-builder");

    // The row survived the round-trip — field/op/value all intact.
    await waitFor(() => {
      expect(screen.getByTestId<HTMLSelectElement>("qb-field").value).toBe("title");
    });
    expect(screen.getByTestId<HTMLSelectElement>("qb-op").value).toBe("=");
    expect(screen.getByTestId<HTMLInputElement>("qb-value").value).toBe("login");
  });

  it("does NOT blank out completed conditions when a half-built nested group is present (toggle data-loss)", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("query-builder");

    // A completed condition AND an empty "+ Group" the user just added and
    // has not filled — the exact state Ken hit. Pre-fix, safeSerialize threw
    // on the empty group and returned "", so switching to text showed a
    // BLANK box: the completed `title = login` was silently discarded.
    fireEvent.click(screen.getByTestId("qb-add-condition"));
    fillTitleLeaf("login");
    fireEvent.click(screen.getByTestId("qb-add-group"));

    fireEvent.click(screen.getByTestId("view-switch-to-advanced"));
    await screen.findByTestId("advanced-query-editor");

    // Red-proof: this is empty under the old code (safeSerialize → "").
    const dsl = screen.getByTestId<HTMLTextAreaElement>("dsl-input");
    expect(dsl.value).toContain("login");
    expect(dsl.value.trim().length).toBeGreaterThan(0);

    // And switching back restores the FULL builder state, including the
    // empty group the text couldn't express (tree preserved, not re-parsed).
    fireEvent.click(screen.getByTestId("view-switch-to-builder"));
    await screen.findByTestId("query-builder");
    await waitFor(() => {
      expect(screen.getByTestId<HTMLSelectElement>("qb-field").value).toBe("title");
    });
    // The empty nested group is still there (2 children at the root: the
    // leaf's row and the group card).
    expect(screen.getAllByTestId("query-builder-group").length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to save an unparseable Advanced-mode DSL (VUE-11)", async () => {
    render(<ViewFormDialog onClose={() => {}} />, { wrapper: wrapper() });
    await screen.findByTestId("query-builder");
    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Bad" } });

    fireEvent.click(screen.getByTestId("view-switch-to-advanced"));
    await screen.findByTestId("advanced-query-editor");
    // A genuinely unparseable query.
    fireEvent.change(screen.getByTestId("dsl-input"), { target: { value: "status = = =" } });

    // Save is disabled and no request goes out.
    const save = screen.getByTestId<HTMLButtonElement>("view-form-save");
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await screen.findByTestId("view-advanced-parse-error");
    expect(writeCalls("POST").length).toBe(0);
  });
});
