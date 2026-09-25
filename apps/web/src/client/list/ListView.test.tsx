// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { listSearchSchema } from "../router/listSearch.ts";
import { ToastProvider } from "../ui/Toast.tsx";
import { ListView } from "./ListView.tsx";

/**
 * ListView calls `useCreateTask` (its empty state's "+ Add task" opens
 * the shared modal), so every mount wraps it in the same provider stack
 * the shell uses. ToastProvider is included so a test that actually
 * opens the modal — which itself calls `useToasts` — has it available;
 * for the tests that never open it, it is inert.
 */
function WrappedListView() {
  return (
    <ToastProvider>
      <CreateTaskProvider>
        <ListView />
      </CreateTaskProvider>
    </ToastProvider>
  );
}

/**
 * ListView tests. Stub fetch with a small task page + config data,
 * mount the real ListView under a memory router at /list, and assert
 * the table renders the columns, resolves enum/id values to labels,
 * and that clicking a sortable header navigates with the right
 * sort/dir search state (and toggles direction on a second click).
 */

const TASKS = {
  items: [
    {
      id: "01TASKAAAA0000000000000000",
      key: "WEB-1",
      project: "p_web",
      title: "First task",
      status: "in_progress",
      priority: "high",
      task_type: "feature",
      assignee: "u_ken",
      labels: ["l_fe"],
      due_date: "2026-06-20",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-07T00:00:00.000Z",
    },
  ],
  total: 1,
  offset: 0,
  limit: 50,
};

/** Set to make /api/tasks report a dropped saved view (XS-28). */
let MISSING_VIEW: string | undefined;

/**
 * Set to replace the /api/tasks page wholesale — used by the corruption
 * cases (S3), which need a row carrying `health` and/or no title. Kept
 * separate from `TASKS` so the default cases are unaffected.
 */
