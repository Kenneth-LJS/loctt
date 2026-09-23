// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickCombo } from "../ui/selectComboboxTestUtils.ts";
import { SprintsPanel } from "./SprintsPanel.tsx";

/**
 * Row actions (Burndown/Archive/Delete) live behind a per-row kebab
 * overflow menu (responsive GROUP A). Open the row's kebab, then click the
 * action MenuItem by testid.
 */
function openSprintAction(actionTestId: string): void {
  const kebabs = screen.getAllByRole("button", { name: /Actions for sprint/ });
  fireEvent.click(kebabs[0] as HTMLElement);
  fireEvent.click(screen.getByTestId(actionTestId));
}

/**
 * Ken's ruling, 2026-09-22 (decisions.md § 9): the archived-scope control
 * is demoted behind an icon reveal (`ArchivedScopeReveal`), not a
 * permanently visible segmented control — so a test must open it before a
 * segment (`sprints-archived-scope-<scope>`) is present to click.
 */
function openSprintsArchivedScope(): void {
  fireEvent.click(screen.getByTestId("sprints-archived-scope-reveal"));
}

/**
 * SprintsPanel — SPR-40 create / delete from Settings.
 *
 * The panel was read-only; these turn on the *requests* it now issues to
 * the existing sprint routes (`POST /api/sprints`, `DELETE
 * /api/sprints/:id`) — the method, the URL and the body — since a create
 * sent to the wrong shape would still clear the form and look fine.
 *
 * The "show archived" split is asserted structurally: archived sprints
 * are hidden until the toggle, so a regression that dropped them (reading
 * as "they were deleted") is visible.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

const SPRINTS = {
  items: [
    { id: "sp_active", name: "Active one", start_date: "2026-06-01", end_date: "2026-06-14", state: "active", taskCount: 0 },
    { id: "sp_arch", name: "Old one", start_date: "2026-01-01", end_date: "2026-01-14", state: "completed", archived: true, taskCount: 0 },
  ],
  total: 2,
  offset: 0,
  limit: 500,
};

/**
 * K107: apply the request's `?archived` scope to the seed, the way the
 * real endpoint does. `active` (or absent) → active only; `archived` →
 * archived only; `all` → both.
 */
