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
    return Promise.resolve(jsonResponse(SPRINTS));
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

describe("SprintsPanel — create (SPR-40)", () => {
  // @verifies SPR-40
  it("POSTs name, dates and state to /api/sprints", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");

    fireEvent.change(screen.getByTestId("sprint-create-name"), { target: { value: "Sprint Z" } });
    fireEvent.change(screen.getByTestId("sprint-create-start"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("sprint-create-end"), { target: { value: "2026-07-14" } });
    fireEvent.change(screen.getByTestId("sprint-create-state"), { target: { value: "future" } });
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
    const submit = screen.getByTestId<HTMLButtonElement>("sprint-create-submit");
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("sprint-create-name"), { target: { value: "Z" } });
    expect(submit.disabled).toBe(true); // dates still empty
    fireEvent.change(screen.getByTestId("sprint-create-start"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("sprint-create-end"), { target: { value: "2026-07-14" } });
    expect(submit.disabled).toBe(false);
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

describe("SprintsPanel — archived split (SPR-40)", () => {
  // @verifies SPR-40
  it("hides archived sprints until 'show archived' is toggled", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");

    // The archived sprint is not in the active list.
    expect(screen.queryByTestId("sprint-row-sp_arch")).toBeNull();
    // The toggle names how many are hidden.
    fireEvent.click(screen.getByTestId("sprints-show-archived"));
    expect(screen.getByTestId("sprint-row-sp_arch")).toBeTruthy();
    expect(screen.getByTestId("sprint-row-sp_arch").getAttribute("data-sprint-archived")).toBe("true");
  });
});

describe("SprintsPanel — archive (SPR-40)", () => {
  // @verifies SPR-40
  it("POSTs to the archive route and moves the row into the archived split", async () => {
    // Stateful list: once the active sprint is archived, the refetch
    // reports it archived, so we can watch the row leave the active list.
    let archived = false;
    fetchMock.mockImplementation((url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (u.includes("/api/sprints/sp_active/archive") && method === "POST") {
        archived = true;
        return Promise.resolve(jsonResponse({ archived: "sp_active" }));
      }
      const items = SPRINTS.items.map(s =>
        s.id === "sp_active" ? { ...s, archived } : s,
      );
      return Promise.resolve(jsonResponse({ ...SPRINTS, items }));
    });

    renderPanel();
    await screen.findByTestId("sprints-list");
    // Active sprint present, not yet archived.
    expect(screen.getByTestId("sprint-row-sp_active").getAttribute("data-sprint-archived")).toBe("false");

    // The active row's Archive button (the archived row is hidden).
    openSprintAction("sprint-archive-toggle");

    // The hook fired at the right route.
    await waitFor(() => { expect(fetchMock.mock.calls.some(c =>
      String(c[0]).includes("/api/sprints/sp_active/archive")
      && (c[1] as RequestInit | undefined)?.method === "POST",
    )).toBe(true); });

    // After the invalidation refetch, sp_active drops out of the active
    // list — it moved to the archived split.
    await waitFor(() => { expect(screen.queryByTestId("sprint-row-sp_active")).toBeNull(); });
    // It is now behind the "show archived" toggle.
    fireEvent.click(screen.getByTestId("sprints-show-archived"));
    expect(screen.getByTestId("sprint-row-sp_active").getAttribute("data-sprint-archived")).toBe("true");
  });

  // @verifies SPR-40
  it("POSTs to the unarchive route for an already-archived sprint", async () => {
    renderPanel();
    await screen.findByTestId("sprints-list");
    // Reveal the archived sprint, whose button reads "Unarchive".
    fireEvent.click(screen.getByTestId("sprints-show-archived"));

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
  it("auto-enables 'Show archived' when the hash names an archived sprint, so the anchor resolves", async () => {
    // A deep link to an archived sprint. Its row is normally hidden until
    // the toggle is on; the panel must flip the toggle so the target
    // mounts and useScrollToHash can find it.
    renderPanel("/#row-sp_arch");
    await screen.findByTestId("sprints-list");

    // The archived row is now present without the user touching the toggle.
    const archivedRow = await screen.findByTestId("sprint-row-sp_arch");
    expect(archivedRow.getAttribute("id")).toBe("row-sp_arch");
    expect(archivedRow.getAttribute("data-sprint-archived")).toBe("true");
    // And the toggle reflects the auto-enabled state.
    const toggle = screen.getByTestId<HTMLInputElement>("sprints-show-archived");
    expect(toggle.checked).toBe(true);
  });

  // @verifies K100
  it("leaves 'Show archived' off when the hash names an ACTIVE sprint", async () => {
    // Guard: the auto-reveal must fire only for archived targets, not any
    // hash — an active-sprint deep link must not force the archived split open.
    renderPanel("/#row-sp_active");
    await screen.findByTestId("sprints-list");

    expect(screen.queryByTestId("sprint-row-sp_arch")).toBeNull();
    const toggle = screen.getByTestId<HTMLInputElement>("sprints-show-archived");
    expect(toggle.checked).toBe(false);
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