let TASKS_OVERRIDE: unknown;

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/tasks")) {
    if (TASKS_OVERRIDE !== undefined) return TASKS_OVERRIDE;
    return MISSING_VIEW === undefined ? TASKS : { ...TASKS, missing_view: MISSING_VIEW };
  }
  if (path.startsWith("/api/projects")) {
    return { items: [{ id: "p_web", name: "Web", prefix: "WEB-" }], total: 1, offset: 0, limit: 100, default: "p_web" };
  }
  if (path.startsWith("/api/users")) {
    return { items: [{ id: "u_ken", name: "Ken Loh", timezone: "UTC" }], total: 1, offset: 0, limit: 100, current: "u_ken" };
  }
  if (path.startsWith("/api/labels")) {
    return { items: [{ id: "l_fe", name: "frontend", color: "#1e6fcb" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: [{ key: "in_progress", label: "In progress", category: "active" }],
      priorities: [{ key: "high", label: "High" }],
      task_types: [{ key: "feature", label: "Feature" }],
      relationships: [],
      custom_fields: [],
    };
  }
  if (path.startsWith("/api/user-settings")) {
    return { user: "u_ken", settings: {} };
  }
  return {};
}

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

async function mountList(initialSearch = "", settleText = "First task") {
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: WrappedListView,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: [`/list${initialSearch}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByText(settleText);
  return router;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  MISSING_VIEW = undefined;
  TASKS_OVERRIDE = undefined;
});

describe("ListView", () => {
  // U13 / K-title rule
  it("shows the screen name as the page title when nothing is scoped", async () => {
    await mountList();
    const header = screen.getByTestId("list-page-header");
    expect(within(header).getByText("List")).toBeTruthy();
  });

  it("titles the page with a single scoped project's name (U13)", async () => {
    // /api/projects stubs p_web = "Web"; scoping to it makes it the title.
    await mountList("?project=p_web");
    const header = screen.getByTestId("list-page-header");
    expect(within(header).getByText("Web")).toBeTruthy();
    expect(within(header).queryByText("List")).toBeNull();
  });

  it("keeps the project title as more filters are added (U13)", async () => {
    // A project scope + a status filter still titles by the project — the
    // added filter does not touch `project`.
    await mountList("?project=p_web&status=in_progress");
    expect(within(screen.getByTestId("list-page-header")).getByText("Web")).toBeTruthy();
  });

  it("falls back to the screen name when several projects are scoped (U13)", async () => {
    await mountList("?project=p_web&project=p_other");
    const header = screen.getByTestId("list-page-header");
    expect(within(header).getByText("List")).toBeTruthy();
  });

  // @verifies LST-2
  it("renders the row with resolved labels for enum/id values", async () => {
    await mountList();
    const row = (await screen.findByText("First task")).closest("tr") as HTMLElement;
    const cells = within(row);
    expect(cells.getByText("WEB-1")).toBeTruthy(); // key
    expect(cells.getByText("WEB")).toBeTruthy(); // project chip (prefix)
    expect(cells.getByText("In progress")).toBeTruthy(); // status label
    expect(cells.getByText("High")).toBeTruthy(); // priority label
    expect(cells.getByText("Feature")).toBeTruthy(); // type label
    expect(cells.getByText("Ken")).toBeTruthy(); // assignee first name
    expect(cells.getByText("frontend")).toBeTruthy(); // label name
  });

  // Mobile (< sm) card layout (UX eval #3). The card list renders
  // alongside the table (CSS decides which is visible); jsdom does not
  // evaluate the breakpoint, so this asserts the cards exist in the DOM
  // and carry the same per-task data as the table — key, title, status —
  // and that each card is a link target. The `sm:hidden` / `hidden
  // sm:block` split is what actually shows one or the other at runtime.
  it("renders a stacked card per task for the mobile layout, mirroring the table data", async () => {
    // Drive the narrow (< sm) layout: useIsNarrow reads innerWidth when
    // matchMedia is unavailable (jsdom). At 375px the cards render and the
    // table does not, so `getByText` stays unambiguous.
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      await mountList();
      const cards = await screen.findByTestId("task-cards");
      const firstCard = within(cards).getByTestId("task-card-WEB-1");
      // Same fields as the table row: key, title, and the status label.
      expect(within(firstCard).getByText("First task")).toBeTruthy();
      expect(within(firstCard).getByText("WEB-1")).toBeTruthy();
      expect(within(firstCard).getByText("In progress")).toBeTruthy();
      // A per-card select checkbox, like the table row.
      expect(within(firstCard).getByLabelText("Select WEB-1")).toBeTruthy();
      // The table layout is NOT in the DOM at this width (single source).
      expect(screen.queryByRole("table")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  // K-15 (a UI-review item, not a numbered case — no @verifies tag): the
  // list row-hover fix. Guards against the regression Ken reported (the
  // ID/Project cells not highlighting on hover, and chip backgrounds
  // dissolving into the hover) so a future change to the hover selector
  // or token is caught here rather than by eye.
  it("row hover uses a subtle row-hover token, distinct from the chip background, and covers the whole row", async () => {
    await mountList();
    const row = (await screen.findByText("First task")).closest("tr") as HTMLElement;
    const cls = row.className;

    // The hover targets EVERY direct cell child (`[&>*]`), not only
    // `[&>td]` — the key column is a `<th scope="row">`, so a `td`-only
    // selector left the ID/Project cells un-highlighted on hover (K-15,
    // Ken's report). And it uses the dedicated `bg-bg-row-hover` token,
    // NOT `bg-bg-muted`: the chips inside the row paint themselves with
    // `bg-bg-muted`, so a row-hover reusing that token made them vanish
    // into the hover. Distinct tokens keep the chip legible.
    expect(cls).toContain("hover:[&>*]:bg-bg-row-hover");
    expect(cls).not.toContain("hover:[&>td]:bg-bg-muted");
    expect(cls).not.toContain("hover:[&>*]:bg-bg-muted ");

    // The row header (the key cell) is a real `<th scope="row">` inside
    // that hover-targeted row, so it is now included in the highlight.
    const keyHeader = within(row).getByText("WEB-1").closest("th") as HTMLElement;
    expect(keyHeader.getAttribute("scope")).toBe("row");

    // The project chip keeps its own `bg-bg-muted` background — a
    // different token from the row hover — so it does not dissolve.
    const chip = within(row).getByTestId("project-chip");
    expect(chip.className).toContain("bg-bg-muted");
  });

  // @verifies K26 (untitled task title fallback)
  // @verifies DEG-8
  it("renders a task with no title by its key, not a blank cell", async () => {
    TASKS_OVERRIDE = {
      items: [{
        id: "01TASKBBBB0000000000000000",
        key: "WEB-9",
        project: "p_web",
        // title deliberately absent — a corrupt/absent title still loads
        // the task (K26), so the title cell must fall back to the key.
        status: "in_progress",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-07T00:00:00.000Z",
      }],
      total: 1,
      offset: 0,
      limit: 50,
    };
    // Settle on the status label (unique on the page); the key "WEB-9"
    // appears twice — the key cell and the title fallback — so it is not
    // a safe settle target.
    await mountList("", "In progress");
    const row = screen.getByText("In progress").closest("tr") as HTMLElement;
    const titleCell = row.querySelector('[data-col="title"]') as HTMLElement;
    // The title cell is NOT blank — it shows the key as a fallback.
    expect(titleCell.textContent).toContain("WEB-9");
  });

  // @verifies LST-20
  /**
   * A 400-character unbroken title must not widen the table.
   *
   * jsdom has no layout engine, so the overflow itself cannot be
   * measured here — the e2e spec (`LST-20: a 400-character title
   * truncates without scrolling the table`) is what measures it, and it
   * failed by 66px before this. What CAN be pinned below that gate is
   * the rule the measurement depends on: the title cell's width must be
   * derived from the table, never from its own content.
   *
   * `max-width: 0` is what makes the cell's intrinsic contribution zero,
   * so the auto table layout sizes every other column first and the
   * title takes only the leftover (`width: 100%`). The old guard was a
   * `max-w-[42ch]` on the inner span — content-derived, ~354px, and so
   * still 66px too wide at the tested viewport. A narrower `ch` value
   * would only move the breakpoint, which is why the assertion below
   * rejects ANY `ch`/`px` cap rather than a particular one.
   */
  it("LST-20: bounds a pathological title against the table, not against its own content", async () => {
    const long = "x".repeat(400);
    TASKS_OVERRIDE = {
      items: [{
        id: "01TASKCCCC0000000000000000",
        key: "WEB-11",
        project: "p_web",
        title: long,
        status: "in_progress",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-07T00:00:00.000Z",
      }],
      total: 1,
      offset: 0,
      limit: 50,
    };
    await mountList("", "In progress");
    const row = screen.getByText("In progress").closest("tr") as HTMLElement;
    const titleCell = row.querySelector('[data-col="title"]') as HTMLElement;

    // The cell absorbs the leftover width and contributes nothing to the
    // table's preferred width.
    expect(titleCell.className).toContain("max-w-0");
    expect(titleCell.className).toContain("w-full");

    // And nothing inside it re-introduces a content-derived cap — a
    // `max-w-[NNch]` or `max-w-[NNpx]` anywhere in the subtree is exactly
    // the magic number this replaces, and would put the breakpoint back.
    const capped = [titleCell, ...titleCell.querySelectorAll("*")]
      .map(el => (el as HTMLElement).className)
      .filter(c => typeof c === "string" && /max-w-\[\d+(?:\.\d+)?(?:ch|px|rem)\]/.test(c));
    expect(capped).toEqual([]);

    // Truncation is visual only: the stored value is untouched and the
    // whole string is on hover (the case's second bullet).
    expect(titleCell.textContent).toBe(long);
    expect(row.querySelector(`[title="${long}"]`)).not.toBeNull();
  });

  // @verifies A137 / A137.1 (per-row health marker in the list)
  // @verifies DEG-31 (UX-11: a corrupt task also carries a marker in the List view)
  it("marks a degraded field on a row that carries health", async () => {
    TASKS_OVERRIDE = {
      items: [{
        id: "01TASKCCCC0000000000000000",
        key: "WEB-7",
        project: "p_web",
        title: "Corrupt status task",
        // `status` is absent from frontmatter (lifted into health) — an
        // intrinsic wrong_type fault.
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-07T00:00:00.000Z",
        health: [{
          field: "status",
          kind: "wrong_type",
          rawText: "42",
          error: "status must be a string",
          repair: "set_or_remove",
        }],
      }],
      total: 1,
      offset: 0,
      limit: 50,
    };
    await mountList("", "Corrupt status task");
    const row = screen.getByText("Corrupt status task").closest("tr") as HTMLElement;
    // The corruption is VISIBLE, not hidden: the raw value and the
    // broken marker both render in the status cell.
    expect(within(row).getByText(/\(broken\)/)).toBeTruthy();
    expect(row.querySelector('[data-testid="field-health-status"]')).toBeTruthy();
    expect(within(row).getByText("42")).toBeTruthy();
  });

  // @verifies ERR-9 (an object-fatally unreadable task still surfaces)
  // @verifies DEG-1
  it("still lists an unreadable task in the affordance and does not crash", async () => {
    TASKS_OVERRIDE = {
      items: [{
        id: "01TASKAAAA0000000000000000",
        key: "WEB-1",
        project: "p_web",
        title: "First task",
        status: "in_progress",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-07T00:00:00.000Z",
      }],
      total: 1,
      offset: 0,
      limit: 50,
      unreadable: [{ id: "01BAD0000000000000000000AA", path: ".loctt/tasks/01BAD.../task.md", reason: "bad indentation" }],
    };
    await mountList("", "First task");
    // The unreadable affordance names the file and reason…
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.getByText(/bad indentation/)).toBeTruthy();
    // …and the readable row still renders (the list did not crash).
    expect(screen.getByText("First task")).toBeTruthy();
  });

  // @verifies LST-2
  it("renders the ten default column headers (reporter is opt-in, K24)", async () => {
    await mountList();
    for (const h of ["Key", "Project", "Title", "Status", "Priority", "Type", "Assignee", "Labels", "Due", "Updated"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h) })).toBeTruthy();
    }
    // K24: reporter is not a default column, so its header is absent
    // until the user adds it via list_columns.
    expect(screen.queryByRole("columnheader", { name: /Reporter/ })).toBeNull();
  });

  // @verifies LST-3
  it("clicking a sortable header sorts ascending, then toggles to descending", async () => {
    const router = await mountList();

    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    await vi.waitFor(() => {
      const s = router.state.location.search as { sort?: string; dir?: string };
      expect(s.sort).toBe("title");
      expect(s.dir).toBe("asc");
    });
    // The header reflects the ascending sort via aria-sort.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Title/ }).getAttribute("aria-sort"),
      ).toBe("ascending"),
    );

    // Re-query the (re-rendered) header before the second click so the
    // bound handler reads the latest sort direction.
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    await vi.waitFor(() => {
      const s = router.state.location.search as { dir?: string };
      expect(s.dir).toBe("desc");
    });
  });

  it("resets to ascending when switching to a different sort column", async () => {
    const router = await mountList("?sort=updated_at&dir=desc");
    // Currently sorted by Updated desc; click Title → new column, asc.
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    await vi.waitFor(() => {
      const s = router.state.location.search as { sort?: string; dir?: string };
      expect(s.sort).toBe("title");
      expect(s.dir).toBe("asc");
    });
  });

  // @verifies LST-54
  it("first click on Priority sorts descending — Critical-first, not Low-first", async () => {
    const router = await mountList();

    // The server orders priority by the workflow's numeric `value`
    // (critical=4 … low=1), so ascending buries Critical. UX-2: the
    // first click on Priority must land the most-useful direction —
    // Critical-first — which is `dir=desc`, not the generic `asc`.
    // Scope to the Priority *column header's* sort button — a "Filter
    // Priority" facet dropdown button also matches /Priority/.
    const prioHeader = (): HTMLElement =>
      within(screen.getByRole("columnheader", { name: /Priority/ })).getByRole("button");
    fireEvent.click(prioHeader());
    await vi.waitFor(() => {
      const s = router.state.location.search as { sort?: string; dir?: string };
      expect(s.sort).toBe("priority");
      expect(s.dir).toBe("desc");
    });

    // The direction is legible on the header: aria-sort reads
    // "descending" for the Critical-first order.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Priority/ }).getAttribute("aria-sort"),
      ).toBe("descending"),
    );

    // A second click still toggles — back to ascending (Low-first).
    fireEvent.click(prioHeader());
    await vi.waitFor(() => {
      const s = router.state.location.search as { dir?: string };
      expect(s.dir).toBe("asc");
    });
  });

  it("falls back to raw values for ids/keys that no longer resolve", async () => {
    // Task references a deleted assignee, label, and unknown status —
    // the row must still render without crashing.
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      let body: unknown = routeFetch(path);
      if (path.startsWith("/api/tasks")) {
        body = {
          items: [{
            id: "01TASKBBBB0000000000000000",
            key: "WEB-2",
            title: "Orphan refs",
            status: "ghost_status",
            assignee: "u_deleted_0000000000",
            labels: ["l_gone"],
            created_at: "2026-06-01T00:00:00.000Z",
            updated_at: "2026-06-07T00:00:00.000Z",
          }],
          total: 1, offset: 0, limit: 50,
        };
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute();
    const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema, component: WrappedListView });
    const router = createRouter({ routeTree: rootRoute.addChildren([listRoute]), history: createMemoryHistory({ initialEntries: ["/list"] }) });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    const row = (await screen.findByText("Orphan refs")).closest("tr") as HTMLElement;
    const cells = within(row);
    // Unknown status key renders the raw key, not a blank.
    expect(cells.getByText("ghost_status")).toBeTruthy();
    // A user the tracker no longer knows degrades to a diagnostic form.
    //
    // K22 (2026-09-05) amended P-4 for exactly this error state: the
    // dangling reference now shows its truncated ULID tail *plus*
    // "(deleted user)" (PRU-25), because there the id is the only
    // remaining handle on which referent broke. This test asserted the
    // pre-K22 "unknown user" wording (which hid the id); that expectation
    // is now the wrong behaviour, so per CLAUDE.md it is updated here.
    expect(cells.getByText(/\(deleted user\)/)).toBeTruthy();
    // The truncated tail (last 6 chars of "u_deleted_0000000000").
    expect(cells.getByText("000000")).toBeTruthy();
    // The full id is still never shown — only the truncated tail.
    expect(row.textContent).not.toContain("u_deleted_0000000000");
    expect(cells.queryByText("unknown user")).toBeNull();
  });

  it("renders the empty state when no tasks match", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const body = path.startsWith("/api/tasks") ? { items: [], total: 0, offset: 0, limit: 50 } : routeFetch(path);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute();
    const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema, component: WrappedListView });
    const router = createRouter({ routeTree: rootRoute.addChildren([listRoute]), history: createMemoryHistory({ initialEntries: ["/list?status=done"] }) });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    // Mounted *with* a filter. This previously loaded a bare `/list`
    // and asserted the filtered-empty copy, which was the wrong screen
    // for an unfiltered empty tracker — ONB-8 wants "No tasks found."
    // (K129) and no suggestion to clear filters the user never set. Per
    // CLAUDE.md a fix that requires editing a green test means that
    // test was asserting the bug.
    expect(await screen.findByText(/No tasks match these filters/)).toBeTruthy();
  });

  // First-run / ONB-8: the truly-empty list (no tasks AND no filters) is
  // a newcomer's landing. It must be actionable — a create button that
  // opens the same modal the board/header open — not a dead-end
  // sentence. Wrapped in the app-wide CreateTaskProvider (as the shell
  // does) so `useCreateTask` resolves to the real modal.
  function mountEmptyList(initialSearch: string) {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const body = path.startsWith("/api/tasks") ? { items: [], total: 0, offset: 0, limit: 50 } : routeFetch(path);
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute();
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/list",
      validateSearch: listSearchSchema,
      component: WrappedListView,
    });
    const router = createRouter({ routeTree: rootRoute.addChildren([listRoute]), history: createMemoryHistory({ initialEntries: [`/list${initialSearch}`] }) });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
  }

  it("truly-empty list shows a create button that opens the modal (first-run)", async () => {
    mountEmptyList("");
    const add = await screen.findByTestId("list-empty-add-task");
    // K129 pass: "No tasks yet. Create your first one to get started."
    // became "No tasks found." — the create button beside it is the
    // affordance now, per Ken's empty-state ruling.
    expect(screen.getByText(/No tasks found/)).toBeTruthy();
    // No filter is active, so the Clear-filters affordance is absent —
    // that belongs to a filtered-empty view, not a fresh tracker.
    expect(screen.queryByText(/Clear filters/)).toBeNull();
    // The button opens the shared create modal (same entry point the
    // board's "+ Add task" uses).
    expect(screen.queryByTestId("create-task-modal")).toBeNull();
    fireEvent.click(add);
    expect(await screen.findByTestId("create-task-modal")).toBeTruthy();
  });

  it("filtered-empty list shows Clear filters and NOT a create button", async () => {
    mountEmptyList("?status=done");
    expect(await screen.findByText(/No tasks match these filters/)).toBeTruthy();
    expect(screen.getByText(/Clear filters/)).toBeTruthy();
    // Creating a task would not bring back rows the filter hid, so the
    // create CTA is deliberately absent here.
    expect(screen.queryByTestId("list-empty-add-task")).toBeNull();
  });

  // Cross-view layout standardisation (commit 02b05cd): the ListView root
  // container uses the shared `p-4` / `gap-3` rhythm, NOT the older
  // `p-6` / `gap-4`. A silent bump back to p-6 would desync it from Board
  // and Timeline (which this same rule pins) with nothing to catch it.
  // The root is the parent of the FilterBar's own root; `add-filter` sits
  // inside FilterBar, so its nearest `.flex-col` ancestor is the FilterBar
  // root and that root's parent is the ListView container.
  it("uses the shared p-4/gap-3 layout rhythm on its root container", async () => {
    await mountList();
    const filterBarRoot = screen.getByTestId("add-filter").closest("div.flex-col");
    expect(filterBarRoot).not.toBeNull();
    const listRoot = filterBarRoot?.parentElement as HTMLElement;
    expect(listRoot.className).toContain("p-4");
    expect(listRoot.className).toContain("gap-3");
    // Guard against the specific regression: the pre-standardisation values.
    expect(listRoot.className).not.toContain("p-6");
    expect(listRoot.className).not.toContain("gap-4");
  });
});