function scopedSprints(url: string) {
  const scope = new URL(url, "http://x").searchParams.get("archived") ?? "active";
  const items = SPRINTS.items.filter(s =>
    scope === "all" ? true : scope === "archived" ? s.archived === true : s.archived !== true,
  );
  return { ...SPRINTS, items, total: items.length };
}

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method;
    if ((u.includes("/archive") || u.includes("/unarchive")) && method === "POST") {
      return Promise.resolve(jsonResponse({ archived: "sp_active" }));
    }
    if (u.includes("/api/sprints") && method === "POST") {
      return Promise.resolve(jsonResponse({ id: "sp_new", name: "n", start_date: "x", end_date: "y", state: "active" }, 201));
    }
    if (u.includes("/api/sprints/") && method === "DELETE") {
      return Promise.resolve(jsonResponse({ deleted: "sp_active", affectedTaskCount: 0 }));
    }
    if (u.includes("/api/sprints/") && method === "PUT") {
      return Promise.resolve(jsonResponse({ id: "sp_active", name: "Active one", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" }));
    }
    // K107: the list endpoint honours the `?archived` scope, so the mock
    // must too — the panel now trusts the server to filter rather than
    // splitting a fetch-all client-side.
    return Promise.resolve(jsonResponse(scopedSprints(u)));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function renderPanel(initialEntry = "/") {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const rootRoute = createRootRoute({ component: SprintsPanel });
  const idxRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: SprintsPanel });
  const sprintRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sprints/$key", component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([idxRoute, sprintRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
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

/**
 * K105: create no longer has an inline form on the panel — it opens the
 * shared `SprintEditDialog` (mode="create"), the same dialog the per-row
 * Edit action opens. Each test opens the dialog first. The field testids
 * (`sprint-create-name/start/end/state/goal/submit`) are unchanged, so
 * these tests assert the same requests through the new surface.
 */
function openCreateDialog(): void {
  fireEvent.click(screen.getByTestId("sprint-create-open"));
}

describe("SprintsPanel — create (SPR-40 / K105)", () => {
  // @verifies SPR-40
  it("POSTs name, dates and state to /api/sprints", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");
    openCreateDialog();
    await screen.findByTestId("sprint-create-dialog");

    fireEvent.change(screen.getByTestId("sprint-create-name"), { target: { value: "Sprint Z" } });
    fireEvent.change(screen.getByTestId("sprint-create-start"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("sprint-create-end"), { target: { value: "2026-07-14" } });
    pickCombo("sprint-create-state", "future");
    fireEvent.click(screen.getByTestId("sprint-create-submit"));

    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    const [post] = writeCalls("POST");
    if (post === undefined) throw new Error("no POST call");
    expect(post.url).toContain("/api/sprints");
    expect(post.body).toEqual({
      name: "Sprint Z",
      start_date: "2026-07-01",
      end_date: "2026-07-14",
      state: "future",
    });
  });

  // @verifies SPR-40 (Part C2: goal on create)
  it("POSTs the goal when one is entered on create", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");
    openCreateDialog();
    await screen.findByTestId("sprint-create-dialog");

    fireEvent.change(screen.getByTestId("sprint-create-name"), { target: { value: "Sprint G" } });
    fireEvent.change(screen.getByTestId("sprint-create-start"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("sprint-create-end"), { target: { value: "2026-07-14" } });
    fireEvent.change(screen.getByTestId("sprint-create-goal"), { target: { value: "Ship the beta" } });
    fireEvent.click(screen.getByTestId("sprint-create-submit"));

    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    const [post] = writeCalls("POST");
    if (post === undefined) throw new Error("no POST call");
    expect(post.body).toMatchObject({ name: "Sprint G", goal: "Ship the beta" });
  });

  // @verifies SPR-40 (Part C2)
  it("omits goal from the POST when the field is left blank", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");
    openCreateDialog();
    await screen.findByTestId("sprint-create-dialog");

    fireEvent.change(screen.getByTestId("sprint-create-name"), { target: { value: "Sprint N" } });
    fireEvent.change(screen.getByTestId("sprint-create-start"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("sprint-create-end"), { target: { value: "2026-07-14" } });
    fireEvent.click(screen.getByTestId("sprint-create-submit"));

    await waitFor(() => { expect(writeCalls("POST").length).toBe(1); });
    const [post] = writeCalls("POST");
    if (post === undefined) throw new Error("no POST call");
    expect(post.body).not.toHaveProperty("goal");
  });

  // @verifies SPR-40
  it("keeps Create disabled until the name and both dates are filled", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");
    openCreateDialog();
    await screen.findByTestId("sprint-create-dialog");
    const submit = screen.getByTestId<HTMLButtonElement>("sprint-create-submit");
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("sprint-create-name"), { target: { value: "Z" } });
    expect(submit.disabled).toBe(true); // dates still empty
    fireEvent.change(screen.getByTestId("sprint-create-start"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("sprint-create-end"), { target: { value: "2026-07-14" } });
    expect(submit.disabled).toBe(false);
  });
});

/**
 * K105: the per-row Edit action opens the same shared `SprintEditDialog` in
 * mode="edit". These assert that (a) the panel now offers edit at all —
 * before K105 metadata editing lived only on the detail route — and (b) it
 * sends a combined PUT of only the changed fields (A147) to /api/sprints/:id.
 *
 * Red-proof: remove the `sprint-edit` action (or the `editing &&
 * <SprintEditDialog mode="edit" …>` block) from SprintsPanel and the dialog
 * never opens, so `findByTestId("sprint-edit-dialog")` times out. Send every
 * field instead of only the changed one and the "PUTs only the changed
 * field" body assertion goes red.
 */
describe("SprintsPanel — edit (K105)", () => {
  // @verifies K105
  it("opens the shared SprintEditDialog prefilled from the row's sprint", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");

    openSprintAction("sprint-edit");
    await screen.findByTestId("sprint-edit-dialog");

    // Prefilled from sp_active, not blank like a create.
    expect(screen.getByTestId<HTMLInputElement>("sprint-create-name").value).toBe("Active one");
    expect(screen.getByTestId<HTMLInputElement>("sprint-create-start").value).toBe("2026-06-01");
    expect(screen.getByTestId<HTMLInputElement>("sprint-create-end").value).toBe("2026-06-14");
    // The primary button is Save (edit), never "Edit".
    expect(screen.getByTestId("sprint-save").textContent).toContain("Save");
  });

  // @verifies K105 / A147
  it("PUTs only the changed field to /api/sprints/:id", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");

    openSprintAction("sprint-edit");
    await screen.findByTestId("sprint-edit-dialog");

    // Change only the name.
    fireEvent.change(screen.getByTestId("sprint-create-name"), { target: { value: "Renamed sprint" } });
    fireEvent.click(screen.getByTestId("sprint-save"));

    await waitFor(() => { expect(writeCalls("PUT").length).toBe(1); });
    const [put] = writeCalls("PUT");
    if (put === undefined) throw new Error("no PUT call");
    expect(put.url).toContain("/api/sprints/sp_active");
    // Only the changed field is in the body (A147 combined patch).
    expect(put.body).toEqual({ name: "Renamed sprint" });
  });

  // @verifies K105 / A147
  it("closes without a PUT when nothing changed", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");

    openSprintAction("sprint-edit");
    await screen.findByTestId("sprint-edit-dialog");
    fireEvent.click(screen.getByTestId("sprint-save"));

    await waitFor(() => { expect(screen.queryByTestId("sprint-edit-dialog")).toBeNull(); });
    expect(writeCalls("PUT").length).toBe(0);
  });
});

