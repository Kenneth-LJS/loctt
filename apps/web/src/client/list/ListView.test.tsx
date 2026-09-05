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

import { listSearchSchema } from "../router/listSearch.ts";
import { ListView } from "./ListView.tsx";

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
    component: ListView,
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

  // @verifies K26 (untitled task title fallback)
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

  // @verifies A137 / A137.1 (per-row health marker in the list)
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
    const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema, component: ListView });
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
    const listRoute = createRoute({ getParentRoute: () => rootRoute, path: "/list", validateSearch: listSearchSchema, component: ListView });
    const router = createRouter({ routeTree: rootRoute.addChildren([listRoute]), history: createMemoryHistory({ initialEntries: ["/list?status=done"] }) });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    // Mounted *with* a filter. This previously loaded a bare `/list`
    // and asserted the filtered-empty copy, which was the wrong screen
    // for an unfiltered empty tracker — ONB-8 wants "No tasks yet" and
    // no suggestion to clear filters the user never set. Per CLAUDE.md
    // a fix that requires editing a green test means that test was
    // asserting the bug.
    expect(await screen.findByText(/No tasks match these filters/)).toBeTruthy();
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
    component: ListView,
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
 * @verifies XS-3
 *
 * The tracker has three writers — this UI, the CLI, and the MCP
 * server — so "I just changed that in the terminal" is the ordinary
 * case. Automatic refresh bounds how stale a value can get; this is
 * the control for when the user already knows.
 */
describe("ListView manual refresh", () => {
  it("offers a top-level refresh that refetches and reports itself busy", async () => {
    await mountList();

    const before = vi.mocked(globalThis.fetch).mock.calls.filter(c =>
      typeof c[0] === "string" && c[0].includes("/api/tasks"),
    ).length;
    expect(before).toBeGreaterThan(0);

    // Reachable directly, not behind a menu.
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh.getAttribute("title")).toMatch(/refresh/i);

    await act(async () => {
      fireEvent.click(refresh);
      await Promise.resolve();
    });

    // It never silently no-ops: a request actually goes out.
    await waitFor(() => {
      const after = vi.mocked(globalThis.fetch).mock.calls.filter(c =>
        typeof c[0] === "string" && c[0].includes("/api/tasks"),
      ).length;
      expect(after).toBeGreaterThan(before);
    });

    // And it settles rather than staying busy forever.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Refresh" }).getAttribute("aria-busy"),
      ).toBe("false");
    });
  });

  /**
   * @verifies XS-3
   *
   * The staleness window is *stated*, not described as "eventually" —
   * XS-2's requirement, surfaced where a user would look for it.
   */
  it("states the automatic refresh window on the control", async () => {
    await mountList();
    const title = screen.getByRole("button", { name: "Refresh" }).getAttribute("title") ?? "";
    expect(title).toMatch(/\d+ seconds/);
    expect(title).toMatch(/return to the tab/i);
  });
});

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
    expect(notice.textContent).toContain("queries.yaml");
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