/**
 * Pagination. A paged fetch stub so "Load more" has something to
 * append, and a failing one so the error path is reachable.
 */
function stubPagedFetch(opts: { total: number; failFrom?: number } = { total: 128 }) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/tasks")) {
      const sp = new URLSearchParams(path.split("?")[1] ?? "");
      const offset = Number(sp.get("offset") ?? 0);
      const limit = Number(sp.get("limit") ?? 50);
      if (opts.failFrom !== undefined && offset >= opts.failFrom) {
        // A rejected promise, not a 500: this is what an offline
        // browser actually does, and it takes a different path through
        // apiClient than an error response.
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      const items = Array.from(
        { length: Math.max(0, Math.min(limit, opts.total - offset)) },
        (_, i) => ({
          id: `01TASK${String(offset + i).padStart(20, "0")}`,
          key: `WEB-${offset + i + 1}`,
          project: "p_web",
          title: `Task ${offset + i + 1}`,
          status: "in_progress",
          priority: "high",
          task_type: "feature",
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-07T00:00:00.000Z",
        }),
      );
      return Promise.resolve(
        new Response(JSON.stringify({ items, total: opts.total, offset, limit }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

function mountPaged(
  opts: { total: number; failFrom?: number },
  initialSearch = "",
) {
  stubPagedFetch(opts);
  // retry: 1 mirrors the real app (api/queryClient.ts). Under
  // retry: false the error surfaces immediately, which hid a real
  // difference when this was first written.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0, gcTime: 0 } } });
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: listSearchSchema,
    component: WrappedListView,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: [`/list${initialSearch}`] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

describe("ListView pagination", () => {
  // @verifies LST-13
  it("reports an honest count against the filtered total", async () => {
    mountPaged({ total: 128 });
    // 128 is the matching total, not the tracker's task count, and 50
    // is what is actually rendered.
    expect(await screen.findByText("Showing 1–50 of 128")).toBeTruthy();
    expect(screen.getAllByRole("row").length - 1).toBe(50);
  });

  // @verifies LST-13
  it("appends the next page rather than replacing the current one", async () => {
    mountPaged({ total: 128 });
    await screen.findByText("Showing 1–50 of 128");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Showing 1–100 of 128")).toBeTruthy();
    // Page 1's first row is still present: appended, not replaced.
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText("Task 51")).toBeTruthy();
    expect(screen.getAllByRole("row").length - 1).toBe(100);
  });

  // @verifies LST-13
  it("drops the control once every row is loaded", async () => {
    mountPaged({ total: 60 });
    await screen.findByText("Showing 1–50 of 60");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Showing 1–60 of 60")).toBeTruthy();

    // Its absence is the signal that the list is exhausted, which is
    // why LST-49 requires it to *stay* on failure.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  // @verifies LST-49
  it("a failed Load more keeps the count, the rows, and the control", async () => {
    mountPaged({ total: 128, failFrom: 50 });
    await screen.findByText("Showing 1–50 of 128");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    // The error names the failure...
    expect(await screen.findByRole("alert")).toBeTruthy();
    // ...the count does not advance to imply rows arrived...
    expect(screen.getByText("Showing 1–50 of 128")).toBeTruthy();
    // ...already-loaded rows survive...
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getAllByRole("row").length - 1).toBe(50);
    // ...and the control remains, offering retry rather than looking
    // like genuine exhaustion.
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  // @verifies LST-43
  it("paginates a query that matches every task", async () => {
    mountPaged({ total: 5000 });
    // The browser is not asked to render 5,000 rows at once.
    expect(await screen.findByText("Showing 1–50 of 5000")).toBeTruthy();
    expect(screen.getAllByRole("row").length - 1).toBe(50);
  });

  // @verifies LST-30
  it("keeps the footer honest when the URL asks for a clamped limit", async () => {
    // ?limit=99999 clamps to the schema max of 200; the footer must
    // agree with what is rendered rather than echo the request.
    mountPaged({ total: 128 }, "?limit=99999");
    expect(await screen.findByText("Showing 1–128 of 128")).toBeTruthy();
    expect(screen.getAllByRole("row").length - 1).toBe(128);
  });
});

/**
 * Mobile (< sm) card layout: loading and error branches.
 *
 * The desktop `<table>` had a three-way split (skeleton / ErrorState /
 * empty), but the narrow `<ul>` card layout rendered results with NO
 * loading and NO error branch — a failed initial fetch fell straight
 * through to "No tasks match these filters" / "No tasks found.", which reads
 * as data loss on a phone (ERR-1). These assert the card layout now
 * matches the table's handling. Both are red-proven: on the pre-fix code
 * the empty copy rendered and neither the error nor the skeleton existed.
 */
describe("ListView mobile card layout — loading and error", () => {
  const NARROW = 375;

  // This describe sits outside the top `describe("ListView")`; make its
  // cleanup explicit so a mounted tree never straddles into the next test.
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  async function atNarrow(fn: () => Promise<void>): Promise<void> {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: NARROW });
    try {
      await fn();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  }

  // A tasks stub whose /api/tasks response is controlled by `tasksResult`
  // (a rejected promise for the error case, a never-settling promise for
  // the loading case); config requests resolve normally so the rest of the
  // shell mounts.
  function stubTasks(tasksResult: () => Promise<Response>) {
    vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path.startsWith("/api/tasks")) {
        return tasksResult();
      }
      return Promise.resolve(
        new Response(JSON.stringify(routeFetch(path)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch);
  }

  function mountRaw(initialSearch = "") {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const rootRoute = createRootRoute();
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/list",
      validateSearch: listSearchSchema,
      component: WrappedListView,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([listRoute]),
      history: createMemoryHistory({ initialEntries: [`/list${initialSearch}`] }),
    });
    // Return the RTL result so each test scopes its queries to its OWN
    // container (`within(result.container)`) rather than the whole
    // document — this describe has no per-test cleanup of its own, and a
    // document-wide query would otherwise trip over a sibling test's
    // not-yet-unmounted tree.
    return render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
  }

  // @verifies ERR-1 (a failed load must not read as an empty list)
  it("shows the load error, not the empty copy, when the initial fetch fails", async () => {
    await atNarrow(async () => {
      // A rejected /api/tasks (offline-style, like the desktop table's
      // guard) with retry:false, so the error is immediate and
      // deterministic.
      // A rejected /api/tasks (offline-style) with retry:false, so the
      // error is immediate and deterministic — mirrors the desktop table's
      // guard.
      stubTasks(() => Promise.reject(new TypeError("Failed to fetch")));
      const { container } = mountRaw();
      const view = within(container);

      // The card layout renders the error surface...
      const errorHost = await view.findByTestId("task-cards-error", undefined, { timeout: 3000 });
      expect(within(errorHost).getByText("Could not load tasks")).toBeTruthy();
      // ...and does NOT fall through to either empty message. This is the
      // pre-fix bug: a down server read as "no tasks".
      expect(view.queryByText(/No tasks match these filters/i)).toBeNull();
      expect(view.queryByText(/No tasks found/i)).toBeNull();
    });
  });

  // @verifies ONB-12 (a load in progress shows placeholders, not empty)
  it("shows a skeleton, not the empty state, while the initial fetch is in flight", async () => {
    await atNarrow(async () => {
      // /api/tasks never settles, so the feed stays in its loading state.
      stubTasks(() => new Promise<Response>(() => { /* never resolves */ }));
      const { container } = mountRaw();
      const view = within(container);

      // Placeholder cards appear while loading...
      expect((await view.findAllByTestId("task-card-skeleton")).length).toBeGreaterThan(0);
      // ...and the empty copy is NOT shown (the pre-fix bug: loading read
      // as "no tasks yet").
      expect(view.queryByText(/No tasks found/i)).toBeNull();
      expect(view.queryByText(/No tasks match these filters/i)).toBeNull();
    });
  });
});

// Q4: there is no manual refresh button (removed; freshness is TanStack
// Query staleTime + focus refetch). The former "ListView manual refresh"
// block and its XS-3 window-stated-on-the-control assertions went with it.

/**
 * @verifies XS-28
 *
 * A view deleted from `queries.yaml` under a live tab. The rows still
 * render — the case forbids an error page and forbids an empty table
 * implying zero tasks — but the widening is *stated*, because a silent
 * fallback is indistinguishable from an ordinary unfiltered list.
 *
 * SHL-32 is deliberately NOT claimed here. It asks for the *sidebar*
 * to explain a pin that vanished, dismissibly — and the sidebar reads
 * `/api/views`, which simply omits a deleted view. Nothing tells the
 * client the entry was ever there. Detecting it needs a record of
 * which views the sidebar has shown, which is behaviour no case
 * specifies; that belongs to whoever owns the pinning feature, not to
 * this fix. The active-view half of SHL-32 is what lands here.
 */
describe("ListView with a deleted saved view", () => {
  it("renders the rows and explains that the view is gone", async () => {
    MISSING_VIEW = "v_gone";
    await mountList("?view=v_gone");

    // Not an error page, and not an empty table.
    expect(screen.getByText("First task")).toBeTruthy();

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("v_gone");
    expect(notice.textContent).toMatch(/no longer exists/i);
    // K129 pass: "It was probably deleted from .loctt/config/queries.yaml"
    // was trimmed as speculation the user cannot act on differently
    // (messaging.md §1); the notice now states only what happened and
    // what the app is doing about it.
    expect(notice.textContent).toContain("Showing every task instead");
    // It is an explanation, not an error — P7's distinction.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers to drop the stale view from the URL", async () => {
    MISSING_VIEW = "v_gone";
    const router = await mountList("?view=v_gone");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Drop it from the URL/ }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty("view");
    });
  });

  it("says nothing when the view still exists", async () => {
    await mountList("?view=v_live");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