describe("SprintsPanel — delete (SPR-40)", () => {
  // @verifies SPR-40
  it("DELETEs an unreferenced sprint after confirm", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");

    // The active sprint's delete control (the archived one is hidden).
    openSprintAction("sprint-delete");
    // Zero-ref sprint: a plain confirm, no remap picker.
    fireEvent.click(await screen.findByTestId("remap-confirm"));

    await waitFor(() => { expect(fetchMock.mock.calls.some(c =>
      String(c[0]).includes("/api/sprints/sp_active") && (c[1] as RequestInit | undefined)?.method === "DELETE",
    )).toBe(true); });
  });
});

describe("SprintsPanel — archived scope (SPR-40 / K107)", () => {
  // @verifies SPR-40
  // K107: the archived split is now driven by the tri-state scope control
  // (was a "Show archived" checkbox with a client-side split). The panel
  // trusts the server to filter; choosing "all" refetches with the
  // archived rows included.
  it("hides archived sprints until the scope control reveals them", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");

    // Default scope `active`: the archived sprint is not fetched.
    expect(screen.queryByTestId("sprint-row-sp_arch")).toBeNull();
    // The control is behind the reveal, not directly clickable.
    expect(screen.queryByTestId("sprints-archived-scope-all")).toBeNull();

    // Open the reveal, then switch the control to "all" — the panel
    // refetches and the archived row appears (in the archived block).
    openSprintsArchivedScope();
    fireEvent.click(await screen.findByTestId("sprints-archived-scope-all"));
    const row = await screen.findByTestId("sprint-row-sp_arch");
    expect(row.getAttribute("data-sprint-archived")).toBe("true");
  });
});

describe("SprintsPanel — archive (SPR-40)", () => {
  // @verifies SPR-40
  it("POSTs to the archive route and drops the row from the active scope", async () => {
    // Stateful list: once the active sprint is archived, the refetch
    // reports it archived, so we can watch the row leave the active list.
    // K107: the mock honours the request scope, like the endpoint.
    let archived = false;
    fetchMock.mockImplementation((url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (u.includes("/api/sprints/sp_active/archive") && method === "POST") {
        archived = true;
        return Promise.resolve(jsonResponse({ archived: "sp_active" }));
      }
      const scope = new URL(u, "http://x").searchParams.get("archived") ?? "active";
      const withState = SPRINTS.items.map(s =>
        s.id === "sp_active" ? { ...s, archived } : s,
      );
      const items = withState.filter(s =>
        scope === "all" ? true : scope === "archived" ? s.archived === true : s.archived !== true,
      );
      return Promise.resolve(jsonResponse({ ...SPRINTS, items, total: items.length }));
    });

    renderPanel();
    await screen.findByTestId("sprints-list");
    // Active sprint present, not yet archived.
    expect(screen.getByTestId("sprint-row-sp_active").getAttribute("data-sprint-archived")).toBe("false");

    // The active row's Archive button (the archived row is not in scope).
    openSprintAction("sprint-archive-toggle");

    // The hook fired at the right route.
    await waitFor(() => { expect(fetchMock.mock.calls.some(c =>
      String(c[0]).includes("/api/sprints/sp_active/archive")
      && (c[1] as RequestInit | undefined)?.method === "POST",
    )).toBe(true); });

    // After the invalidation refetch, sp_active drops out of the active
    // scope's list.
    await waitFor(() => { expect(screen.queryByTestId("sprint-row-sp_active")).toBeNull(); });
    // Revealing "all" brings it back, now marked archived.
    openSprintsArchivedScope();
    fireEvent.click(await screen.findByTestId("sprints-archived-scope-all"));
    const row = await screen.findByTestId("sprint-row-sp_active");
    expect(row.getAttribute("data-sprint-archived")).toBe("true");
  });

  // @verifies SPR-40
  it("POSTs to the unarchive route for an already-archived sprint", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");
    // Reveal the archived sprint (scope=all), whose button reads "Unarchive".
    openSprintsArchivedScope();
    fireEvent.click(await screen.findByTestId("sprints-archived-scope-all"));
    await screen.findByTestId("sprint-row-sp_arch");

    // Open the archived row's kebab; its toggle reads "Unarchive".
    const archivedRow = screen.getByTestId("sprint-row-sp_arch");
    const kebab = archivedRow.querySelector<HTMLButtonElement>("[aria-label^='Actions for sprint']");
    if (kebab === null) throw new Error("no actions kebab on archived row");
    fireEvent.click(kebab);
    const toggle = screen.getByTestId("sprint-archive-toggle");
    expect(toggle.textContent).toContain("Unarchive");
    fireEvent.click(toggle);

    await waitFor(() => { expect(fetchMock.mock.calls.some(c =>
      String(c[0]).includes("/api/sprints/sp_arch/unarchive")
      && (c[1] as RequestInit | undefined)?.method === "POST",
    )).toBe(true); });
  });
});

describe("SprintsPanel — deep-link row anchors (K100)", () => {
  // @verifies K100
  it("gives each sprint row a `row-<id>` DOM anchor for point-of-use deep links", async () => {
    renderPanel();
    const row = await screen.findByTestId("sprint-row-sp_active");
    // The anchor `useScrollToHash` resolves by id — not just the test id.
    expect(row.getAttribute("id")).toBe("row-sp_active");
  });

  // @verifies K100
  // K107: with server-side scoping, an archived row is not fetched under
  // the default `active` scope, so a `#row-<id>` deep link would resolve to
  // nothing. When a hash is present the panel widens the FETCH to `all` so
  // the target mounts and useScrollToHash can find it — no visible toggle
  // to flip any more (the control still reads `active`, but the effective
  // fetch scope is `all` while the deep link is in play).
  it("widens the fetch so a deep-linked archived sprint resolves", async () => {
    renderPanel("/#row-sp_arch");
    await screen.findByTestId("sprints-list");

    const archivedRow = await screen.findByTestId("sprint-row-sp_arch");
    expect(archivedRow.getAttribute("id")).toBe("row-sp_arch");
    expect(archivedRow.getAttribute("data-sprint-archived")).toBe("true");
    // The user-facing control still shows the default scope; the widen is
    // internal to make the anchor resolvable. It is demoted behind the
    // reveal (Ken's ruling, 2026-09-22), so it must be opened to inspect.
    openSprintsArchivedScope();
    const control = await screen.findByTestId("sprints-archived-scope");
    expect(control.getAttribute("data-value")).toBe("active");
  });
});

/**
 * @verifies DEG-30 / A138 (sprints broken-entry degradation)
 *
 * A sprint whose stored fields do not validate is lifted by the tolerant
 * loader into `broken` and rides `handleListSprints`. The panel must show
 * it as a marked, read-only row — never silently omit it — while the
 * healthy sprints still render. Before this the panel read only
 * `data.items`, so a corrupt sprint vanished with no notice.
 *
 * Red-proof: delete the `sprints-broken-list` block (or read `broken`
 * from nothing) and the "marker renders" assertion goes red while the
 * healthy-row assertion stays green — proving the marker is what is under
 * test, not the list itself.
 */
describe("SprintsPanel — broken-entry degradation (DEG-30)", () => {
  const WITH_BROKEN = {
    items: [
      { id: "sp_ok", name: "Healthy sprint", start_date: "2026-06-01", end_date: "2026-06-14", state: "active", taskCount: 0 },
    ],
    total: 1,
    offset: 0,
    limit: 500,
    broken: [
      { id: "sp_bad", index: 1, rawText: "name: 42\n", error: "name: Expected string, received number" },
    ],
  };

  function mockWithBroken(): void {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(WITH_BROKEN)));
  }

  it("renders a broken sprint as a marked row and keeps the healthy one", async () => {
    mockWithBroken();
    renderPanel();
    // The healthy sprint still renders...
    await screen.findByTestId("sprint-row-sp_ok");
    // ...and the corrupt one is shown as a marked, read-only row rather
    // than vanishing.
    const brokenRow = screen.getByTestId("sprint-broken-sp_bad");
    expect(brokenRow.getAttribute("aria-disabled")).toBe("true");
    expect(brokenRow.textContent).toContain("couldn't be read");
    expect(brokenRow.textContent).toContain("Expected string, received number");
  });

  it("does not read a lone broken sprint as an empty list", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({
        items: [],
        total: 0,
        offset: 0,
        limit: 500,
        broken: WITH_BROKEN.broken,
      })),
    );
    renderPanel();
    await screen.findByTestId("sprints-broken-list");
    // The "No sprints yet" empty state must NOT show — there IS a sprint,
    // it just could not be read.
    expect(screen.queryByTestId("sprints-empty")).toBeNull();
  });

  it("Repair refetches the sprints", async () => {
    mockWithBroken();
    renderPanel();
    const repair = await screen.findByTestId("sprint-broken-repair-sp_bad");
    const before = fetchMock.mock.calls.length;
    fireEvent.click(repair);
    await waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThan(before); });
  });
});

/**
 * @verifies N-4 / UI-10
 *
 * SprintsPanel already carried `settings-panel-title`, but its create
 * action sat in its own row below the description (not even sharing a
 * row with the archived-scope control), at a different height/position
 * than the title. Converged via the shared `SettingsPanelHeader`.
 */
describe("SprintsPanel header convergence (N-4)", () => {
  it("renders the canonical title markup via SettingsPanelHeader", async () => {
    renderPanel();

    const title = await screen.findByTestId("settings-panel-title");
    expect(title.tagName).toBe("H1");
    expect(title.textContent).toBe("Sprints");
    expect(title.className).toContain("text-text-primary");
  });

  it("puts the create action in the header row next to the title", async () => {
    renderPanel();

    const title = await screen.findByTestId("settings-panel-title");
    const createBtn = await screen.findByTestId("sprint-create-open");
    const header = title.closest("header");
    expect(header).not.toBeNull();
    expect(header?.contains(createBtn)).toBe(true);
  });
});
