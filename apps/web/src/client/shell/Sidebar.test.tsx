// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comboValue, pickCombo } from "../ui/selectComboboxTestUtils.ts";
import { Sidebar } from "./Sidebar.tsx";

/**
 * Sidebar render tests. We stub `fetch` so each query hook resolves
 * with canned config data, mount the Sidebar inside a memory router at
 * a chosen path, and assert the groups render from that data and that
 * the active route is highlighted. This is the closest unit-level proxy
 * for "the sidebar reflects live query data + current route" without a
 * full app boot.
 */

/** Recents payload, per-test. */
let RECENTS: { key: string; title: string }[] = [];

/** Extra labels, per-test — used for the scale and truncation cases. */
let LABELS: { id: string; name: string; color?: string }[] = [
  { id: "l_fe", name: "frontend", color: "#1e6fcb" },
];

/** Extra projects, per-test. */
let PROJECTS: { id: string; name: string; prefix: string }[] = [
  { id: "p_web", name: "Web", prefix: "WEB-" },
  { id: "p_api", name: "API", prefix: "API-" },
];

/**
 * `effective_default` from `/api/projects`, per-test. `undefined` omits
 * the field entirely, standing in for a server that predates it.
 */
let EFFECTIVE_DEFAULT: string | null | undefined;

/** Overrides the workflow config's priorities, per-test (VUE-24). */
let PRIORITIES: { key: string; label: string; value?: number }[] | undefined;

/** Overrides the workflow config's statuses, per-test (SHL-33). */
let WORKFLOW_STATUSES: { key: string; label: string; category: string }[] = [];

/** `total` returned by the stubbed /api/tasks — the count badges. */
let TASK_TOTAL = 3;

/** Empties milestones and sprints too, for the empty-tracker case. */
let EMPTY_CONFIG = false;

/** Leaves the count queries unresolved, for the pending-badge case. */
let SLOW_COUNTS = false;

/** Fails the count queries, for the unavailable-badge case. */
let FAILED_COUNTS = false;


/** Makes /api/views fail, per-test (SHL-32). */
let FAIL_VIEWS = false;

/** Per-user settings returned by /api/user-settings, per-test (SHL-45). */
let SETTINGS: Record<string, unknown> = {};

/** Saved views returned by /api/views, per-test (SHL-32). */
// `conditions` optional: a valid view carries it (edit seeds the builder
// from it); fixtures that only exercise listing/pin/delete may omit it.
let VIEWS: { id: string; name: string; filters: unknown[]; archived?: boolean; icon?: string; color?: unknown }[] = [
  {
    id: "v_mine",
    name: "My open bugs",
    filters: [{ kind: "simple", field: "status", op: "in", values: ["backlog"] }],
  },
];

/** Broken saved views returned by /api/views, per-test (VUE-22). */
let BROKEN_VIEWS: {
  id: string;
  name: string;
  /** K102: a broken entry carries a display-only `summary`, not a query. */
  summary: string;
  error: string;
  index: number;
  rawText: string;
}[] = [];

/** Routes a request path to a canned JSON body for the stubbed fetch. */
function routeFetch(path: string): unknown {
  if (path.startsWith("/api/projects")) {
    return {
      items: PROJECTS,
      total: PROJECTS.length,
      offset: 0,
      limit: 100,
      default: "p_web",
      ...(EFFECTIVE_DEFAULT === undefined ? {} : { effective_default: EFFECTIVE_DEFAULT }),
    };
  }
  if (path.startsWith("/api/views")) {
    return BROKEN_VIEWS.length > 0
      ? { queries: VIEWS, broken: BROKEN_VIEWS }
      : { queries: VIEWS };
  }
  if (path.startsWith("/api/milestones")) {
    if (EMPTY_CONFIG) return { items: [], total: 0, offset: 0, limit: 100 };
    return { items: [{ id: "m_v1", name: "v1.0" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/sprints")) {
    if (EMPTY_CONFIG) return { items: [], total: 0, offset: 0, limit: 100 };
    return {
      items: [
        { id: "sp_12", name: "Sprint 12", start_date: "2026-06-01", end_date: "2026-06-14", state: "active" },
        { id: "sp_11", name: "Sprint 11", start_date: "2026-05-18", end_date: "2026-05-31", state: "completed" },
      ],
      total: 2,
      offset: 0,
      limit: 100,
    };
  }
  if (path.startsWith("/api/labels")) {
    return { items: LABELS, total: LABELS.length, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/recents")) {
    return { items: RECENTS, total: RECENTS.length, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/user-settings")) {
    return { user: "u_ken", settings: SETTINGS };
  }
  if (path.startsWith("/api/workflow")) {
    if (PRIORITIES !== undefined) {
      return { statuses: WORKFLOW_STATUSES, priorities: PRIORITIES, task_types: [] };
    }
    // "High priority" resolves against these (VUE-24), so a fixture
    // without them renders that built-in inert.
    return {
      statuses: WORKFLOW_STATUSES,
      priorities: [
        { key: "critical", label: "Critical", value: 4 },
        { key: "high", label: "High", value: 3 },
        { key: "medium", label: "Medium", value: 2 },
        { key: "low", label: "Low", value: 1 },
      ],
      task_types: [],
    };
  }
  if (path.startsWith("/api/tasks")) {
    return { total: TASK_TOTAL }; // built-in count badges
  }
  return {};
}

function stubFetch() {
  // A few SHL-32 tests call renderSidebarAt twice in one test (render,
  // cleanup, render again). Re-`spyOn`-ing an already-spied `fetch`
  // stacks a second spy over the first; the earlier render's in-flight
  // count query then resolves against a detached mock and its promise
  // never settles — which wedged the whole file at that test, past any
  // testTimeout (the hang is between the two renders, not inside a test
  // body vitest can interrupt). Restore any prior spy first so each
  // render installs exactly one live fetch stub.
  const current = globalThis.fetch as typeof globalThis.fetch & { mockRestore?: () => void };
  current.mockRestore?.();
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // The count requests ask for limit=0. A hang is reproduced by never
    // resolving — but the abort signal must still be honoured, or the
    // client's deadline has nothing to act on and the test would be
    // measuring the mock rather than the code.
    if (FAIL_VIEWS && raw.includes("/api/views")) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (SLOW_COUNTS && raw.includes("limit=0")) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => { reject(new DOMException("Aborted", "AbortError")); },
          { once: true },
        );
      });
    }
    if (FAILED_COUNTS && raw.includes("limit=0")) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  },
  );
}

// The QueryClient from the previous renderSidebarAt in this test, if
// any. A few SHL-32 tests render twice (or thrice) with a cleanup
// between; the earlier client keeps in-flight count queries alive after
// its DOM is gone, and their unsettled promises wedged the file. We
// cancel and clear the prior client before the next render installs a
// fresh one.
let priorQc: QueryClient | undefined;

async function renderSidebarAt(
  pathname: string,
  search: Record<string, unknown> = {},
  currentUserId: string | null = "u_ken",
) {
  if (priorQc) {
    await priorQc.cancelQueries();
    priorQc.clear();
  }
  stubFetch();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  priorQc = qc;

  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => (
      <Sidebar collapsed={false} currentUserId={currentUserId} today="2026-06-08" />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({
      initialEntries: [
        `${pathname}?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(search).map(([k, v]) => [k, String(v)]),
          ),
        ).toString()}`,
      ],
    }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  // Let the router resolve and queries settle.
  await screen.findByText("Projects");
}

afterEach(() => {
  cleanup();
  if (priorQc) { priorQc.clear(); priorQc = undefined; }
  vi.restoreAllMocks();
  RECENTS = [];
  EFFECTIVE_DEFAULT = undefined;
  PRIORITIES = undefined;
  WORKFLOW_STATUSES = [];
  VIEWS = [{
    id: "v_mine",
    name: "My open bugs",
    filters: [{ kind: "simple", field: "status", op: "in", values: ["backlog"] }],
  }];
  BROKEN_VIEWS = [];
  SETTINGS = {};
  FAIL_VIEWS = false;
  window.localStorage.clear();
  TASK_TOTAL = 3;
  EMPTY_CONFIG = false;
  SLOW_COUNTS = false;
  FAILED_COUNTS = false;
  LABELS = [{ id: "l_fe", name: "frontend", color: "#1e6fcb" }];
  PROJECTS = [
    { id: "p_web", name: "Web", prefix: "WEB-" },
    { id: "p_api", name: "API", prefix: "API-" },
  ];
});

describe("Sidebar", () => {
  it("renders all data-driven groups from query data", async () => {
    await renderSidebarAt("/list");

    // Group headers
    // "Views" was "Saved filters" — renamed per the View-vs-Filter vocab
    // (K102): a saved thing is a "view".
    for (const label of ["Projects", "Views", "Milestones", "Sprints", "Labels", "Recently viewed"]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    // Project items
    expect(await screen.findByText("Web")).toBeTruthy();
    expect(screen.getByText("API")).toBeTruthy();
    // User saved view
    expect(await screen.findByText("My open bugs")).toBeTruthy();
    // Milestone + label
    expect(await screen.findByText("v1.0")).toBeTruthy();
    expect(await screen.findByText("frontend")).toBeTruthy();
  });

  it("collapses a section on toggle and persists it to localStorage (U22)", async () => {
    await renderSidebarAt("/list");
    // A label row proves the Labels section body is expanded.
    expect(await screen.findByText("frontend")).toBeTruthy();
    const toggle = screen.getByTestId("sidebar-section-toggle-labels");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);

    // Body hidden, header still there, state reflected + persisted.
    await waitFor(() => {
      expect(screen.queryByText("frontend")).toBeNull();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Labels")).toBeTruthy();
    const stored = window.localStorage.getItem("loctt.sidebar.collapsedSections");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "[]")).toContain("labels");
  });

  it("restores a section's collapsed state from localStorage on mount (U22)", async () => {
    window.localStorage.setItem(
      "loctt.sidebar.collapsedSections",
      JSON.stringify(["labels"]),
    );
    await renderSidebarAt("/list");
    // Header renders; body does not (restored collapsed).
    expect(await screen.findByText("Labels")).toBeTruthy();
    expect(screen.queryByText("frontend")).toBeNull();
    expect(
      screen.getByTestId("sidebar-section-toggle-labels").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("hides completed sprints, shows active ones", async () => {
    await renderSidebarAt("/list");
    expect(await screen.findByText("Sprint 12")).toBeTruthy();
    expect(screen.queryByText("Sprint 11")).toBeNull();
  });

  it("'+ New milestone' opens the shared create dialog in place (K105)", async () => {
    await renderSidebarAt("/list");
    const btn = await screen.findByTestId("sidebar-new-milestone");
    expect(screen.queryByTestId("milestone-create-name")).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByTestId("milestone-create-name")).not.toBeNull();
  });

  it("'+ New label' opens the shared create dialog in place (K105)", async () => {
    await renderSidebarAt("/list");
    const btn = await screen.findByTestId("sidebar-new-label");
    expect(screen.queryByTestId("label-create-name")).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByTestId("label-create-name")).not.toBeNull();
  });

  it("'+ New sprint' opens the shared create dialog in place (K105)", async () => {
    await renderSidebarAt("/list");
    const btn = await screen.findByTestId("sidebar-new-sprint");
    expect(screen.queryByTestId("sprint-create-name")).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByTestId("sprint-create-name")).not.toBeNull();
  });

  /**
   * @verifies ONB-10
   *
   * The copy has to say the group *fills in*, so the emptiness reads
   * as expected rather than broken. "No recent tasks" alone left a
   * fresh tracker looking like a failed fetch.
   */
  it("renders the empty-state note for recents and says it fills in", async () => {
    await renderSidebarAt("/list");
    const empty = await screen.findByText(/No recent tasks/);
    expect(empty.textContent).toMatch(/as you open them/i);
  });

  it("renders all six built-in filters including 'Mentions me'", async () => {
    await renderSidebarAt("/list");
    for (const label of [
      "Assigned to me", "Reported by me", "Mentions me",
      "Due this week", "Overdue", "High priority",
    ]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it("shows live count badges on resolvable built-ins, including 'Mentions me'", async () => {
    await renderSidebarAt("/list");
    // Stubbed /api/tasks returns total: 3 for every count query.
    //
    // The row starts inert — "High priority" resolves against the
    // workflow config (VUE-24), which arrives a tick later — so wait
    // for the link rather than for the text, which is present in both
    // states.
    const highPriority = await screen.findByRole("link", { name: /High priority/ });
    expect(within(highPriority).getByText("3")).toBeTruthy();
    // CMT-10: "Mentions me" now resolves to `comment_mentions =
    // currentUser()`, so with a current user it is a live link with a
    // count like the other user filters.
    const mentions = await screen.findByRole("link", { name: /Mentions me/ });
    expect(within(mentions).getByText("3")).toBeTruthy();
  });

  it("highlights the active List view", async () => {
    await renderSidebarAt("/list");
    const list = await screen.findByText("List");
    // The active ItemShell carries data-active="true".
    expect(list.closest("a")?.querySelector("[data-active]")).not.toBeNull();
    // The Board item, by contrast, is not active.
    const board = screen.getByText("Board");
    expect(board.closest("a")?.querySelector("[data-active]")).toBeNull();
  });

  it("marks the active project from the URL search params", async () => {
    await renderSidebarAt("/list", { project: "p_api" });
    const api = await screen.findByText("API");
    expect(api.closest("a")?.querySelector("[data-active]")).not.toBeNull();
    const web = screen.getByText("Web");
    expect(web.closest("a")?.querySelector("[data-active]")).toBeNull();
  });
});

/**
 * @verifies UI-16b
 *
 * `ItemShell` fully supports an active state (`data-active`,
 * `aria-current="page"`, the `bg-accent-muted text-accent` treatment) —
 * Projects and the view switcher already pass it. The Views section
 * (built-in filters + saved views) never did, so selecting a saved view
 * left it visually unmarked. Every built-in resolves to exactly
 * `{ q: <dsl> }` (`sidebar/builtinFilters.ts`), so a built-in is active
 * when the URL's `q` matches its resolved `q` exactly; a saved view is
 * active when `search.view` names it.
 */
describe("Sidebar Views section active state (UI-16b)", () => {
  it("marks a selected saved view with aria-current=\"page\" and data-active", async () => {
    await renderSidebarAt("/list", { view: "v_mine" });
    const row = (await screen.findByText("My open bugs")).closest("a") as HTMLElement;
    // The load-bearing marker is `ItemShell`'s own inner `<span>` — the
    // `active` prop this fix threads through. (The enclosing `<a>` ALSO
    // carries `aria-current="page"`, but that one is TanStack Router's
    // own exact-match behaviour, not this fix, so it is not what is
    // asserted here.)
    const mark = row.querySelector("[data-active]");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("aria-current")).toBe("page");
  });

  it("does not mark the saved view active when it is not selected", async () => {
    await renderSidebarAt("/list", {});
    const row = (await screen.findByText("My open bugs")).closest("a") as HTMLElement;
    expect(row.querySelector("[data-active]")).toBeNull();
  });

  it("marks a selected built-in filter active by its resolved query, and only that one row", async () => {
    // "Overdue" resolves to `q: due_date < 2026-06-08 and status.category
    // not in (completed, discarded)` given `today="2026-06-08"` (fixed by
    // `renderSidebarAt`). Selecting exactly that `q` marks Overdue active
    // and leaves every other row — including the saved view — inactive.
    await renderSidebarAt("/list", {
      q: "due_date < 2026-06-08 and status.category not in (completed, discarded)",
    });
    const overdue = (await screen.findByText("Overdue")).closest("a") as HTMLElement;
    expect(overdue.getAttribute("aria-current")).toBe("page");

    const savedView = (screen.getByText("My open bugs")).closest("a") as HTMLElement;
    expect(savedView.getAttribute("aria-current")).toBeNull();

    // Only one row within the Views section (built-ins + saved views) is
    // active at a time. Scoped to that section's body — the List/Board/
    // Timeline switcher above it is independently active on `/list` and
    // is not what this assertion is about.
    // Scoped to `ItemShell`'s own `data-active` marker (`[data-active]`),
    // not `[aria-current="page"]`: TanStack Router's `<Link>` ALSO sets
    // `aria-current="page"` on its own `<a>` for an exact-match `to`, so a
    // plain `aria-current` query double-counts one active row (the `<a>`
    // and the `ItemShell` `<span>` inside it). `data-active` is the
    // component's own state and appears exactly once per active row.
    const viewsSection = document.getElementById("sidebar-section-saved-filters");
    expect(viewsSection).not.toBeNull();
    const activeRows = viewsSection?.querySelectorAll("[data-active]");
    expect(activeRows?.length).toBe(1);
  });
});

/**
 * @verifies SHL-5
 *
 * The star marks where a new task actually lands. `/api/projects`
 * reported only the *workspace* default, so a user with their own
 * `default_project` set was shown a star on a project their own writes
 * would not go to — the one thing the mark is for.
 */
describe("Sidebar default project (SHL-5)", () => {
  it("stars the per-user effective default over the workspace default", async () => {
    EFFECTIVE_DEFAULT = "p_api";
    await renderSidebarAt("/list");

    const api = (await screen.findByText("API")).closest("a") as HTMLElement;
    const web = (screen.getByText("Web")).closest("a") as HTMLElement;
    expect(within(api).getByTitle("Default project")).toBeTruthy();
    expect(within(web).queryByTitle("Default project")).toBeNull();
  });

  it("falls back to the workspace default when the server sends no effective default", async () => {
    EFFECTIVE_DEFAULT = undefined;
    await renderSidebarAt("/list");

    const web = (await screen.findByText("Web")).closest("a") as HTMLElement;
    const api = (screen.getByText("API")).closest("a") as HTMLElement;
    expect(within(web).getByTitle("Default project")).toBeTruthy();
    expect(within(api).queryByTitle("Default project")).toBeNull();
  });

  it("stars nothing when neither default resolves", async () => {
    EFFECTIVE_DEFAULT = null;
    await renderSidebarAt("/list");

    await screen.findByText("Web");
    expect(screen.queryByTitle("Default project")).toBeNull();
  });

  it("UI-16a: renders exactly one dot-shaped mark on the default project row, not two", async () => {
    // UI-16a: the default marker used to be `<Icon name="dot">`, drawn
    // right beside the `ColorDot` every project row used to carry — two
    // visually identical filled circles on one row. The fix swapped the
    // marker back to `star` (not shape-identical to a dot).
    //
    // UI-20 (2026-09-23) then removed the row's `ColorDot` entirely — it
    // was a hardcoded constant colour encoding nothing (every project
    // drew the identical dot) — so the row now has ZERO dot-shaped
    // marks, not one. This test used to assert exactly one (the
    // ColorDot); it was asserting the very mark UI-20 deletes, so it is
    // rewritten to the new contract: no dot at all, and the star stays
    // the row's only mark. This counts *filled circle* shapes
    // specifically — `ColorDot` is a `<span>` with a `rounded-full`
    // background, so this must count both the CSS-rounded ColorDot AND
    // any filled `<circle>` SVG a regression might reintroduce.
    EFFECTIVE_DEFAULT = "p_web";
    await renderSidebarAt("/list");

    const web = (await screen.findByText("Web")).closest("a") as HTMLElement;
    const cssRoundedDots = web.querySelectorAll("span.rounded-full").length;
    const svgCircleDots = web.querySelectorAll("svg circle").length;
    expect(cssRoundedDots + svgCircleDots).toBe(0);
    // And the default marker itself is present and is a star, not a dot.
    const marker = within(web).getByTitle("Default project");
    expect(marker.querySelector("svg")).not.toBeNull();
    expect(marker.querySelector("circle")).toBeNull();
  });

  it("UI-20: no project row draws a constant-colour dot", async () => {
    // The hardcoded `<ColorDot color="var(--status-active-fg)" />` drew
    // an identical blue dot for every project — a per-item-shaped mark
    // with a constant value, which UI-19's rule forbids. ProjectDef has
    // no colour field, so there is nothing per-item to draw instead; the
    // slot is empty. Checked across every seeded project, not just the
    // default one, since the defect was "every project", not one row.
    EFFECTIVE_DEFAULT = null;
    await renderSidebarAt("/list");

    const web = (await screen.findByText("Web")).closest("a") as HTMLElement;
    const api = (await screen.findByText("API")).closest("a") as HTMLElement;
    for (const row of [web, api]) {
      expect(row.querySelectorAll("span.rounded-full").length).toBe(0);
    }
  });
});

/**
 * @verifies SHL-10
 *
 * Recents render key + title and link to the task route. The server
 * drops ids that no longer resolve, so anything reaching the client is
 * a live task — the client's job is to render it as a working link
 * rather than to re-filter.
 */
describe("Sidebar recents (SHL-10)", () => {
  it("renders key and title, most-recent-first, linking to the task route", async () => {
    RECENTS = [
      { key: "WEB-9", title: "Newest thing" },
      { key: "API-2", title: "Older thing" },
    ];
    await renderSidebarAt("/list");

    const newest = await screen.findByText("Newest thing");
    const link = newest.closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("/tasks/WEB-9");
    expect(within(link).getByText("WEB-9")).toBeTruthy();

    // Server order is preserved — the sidebar must not re-sort.
    const titles = screen
      .getAllByText(/thing$/)
      .map(el => el.textContent);
    expect(titles).toEqual(["Newest thing", "Older thing"]);

    // With entries present the empty affordance is gone.
    expect(screen.queryByText("No recent tasks")).toBeNull();
  });
});

/**
 * @verifies SHL-11
 *
 * SHL-11's footer bullet: a Settings link that navigates to the
 * settings route. The case's other half — telling two `loctt ui`
 * windows apart — is the document title's, and is covered in
 * `useRouteAnnouncement.test.tsx`; nothing on the page carries it.
 */
describe("Sidebar footer (SHL-11)", () => {
  it("shows a Settings link pointing at the settings route", async () => {
    await renderSidebarAt("/list");

    const settings = (await screen.findByText("Settings")).closest("a") as HTMLAnchorElement;
    expect(settings.getAttribute("href")).toContain("/settings/");
  });
});

/**
 * Truncation and scale. All three cases share one requirement the
 * sidebar failed: the full text has to be available on hover *and* on
 * keyboard focus, and truncation only happens in the expanded state —
 * which is exactly where the tooltip was omitted.
 */
describe("Sidebar truncation and scale", () => {
  const LONG = "s".repeat(120);

  /**
   * @verifies SHL-22
   *
   * A 120-character label must truncate rather than widen the column,
   * keep its colour swatch, and expose the full name on the element
   * that takes focus — the anchor, not the inner span.
   */
  it("truncates a very long label while keeping its swatch and full name", async () => {
    LABELS = [{ id: "l_long", name: LONG, color: "#1e6fcb" }];
    await renderSidebarAt("/list");

    const text = await screen.findByText(LONG);
    expect(text.className).toContain("truncate");

    // The focusable element carries the full name.
    const link = text.closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("title")).toBe(LONG);

    // Truncation eats the text, not the metadata: the swatch survives.
    const swatch = link.querySelector('span[style*="background"]');
    expect(swatch).not.toBeNull();
  });

  /**
   * @verifies SHL-19
   *
   * The footer keeps the Settings link visible (the tracker path and the
   * task count were both removed).
   */
  it("keeps the Settings link in the footer", async () => {
    await renderSidebarAt("/list");

    expect((await screen.findByText("Settings")).closest("a")).not.toBeNull();
    expect(screen.queryByText(/\b7 tasks\b/)).toBeNull();
  });

  /**
   * @verifies SHL-11, SHL-20, SHL-21
   *
   * With twenty recents and forty labels above it, the footer must stay
   * put. The groups scroll inside their own box; the footer is that
   * box's sibling, so it cannot scroll away with them.
   */
  it("keeps the footer out of the scrolling region at scale", async () => {
    RECENTS = Array.from({ length: 20 }, (_, i) => ({
      key: `WEB-${i + 1}`,
      title: `Recent task ${i + 1}`,
    }));
    LABELS = Array.from({ length: 40 }, (_, i) => ({
      id: `l_${i}`,
      name: `label-${i}`,
      color: "#1e6fcb",
    }));
    await renderSidebarAt("/list");

    await screen.findByText("Recent task 20");
    const scroller = document.querySelector('[data-sidebar-scroll="true"]');
    expect(scroller).not.toBeNull();

    // Everything that grows is inside the scroller...
    expect(scroller?.contains(screen.getByText("label-39"))).toBe(true);
    expect(scroller?.contains(screen.getByText("Recent task 20"))).toBe(true);
    // ...and the footer (now just the Settings link) is not.
    expect(scroller?.contains(screen.getByText("Settings"))).toBe(false);
  });

  /**
   * @verifies SHL-20
   *
   * Long recent titles truncate to one line rather than wrapping and
   * shoving the group down.
   */
  it("truncates long recent titles to a single line", async () => {
    RECENTS = [{ key: "WEB-1", title: LONG }];
    await renderSidebarAt("/list");

    const title = await screen.findByText(LONG);
    expect(title.className).toContain("truncate");
    expect((title.closest("a") as HTMLAnchorElement).getAttribute("title")).toBe(LONG);
  });
});

/**
 * The built-in saved filters, as the sidebar renders them.
 */
describe("Sidebar built-in filters", () => {
  /**
   * @verifies VUE-1
   *
   * Five of the six carry a badge; the badge is the filter's own total
   * from `/api/tasks`, and a zero renders as `0` rather than
   * disappearing — a missing badge and a zero badge are different
   * claims about the data.
   */
  it("badges the five live built-ins, including a genuine zero", async () => {
    TASK_TOTAL = 0;
    await renderSidebarAt("/list");

    for (const label of [
      "Assigned to me", "Reported by me", "Due this week", "Overdue", "High priority",
    ]) {
      const link = await screen.findByRole("link", { name: new RegExp(label) });
      expect(within(link).getByText("0")).toBeTruthy();
    }
  });

  /**
   * @verifies VUE-2
   * @verifies CMT-10
   *
   * No fabricated `0` badge on an unresolvable "Mentions me". VUE-2's
   * original reason was that comments had not landed; CMT-10 gave the
   * built-in a real query, so the remaining unresolvable case is "no
   * current user" — the same inert-without-a-user behaviour as "Assigned
   * to me". The row is inert text with no link and no count, and its
   * reason is the generic one, no longer a false "comments land" promise.
   */
  it("gives 'Mentions me' no badge and no link when there is no current user", async () => {
    await renderSidebarAt("/list", {}, null);

    const mentions = await screen.findByText("Mentions me");
    expect(mentions.closest("a")).toBeNull();
    const row = mentions.closest("[aria-disabled]") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).not.toMatch(/\d/);
    expect(row.getAttribute("title")).not.toMatch(/comments/i);
  });

  /**
   * @verifies VUE-16
   *
   * The badge is the true total, not the page size — the count request
   * asks for `limit=0` precisely so the server counts without shipping
   * rows.
   */
  it("shows the true total rather than a page size", async () => {
    TASK_TOTAL = 1280;
    await renderSidebarAt("/list");

    const link = await screen.findByRole("link", { name: /Assigned to me/ });
    expect(within(link).getByText("1280")).toBeTruthy();
  });

  /**
   * @verifies VUE-24
   *
   * A workspace whose priority scale cannot express "high" gets an
   * inert row that says so — not a link with a badge frozen at zero,
   * and not the "comments land" message, which would be a false
   * promise about a different feature.
   */
  it("makes 'High priority' inert, and honest, on a scale that cannot express it", async () => {
    PRIORITIES = [{ key: "normal", label: "Normal" }];
    await renderSidebarAt("/list");

    const hp = await screen.findByText("High priority");
    expect(hp.closest("a")).toBeNull();
    const row = hp.closest("[aria-disabled]") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute("title")).toMatch(/priorities don.t distinguish/i);
    expect(row.getAttribute("title")).not.toMatch(/comments/i);
  });
});

/**
 * An empty tracker. ONB-9's rule is that "this tracker has nothing in
 * it" must not be mistakable for "this feature is missing" — and three
 * groups used to vanish outright when their config was empty, which is
 * exactly that mistake.
 */
describe("Sidebar on an empty tracker", () => {
  beforeEach(() => {
    PROJECTS = [];
    LABELS = [];
    EMPTY_CONFIG = true;
  });

  /**
   * @verifies ONB-9, SHL-9
   */
  it("renders every group with an explicit empty affordance", async () => {
    await renderSidebarAt("/list");

    for (const group of ["Projects", "Milestones", "Sprints", "Labels", "Recently viewed"]) {
      expect(await screen.findByText(group)).toBeTruthy();
    }
    expect(await screen.findByText(/No projects yet/)).toBeTruthy();
    expect(await screen.findByText(/No milestones yet/)).toBeTruthy();
    expect(await screen.findByText(/No active sprints/)).toBeTruthy();
    expect(await screen.findByText(/No labels yet/)).toBeTruthy();
    expect(await screen.findByText(/No recent tasks/)).toBeTruthy();
  });

  /**
   * @verifies ONB-9
   *
   * A real zero, not a blank and not an omitted badge.
   */
  it("badges the live built-ins with a real zero", async () => {
    TASK_TOTAL = 0;
    await renderSidebarAt("/list");

    const link = await screen.findByRole("link", { name: /Overdue/ });
    expect(within(link).getByText("0")).toBeTruthy();
  });
});

/**
 * @verifies ONB-13, ONB-14, SHL-23
 *
 * The badge slot is reserved before its number arrives. Rendering
 * nothing and then inserting a pill shifts every row below it, so a
 * click aimed mid-load lands on the wrong item — which is what ONB-14
 * is written against. The filter itself stays clickable throughout:
 * the count is decoration, not a gate.
 */
describe("Sidebar count badges while pending", () => {
  it("reserves the badge slot and keeps the filter clickable while counting", async () => {
    SLOW_COUNTS = true;
    await renderSidebarAt("/list");

    // The link exists and is navigable before any count resolves.
    const link = await screen.findByRole("link", { name: /Overdue/ });
    expect(link.getAttribute("href")).toContain("/list");

    const badge = link.querySelector("[data-pending]");
    expect(badge).not.toBeNull();
    // The slot has width before the number lands.
    expect(badge?.className).toMatch(/min-w-/);
  });
});

/**
 * @verifies SHL-23
 *
 * "If the count query never resolves, the badge eventually shows an
 * unavailable affordance rather than spinning forever." The deadline
 * lives in the request; what this checks is that the resulting failure
 * reaches the badge as *unavailable* rather than as a permanent
 * pending state, which reads to the user as a hang.
 */
describe("Sidebar count badges that never arrive", () => {
  it("marks the badge unavailable rather than leaving it pending", async () => {
    FAILED_COUNTS = true;
    await renderSidebarAt("/list");

    const link = await screen.findByRole("link", { name: /Overdue/ });
    const badge = await waitFor(() => {
      const el = link.querySelector("[data-unavailable]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(badge.getAttribute("data-pending")).toBeNull();
    expect(badge.getAttribute("title")).toMatch(/unavailable/i);
    // The filter is still usable — the count is decoration, not a gate.
    expect(link.getAttribute("href")).toContain("/list");
  });

});

/**
 * @verifies ONB-23
 *
 * The server abbreviates to the last two segments, but two long
 * directory names still produce a long label — which is the state
 * this case describes. The footer has to absorb it without widening
 * the column or pushing Settings out.
 */
describe("Sidebar footer", () => {
  // The tracker filesystem path was removed from the footer (Ken's
  // report — developer chrome), so the former "truncate a very long
  // workspace path" test no longer has a subject. What still matters is
  // that the footer's Settings link stays reachable and out of the
  // scrolling region regardless of how much sits above it.
  it("keeps Settings reachable and outside the scroll region", async () => {
    RECENTS = Array.from({ length: 20 }, (_, i) => ({
      key: `WEB-${i + 1}`,
      title: `Recent task ${i + 1}`,
    }));

    await renderSidebarAt("/list");
    await screen.findByText("Recent task 20");

    const settings = screen.getByText("Settings").closest("a") as HTMLAnchorElement;
    expect(settings.getAttribute("href")).toContain("/settings/");
    const scroller = document.querySelector('[data-sidebar-scroll="true"]');
    expect(scroller?.contains(settings)).toBe(false);
  });
});

/**
 * @verifies SHL-32
 *
 * "Delete a pinned saved view from the config while the UI is open,
 * then refresh." `/api/views` simply omits it, so the only way to
 * notice is to remember what was there — and the memory has to
 * survive the refresh, which is the action that reveals the problem.
 */
describe("Sidebar with a saved view deleted from queries.yaml", () => {
  it("explains the removal inline, naming the view, without an alert", async () => {
    // First load: the view exists and is remembered.
    VIEWS = [
      { id: "v_mine", name: "My open bugs", filters: [] },
      { id: "v_gone", name: "Release blockers", filters: [] },
    ];
    await renderSidebarAt("/list");
    expect(await screen.findByText("Release blockers")).toBeTruthy();
    cleanup();

    // The user edits queries.yaml and refreshes.
    VIEWS = [{ id: "v_mine", name: "My open bugs", filters: [] }];
    await renderSidebarAt("/list");

    const notice = await screen.findByText(/Release blockers.*was removed/);
    expect(notice.textContent).toContain("queries.yaml");
    // An explanation, not an error: no toast, no alert role.
    expect(screen.queryByRole("alert")).toBeNull();
    // The rest of the group renders normally.
    expect(screen.getByText("My open bugs")).toBeTruthy();
    expect(await screen.findByRole("link", { name: /Overdue/ })).toBeTruthy();
    // And the stale entry is not a broken link.
    expect(screen.queryByRole("link", { name: /Release blockers/ })).toBeNull();
  });

  it("stays dismissed once dismissed", async () => {
    VIEWS = [
      { id: "v_mine", name: "My open bugs", filters: [] },
      { id: "v_gone", name: "Release blockers", filters: [] },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("Release blockers");
    cleanup();

    VIEWS = [{ id: "v_mine", name: "My open bugs", filters: [] }];
    await renderSidebarAt("/list");
    const dismiss = await screen.findByLabelText(/Dismiss: Release blockers/);
    fireEvent.click(dismiss);
    expect(screen.queryByText(/Release blockers.*was removed/)).toBeNull();
    cleanup();

    // And it does not come back on the next load — dismissing removes
    // the pin, so there is nothing left to explain.
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    expect(screen.queryByText(/Release blockers.*was removed/)).toBeNull();
  });

  it("keeps explaining across a second refresh, until dismissed", async () => {
    VIEWS = [
      { id: "v_mine", name: "My open bugs", filters: [] },
      { id: "v_gone", name: "Release blockers", filters: [] },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("Release blockers");
    cleanup();

    VIEWS = [{ id: "v_mine", name: "My open bugs", filters: [] }];
    await renderSidebarAt("/list");
    expect(await screen.findByText(/Release blockers.*was removed/)).toBeTruthy();
    cleanup();

    // A second refresh without dismissing. The explanation has to
    // survive: a user who reloads twice before reading it would
    // otherwise never learn what happened, which is the drift P7
    // forbids.
    await renderSidebarAt("/list");
    expect(await screen.findByText(/Release blockers.*was removed/)).toBeTruthy();
  });

  it("says nothing on a first-ever load, when nothing is remembered", async () => {
    VIEWS = [{ id: "v_mine", name: "My open bugs", filters: [] }];
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    expect(screen.queryByText(/was removed/)).toBeNull();
  });

  it("says nothing when the views request failed", async () => {
    // A failed read is not a deletion. Reporting every remembered pin
    // as removed because a request errored would be the same ERR-1
    // conflation one layer up.
    VIEWS = [
      { id: "v_mine", name: "My open bugs", filters: [] },
      { id: "v_gone", name: "Release blockers", filters: [] },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("Release blockers");
    cleanup();

    FAIL_VIEWS = true;
    await renderSidebarAt("/list");
    await screen.findByText("Views"); // renamed from "Saved filters" (K102 vocab)
    expect(screen.queryByText(/was removed/)).toBeNull();
  });
});

describe("Sidebar groups customization (SHL-45)", () => {
  it("renders groups in the configured order", async () => {
    // @verifies SHL-45
    // Default order has Projects before Labels; a custom order flips them.
    SETTINGS = { sidebar_groups: { order: ["labels", "projects"] } };
    await renderSidebarAt("/list");
    // The settings query settles after the first (default-order) render,
    // so wait until the custom order takes effect.
    await waitFor(() => {
      const labelsHeader = screen.getByText("Labels");
      const projectsHeader = screen.getByText("Projects");
      expect(
        labelsHeader.compareDocumentPosition(projectsHeader)
          & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("does not render a hidden group", async () => {
    // @verifies SHL-45 — a user-hidden group is absent, not an empty affordance
    SETTINGS = { sidebar_groups: { hidden: ["labels"] } };
    await renderSidebarAt("/list");
    // Wait for the settings-driven re-render to hide the group.
    await waitFor(() => {
      expect(screen.queryByText("Labels")).toBeNull();
    });
    // Other groups still render (getByText throws if absent).
    screen.getByText("Projects");
    // Not an "empty affordance" either — the group is gone, not empty.
    expect(screen.queryByText(/No labels yet/)).toBeNull();
  });

  it("hides a built-in filter without removing the Views group", async () => {
    // @verifies SHL-45 — built-in filters are hideable too
    SETTINGS = { sidebar_groups: { hidden: ["overdue"] } };
    await renderSidebarAt("/list");
    await waitFor(() => {
      expect(screen.queryByText("Overdue")).toBeNull();
    });
    screen.getByText("Views"); // renamed from "Saved filters" (K102 vocab)
    // A non-hidden filter still shows.
    screen.getByText("Assigned to me");
  });

  it("falls back to the default (all groups) when the setting is corrupt", async () => {
    // @verifies SHL-45 — degrade on a bad setting, never blank the sidebar
    SETTINGS = { sidebar_groups: "banana" };
    await renderSidebarAt("/list");
    // getByText throws if any is missing — all three present == degrade held.
    screen.getByText("Projects");
    screen.getByText("Labels");
    screen.getByText("Milestones");
  });

  it("opens the create-view dialog from the enabled + New filter entry", async () => {
    // @verifies SHL-45 (+ New filter enablement owned by this lane)
    await renderSidebarAt("/list");
    const btn = screen.getByTestId("sidebar-new-filter");
    // Enabled: no `disabled` attribute (the old stub hardcoded one).
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    // VUE-40 + K102: the sidebar entry opens the same create dialog the
    // panel uses — the human-readable FILTER PICKER, NOT a raw DSL box,
    // NOT the AST builder, and NOT the read-only "Save as view" dialog
    // that hard-codes `archived != true`.
    await screen.findByTestId("view-create-dialog");
    screen.getByTestId("view-filter-field-0");
    expect(screen.queryByTestId("query-builder")).toBeNull();
    expect(screen.queryByTestId("advanced-query-editor")).toBeNull();
  });

  it("sidebar + New filter POSTs an ordered filters list, not the fixed archived filter", async () => {
    // @verifies VUE-40 — the sidebar bullet the case leads with. The old
    // wiring opened SaveViewDialog with `search={}`, so every view saved
    // from the sidebar was `archived != true` and the user could not build
    // a filter. K102: the sidebar reaches the filter picker and POSTs the
    // ordered filters authored there.
    await renderSidebarAt("/list");
    const posts: { url: string; body: unknown }[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if ((init?.method ?? "GET") === "POST" && url.includes("/api/views")) {
        const raw = init?.body;
        posts.push({ url, body: typeof raw === "string" ? JSON.parse(raw) : undefined });
        return Promise.resolve(new Response(JSON.stringify({ id: "vNew", name: "n", filters: [] }), {
          status: 201, headers: { "Content-Type": "application/json" },
        }));
      }
      return realFetch(input, init);
    });

    fireEvent.click(screen.getByTestId("sidebar-new-filter"));
    await screen.findByTestId("view-filter-field-0");

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "My typed view" } });
    pickCombo("view-filter-field-0", "title");
    fireEvent.change(screen.getByTestId("view-filter-value-0"), { target: { value: "bug" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => { expect(posts.length).toBe(1); });
    const body = posts[0]?.body as { name: string; filters?: unknown };
    expect(body.name).toBe("My typed view");
    expect(body.filters).toEqual([
      { kind: "simple", field: "title", op: "~", values: ["bug"] },
    ]);
    // Never the SaveViewDialog default derived from an empty search.
    expect(JSON.stringify(posts[0]?.body)).not.toContain("archived != true");
  });
});

/**
 * Edit / Pin / Delete a saved filter from the sidebar row (Ken's gap).
 *
 * The user-view rows were bare `<Link>`s — the edit/rename/delete
 * affordance existed only in Settings → Saved views. These cover the
 * kebab the rows now carry: present on a user view, absent on a built-in;
 * Edit opens the prefilled dialog and issues one PUT; Delete confirms,
 * DELETEs, and does NOT fire the "was removed" vanished-view notice for
 * the user's own deletion; Pin/Unpin issues one merged user-settings PUT;
 * and a broken row offers Edit but not Pin.
 */
describe("Sidebar saved-filter row actions", () => {
  /** Captures write requests so a test can assert method + URL + body. */
  function captureWrites(): { calls: { method: string; url: string; body: unknown }[] } {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const realFetch = globalThis.fetch;
    // Once a view is DELETEd, its GET must reflect the removal, so the
    // refetch the invalidation triggers sees it gone (the condition that
    // trips useVanishedViews).
    const deletedIds = new Set<string>();
    const json = (b: unknown, status = 200): Response =>
      new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        const raw = init?.body;
        calls.push({ method, url, body: typeof raw === "string" ? JSON.parse(raw) : undefined });
        if (url.includes("/api/query/validate")) return Promise.resolve(json({ valid: true }));
        if (url.includes("/api/views/") && method === "PUT") {
          return Promise.resolve(json({ id: "v_mine", name: "n", filters: [] }));
        }
        if (url.includes("/api/views/") && method === "DELETE") {
          const id = decodeURIComponent(url.split("/api/views/")[1]?.split("?")[0] ?? "");
          deletedIds.add(id);
          return Promise.resolve(json({ deleted: id }));
        }
        if (url.includes("/api/user-settings")) return Promise.resolve(json({ user: "u_ken", settings: {} }));
        return Promise.resolve(json({}));
      }
      // GET /api/views reflects deletions so a refetch shows the view gone.
      if (/\/api\/views(\?|$)/.test(url) && deletedIds.size > 0) {
        return Promise.resolve(json({ queries: VIEWS.filter(v => !deletedIds.has(v.id)) }));
      }
      return realFetch(input, init);
    });
    return { calls };
  }

  it("shows a kebab on a user-view row and none on a built-in", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    // The user view carries the kebab.
    expect(
      screen.getByRole("button", { name: 'Actions for saved filter "My open bugs"' }),
    ).toBeTruthy();
    // A built-in ("Assigned to me") does not.
    expect(
      screen.queryByRole("button", { name: /Actions for saved filter "Assigned to me"/ }),
    ).toBeNull();
  });

  it("Edit opens the prefilled dialog and issues one PUT /api/views/:id", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    const { calls } = captureWrites();

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "My open bugs"' }));
    fireEvent.click(screen.getByTestId("view-edit"));
    await screen.findByTestId("view-edit-dialog");
    // K102: a valid view opens as DROPDOWN ROWS seeded from its stored
    // filters. Prefilled name, and the first row shows `status`.
    await screen.findByTestId("view-filter-field-0");
    expect(screen.getByTestId<HTMLInputElement>("view-form-name").value).toBe("My open bugs");
    expect(comboValue("view-filter-field-0")).toBe("status");
    expect(screen.queryByTestId("view-filter-query-0")).toBeNull();

    fireEvent.change(screen.getByTestId("view-form-name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => {
      const puts = calls.filter(c => c.method === "PUT" && c.url.includes("/api/views/v_mine"));
      expect(puts.length).toBe(1);
      const body = puts[0]?.body as { name: string; filters?: unknown };
      expect(body.name).toBe("Renamed");
      // The edit carries the ordered filters, unchanged by the rename.
      expect(body.filters).toEqual([
        { kind: "simple", field: "status", op: "in", values: ["backlog"] },
      ]);
    });
  });

  it("Delete confirms and issues one DELETE /api/views/:id", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    const { calls } = captureWrites();

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "My open bugs"' }));
    fireEvent.click(screen.getByTestId("view-delete"));
    await screen.findByTestId("delete-view-dialog");
    fireEvent.click(screen.getByTestId("delete-view-confirm"));

    await waitFor(() => {
      const dels = calls.filter(c => c.method === "DELETE" && c.url.includes("/api/views/v_mine"));
      expect(dels.length).toBe(1);
    });
  });

  it("Delete does not fire the vanished-view notice for the user's own deletion", async () => {
    // The GET drops the view once it is deleted, so on the invalidation's
    // refetch it is genuinely gone — exactly the condition that trips
    // useVanishedViews. confirmDelete calls dismiss(view.id) BEFORE the
    // mutate, which is what suppresses "«name» was removed from
    // queries.yaml" for the user's own action.
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    const { calls } = captureWrites();

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "My open bugs"' }));
    fireEvent.click(screen.getByTestId("view-delete"));
    await screen.findByTestId("delete-view-dialog");
    fireEvent.click(screen.getByTestId("delete-view-confirm"));

    // The DELETE fires and the refetch shows the view gone (the row
    // disappears), which is the exact condition useVanishedViews watches.
    await waitFor(() => {
      expect(calls.some(c => c.method === "DELETE" && c.url.includes("/api/views/v_mine"))).toBe(true);
    });
    await waitFor(() => { expect(screen.queryByText("My open bugs")).toBeNull(); });
    // Because confirmDelete dismissed the view before the mutate, no
    // "was removed from queries.yaml" notice appears for the user's own
    // deletion.
    expect(screen.queryByText(/was removed from queries\.yaml/)).toBeNull();
  });

  it("Pin issues one merged PUT /api/user-settings carrying the pin", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    const { calls } = captureWrites();

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "My open bugs"' }));
    // Not yet pinned → the item reads "Pin to top".
    fireEvent.click(screen.getByTestId("view-pin"));

    await waitFor(() => {
      const puts = calls.filter(c => c.method === "PUT" && c.url.includes("/api/user-settings"));
      expect(puts.length).toBe(1);
      expect(puts[0]?.body).toMatchObject({ sidebar_pins: ["v_mine"] });
    });
  });

  it("Unpin drops the pin in a merged PUT when the view is already pinned", async () => {
    SETTINGS = { sidebar_pins: ["v_mine"] };
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    const { calls } = captureWrites();

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "My open bugs"' }));
    // Already pinned → the toggle reads "Unpin".
    fireEvent.click(screen.getByText("Unpin"));

    await waitFor(() => {
      const puts = calls.filter(c => c.method === "PUT" && c.url.includes("/api/user-settings"));
      expect(puts.length).toBe(1);
      expect(puts[0]?.body).toMatchObject({ sidebar_pins: [] });
    });
  });

  it("a broken-view row offers Edit but not Pin", async () => {
    BROKEN_VIEWS = [
      { id: "v_bad", name: "Bad view", summary: "not a query", error: "parse error", index: 1, rawText: "id: v_bad" },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("Bad view");

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "Bad view"' }));
    // Edit (VUE-22 fix path) and Delete are offered; Pin is not.
    expect(screen.getByTestId("broken-view-edit")).toBeTruthy();
    expect(screen.getByTestId("broken-view-delete")).toBeTruthy();
    expect(screen.queryByText(/^Pin/)).toBeNull();
    expect(screen.queryByText("Unpin")).toBeNull();
  });

  /**
   * The broken-view repair path, and the data-loss defect it used to be.
   *
   * A broken entry's full original YAML survives on disk in `rawText` and
   * is re-emitted verbatim by every unrelated write (P-11 / K28 /
   * Phase-Z-C2). Edit… seeds an EMPTY picker (K102 — the stored filters
   * did not load, so there is nothing faithful to seed), and Save used to
   * fire a plain `editView`, replacing that preserved text with
   * `filters: []`. The one control offered to repair the entry was the
   * only thing in the product that could destroy it.
   *
   * The test below that previously asserted "opens on an empty picker"
   * was GREEN while that held, because an empty picker is exactly what
   * the destructive path looks like from the outside. It was asserting
   * the bug. It is replaced by these three.
   */
  const BROKEN_ONE = {
    id: "v_bad",
    name: "Bad view",
    summary: "broken dsl",
    error: "filters[0].op is not a comparison operator",
    index: 1,
    rawText: "id: v_bad\nname: Bad view\nfilters:\n  - kind: simple\n    field: status\n    op: WAT\n    values: [done]\nsort:\n  - field: priority\n    dir: desc\n",
  };

  /**
   * Renders, then opens the broken row's Edit dialog, capturing writes in
   * between. `captureWrites` must come AFTER `renderSidebarAt` — the
   * latter installs its own fetch stub and would drop the spy.
   */
  async function openBrokenEdit(): Promise<{ calls: { method: string; url: string; body: unknown }[] }> {
    await renderSidebarAt("/list");
    await screen.findByText("Bad view");
    const captured = captureWrites();
    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "Bad view"' }));
    fireEvent.click(screen.getByTestId("broken-view-edit"));
    await screen.findByTestId("view-edit-dialog");
    await screen.findByTestId("view-filter-field-0");
    return captured;
  }

  // @verifies VUE-42
  it("Edit on a broken row will NOT save an empty filter list over the preserved text", async () => {
    // THE regression guard for the data-loss defect. Everything a user
    // could do to trigger the old overwrite — open Edit, click Save —
    // must issue NO write at all while the replacement is unconfirmed.
    BROKEN_VIEWS = [BROKEN_ONE];
    const { calls } = await openBrokenEdit();

    const save = screen.getByTestId<HTMLButtonElement>("view-form-save");
    expect(save.disabled).toBe(true);
    fireEvent.click(save);

    // Give any in-flight mutation a chance to land before asserting none
    // did — a false green here would be indistinguishable from the fix.
    await waitFor(() => { expect(screen.getByTestId("view-edit-dialog")).toBeTruthy(); });
    expect(calls.filter(c => c.url.includes("/api/views/"))).toEqual([]);
  });

  // @verifies VUE-22, VUE-42
  it("Edit on a broken row shows the parse error and the YAML still on disk", async () => {
    // The user hand-edited the file; the only honest thing to show them
    // is what they wrote plus why it did not load. An empty picker alone
    // implies the view had no filters — it had filters that did not load.
    BROKEN_VIEWS = [BROKEN_ONE];
    await openBrokenEdit();

    expect(screen.getByTestId("view-form-broken-error").textContent)
      .toContain("filters[0].op is not a comparison operator");
    expect(screen.getByTestId<HTMLTextAreaElement>("view-form-broken-raw").value)
      .toBe(BROKEN_ONE.rawText);
    // Still the empty picker for the rebuild (K102), and still no DSL box.
    expect(screen.getByTestId<HTMLInputElement>("view-form-name").value).toBe("Bad view");
    expect(comboValue("view-filter-field-0")).toBe("");
    expect(screen.queryByTestId("dsl-input")).toBeNull();
  });

  it("replaces a broken view only after the user confirms the text will be discarded", async () => {
    // Discarding recoverable text stays possible — it must just be a
    // deliberate act. Ticking the confirmation is that act.
    BROKEN_VIEWS = [BROKEN_ONE];
    const { calls } = await openBrokenEdit();

    fireEvent.click(screen.getByTestId("view-form-confirm-replace"));
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>("view-form-save").disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("view-form-save"));

    await waitFor(() => {
      const puts = calls.filter(c => c.method === "PUT" && c.url.includes("/api/views/v_bad"));
      expect(puts.length).toBe(1);
      // K102-broken-repair: the tick has to reach the SERVER. This test
      // previously asserted only `{name, filters}` — a body the server
      // REJECTS for a broken entry, so the dialog looked like it worked
      // while every confirmed replace came back 400. Asserting the flag
      // is what makes this a test of the repair rather than of the
      // checkbox.
      expect(puts[0]?.body).toMatchObject({
        name: "Bad view",
        filters: [],
        replaceBroken: true,
      });
    });
  });

  it("deleting a broken row sends the replaceBroken opt-in the server requires", async () => {
    // The broken row's Delete… goes through DeleteViewDialog, whose
    // confirmation IS the explicit consent. Without carrying it to the
    // server the delete comes back 400 and the dead control stays dead.
    BROKEN_VIEWS = [BROKEN_ONE];
    await renderSidebarAt("/list");
    await screen.findByText("Bad view");
    const { calls } = captureWrites();

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "Bad view"' }));
    fireEvent.click(screen.getByTestId("broken-view-delete"));
    const confirm = await screen.findByTestId("delete-view-confirm");
    fireEvent.click(confirm);

    await waitFor(() => {
      const dels = calls.filter(c => c.method === "DELETE" && c.url.includes("/api/views/v_bad"));
      expect(dels.length).toBe(1);
      expect(dels[0]?.url).toContain("replaceBroken=true");
    });
  });

  it("deleting a HEALTHY view does not send replaceBroken", async () => {
    // Constraint 4: the normal delete's request is unchanged.
    VIEWS = [{ id: "v_ok", name: "Healthy view", filters: [] }];
    BROKEN_VIEWS = [];
    await renderSidebarAt("/list");
    await screen.findByText("Healthy view");
    const { calls } = captureWrites();

    fireEvent.click(screen.getByRole("button", { name: 'Actions for saved filter "Healthy view"' }));
    fireEvent.click(screen.getByTestId("view-delete"));
    fireEvent.click(await screen.findByTestId("delete-view-confirm"));

    await waitFor(() => {
      const dels = calls.filter(c => c.method === "DELETE" && c.url.includes("/api/views/v_ok"));
      expect(dels.length).toBe(1);
      expect(dels[0]?.url).not.toContain("replaceBroken");
    });
  });

  it("hides an archived view from the sidebar", async () => {
    // @verifies VUE-25 (sidebar half) — archived views stay in queries.yaml
    // but must not appear in the sidebar, like every other group.
    VIEWS = [
      { id: "v_mine", name: "My open bugs", filters: [] },
      { id: "v_old", name: "Archived thing", filters: [], archived: true },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    expect(screen.queryByText("Archived thing")).toBeNull();
  });
});

/**
 * LST-55 (UX-3): a sidebar navigation is a jump to a destination, not a
 * re-sort of the current table. The ambient `sort`/`dir` in the URL must
 * not ride along into the destination filter/view, or a saved "Blocked"
 * filter would open in whatever order the last table happened to use.
 *
 * The `<Link>`s compute their href from the *current* search, so
 * rendering at `/list?sort=priority&dir=asc` and reading each link's href
 * proves the strip without needing to click through the router.
 */
describe("Sidebar strips the ambient sort from nav hrefs (LST-55)", () => {
  const AMBIENT = { sort: "priority", dir: "asc" };
  const hrefOf = (el: HTMLElement): string =>
    el.closest("a")?.getAttribute("href") ?? "";

  it("a built-in filter link drops sort and dir", async () => {
    // @verifies LST-55
    await renderSidebarAt("/list", AMBIENT);
    const href = hrefOf(await screen.findByText("Assigned to me"));
    expect(href).not.toContain("sort=");
    expect(href).not.toContain("dir=");
  });

  it("a project link drops sort and dir", async () => {
    // @verifies LST-55
    await renderSidebarAt("/list", AMBIENT);
    const href = hrefOf(await screen.findByText("Web"));
    expect(href).not.toContain("sort=");
    expect(href).not.toContain("dir=");
  });

  it("the All-projects link drops sort and dir", async () => {
    // @verifies LST-55
    await renderSidebarAt("/list", AMBIENT);
    const href = hrefOf(await screen.findByText("All projects"));
    expect(href).not.toContain("sort=");
    expect(href).not.toContain("dir=");
  });

  it("a saved-view link drops sort and dir", async () => {
    // @verifies LST-55 — a saved view carries its own configured order;
    // the ambient sort must not override it.
    await renderSidebarAt("/list", AMBIENT);
    const href = hrefOf(await screen.findByText("My open bugs"));
    expect(href).not.toContain("sort=");
    expect(href).not.toContain("dir=");
    // The view itself is still applied — only the sort is stripped.
    expect(href).toContain("view=v_mine");
  });

  it("milestone / sprint / label links drop sort and dir", async () => {
    // @verifies LST-55
    await renderSidebarAt("/list", AMBIENT);
    for (const label of ["v1.0", "Sprint 12", "frontend"]) {
      const href = hrefOf(await screen.findByText(label));
      expect(href, `${label} href`).not.toContain("sort=");
      expect(href, `${label} href`).not.toContain("dir=");
    }
  });

  it("preserves a non-sort param while dropping the sort", async () => {
    // @verifies LST-55 — the strip is surgical: pagination and other
    // params survive, only sort/dir go.
    await renderSidebarAt("/list", { ...AMBIENT, offset: "50" });
    const href = hrefOf(await screen.findByText("Assigned to me"));
    expect(href).toContain("offset=50");
    expect(href).not.toContain("sort=");
  });
});

/**
 * The cross-view scope fix (Ken 2026-09-20): List/Board/Timeline share
 * the filter scope. The view switcher must CARRY the filter keys and DROP
 * the view-private display params when moving between views, and a project
 * click made on the board/timeline must stay on that view rather than
 * jumping to /list.
 *
 * These need the sibling view routes registered so TanStack can produce
 * real hrefs for `to="/board"`/`to="/timeline"` and so the Sidebar can
 * mount at those paths — the shared `renderSidebarAt` only knows `/list`.
 * The `<Link>`s compute their href from the current search + pathname, so
 * reading each href proves the behaviour without clicking through.
 */
describe("Sidebar cross-view filter scope (2026-09-20)", () => {
  async function renderShellAt(pathname: string, search: Record<string, unknown> = {}) {
    if (priorQc) {
      await priorQc.cancelQueries();
      priorQc.clear();
    }
    stubFetch();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    priorQc = qc;

    const rootRoute = createRootRoute();
    const sidebar = () => (
      <Sidebar collapsed={false} currentUserId="u_ken" today="2026-06-08" />
    );
    const routes = (["/list", "/board", "/timeline"] as const).map(path =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        validateSearch: (s: Record<string, unknown>) => s,
        component: sidebar,
      }),
    );
    const router = createRouter({
      routeTree: rootRoute.addChildren(routes),
      history: createMemoryHistory({
        initialEntries: [
          `${pathname}?${new URLSearchParams(
            Object.fromEntries(Object.entries(search).map(([k, v]) => [k, String(v)])),
          ).toString()}`,
        ],
      }),
    });

    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    await screen.findByText("Projects");
  }

  const hrefOf = (el: HTMLElement): string => el.closest("a")?.getAttribute("href") ?? "";

  it("the view switcher carries filter keys to the sibling view", async () => {
    await renderShellAt("/list", {
      status: "in_progress",
      project: "p_api",
      labels: "l_fe",
      archived: "true",
    });
    // The Board and Timeline switcher links keep the scope. (Decoded and
    // matched by value, since this harness JSON-encodes array params
    // rather than using the app's CSV serializer.)
    for (const name of ["Board", "Timeline"]) {
      const href = decodeURIComponent(hrefOf(await screen.findByText(name)));
      expect(href, `${name} keeps status`).toContain("in_progress");
      expect(href, `${name} keeps project`).toContain("p_api");
      expect(href, `${name} keeps labels`).toContain("l_fe");
      expect(href, `${name} keeps archived`).toContain("archived=true");
    }
  });

  it("the view switcher drops view-private params (page/sort/dir/zoom/grouping/arrows)", async () => {
    await renderShellAt("/timeline", {
      status: "in_progress",
      page: "3",
      sort: "title",
      dir: "desc",
      zoom: "month",
      grouping: "assignee",
      arrows: "true",
    });
    // Switching to the List keeps the filter, drops the display state.
    const href = decodeURIComponent(hrefOf(await screen.findByText("List")));
    expect(href).toContain("in_progress");
    for (const key of ["page=", "sort=", "dir=", "zoom=", "grouping=", "arrows="]) {
      expect(href, `List drops ${key}`).not.toContain(key);
    }
  });

  it("a project link on /board stays on /board and keeps display state", async () => {
    await renderShellAt("/board", { status: "in_progress" });
    // The project link (and All-projects) target /board, not /list.
    const web = hrefOf(await screen.findByText("Web"));
    expect(web.startsWith("/board")).toBe(true);
    // The project scope rides along (this test harness JSON-encodes the
    // array param rather than CSV; the point is the value is present and
    // the destination is /board, not /list).
    expect(decodeURIComponent(web)).toContain("p_web");
    const all = hrefOf(await screen.findByText("All projects"));
    expect(all.startsWith("/board")).toBe(true);
  });

  it("a project link on /list still targets /list", async () => {
    await renderShellAt("/list");
    const web = hrefOf(await screen.findByText("Web"));
    expect(web.startsWith("/list")).toBe(true);
  });

  it("a milestone link targets the milestone detail page (U14 merge)", async () => {
    // U14/K105: a sidebar milestone now opens the milestone DETAIL page
    // (/milestones/$id) — the superset surface — so the sidebar and the
    // "All milestones" list reach the same one UI. It used to target
    // /list?milestone=; that behavior was the bug this merge fixes.
    await renderShellAt("/board");
    const milestone = hrefOf(await screen.findByText("v1.0"));
    expect(milestone.startsWith("/milestones/")).toBe(true);
    expect(milestone.startsWith("/list")).toBe(false);
  });

  it("a sprint/label link stays on /list", async () => {
    // Sprints and labels remain list-shaped filters (a label is not a
    // page); only milestones gained a detail destination (U14).
    await renderShellAt("/board");
    const label = hrefOf(await screen.findByText("frontend"));
    expect(label.startsWith("/list")).toBe(true);
  });
});

/**
 * S-11 / S-8: the sidebar's decorative glyphs come from tokens and the
 * unified icon set, not hardcoded hex or an ad-hoc star.
 */
describe("Sidebar tokens and icon glyphs (S-11, S-8)", () => {
  it("the all-projects dot uses a CSS-variable colour, not hardcoded hex", async () => {
    // Covers S-11 (review item; no case ID).
    //
    // UI-20 (2026-09-23) deleted the per-project item dot this test used
    // to check (`ColorDot color="var(--status-active-fg)"` on every
    // project row) — it was a hardcoded constant colour encoding
    // nothing, not a token-vs-hex question, so there is no longer a dot
    // on a project ITEM row to assert about. The "All projects" anchor
    // row still carries a dot (a neutral "nothing scoped" marker, not a
    // per-project mark), so the token-not-hex assertion moves there; the
    // second half of this test now checks the item row has no dot at all.
    await renderSidebarAt("/list");
    const allProjects = (await screen.findByText("All projects")).closest("a") as HTMLElement;
    const dot = allProjects.querySelector("span[style]") as HTMLElement;
    // A token reference, never a raw #RRGGBB.
    expect(dot.getAttribute("style") ?? "").toMatch(/var\(--/);
    expect(dot.getAttribute("style") ?? "").not.toMatch(/#[0-9a-fA-F]{6}/);

    const web = (await screen.findByText("Web")).closest("a") as HTMLElement;
    expect(web.querySelector("span[style]")).toBeNull();
  });

  it("the default-project star is an SVG icon, not a text glyph", async () => {
    // Was: `expect(marker.textContent).toBe("⭑")` — asserting the marker
    // IS a Unicode character. That pinned the defect. Ken, 2026-09-22:
    // "what did i say about fucking using unicode characters for icons?!
    // ... only acceptable thing are user-assigned icons for saved views."
    // A208 (2026-09-19) had already ruled glyph affordances out and built
    // `ui/Icon.tsx`; seven call sites were missed by that migration and
    // this test held one of them in place.
    await renderSidebarAt("/list");
    const marker = await screen.findByTitle("Default project");
    expect(marker.querySelector("svg")).not.toBeNull();
    // No text glyph of any kind — neither the old ★ nor ICON.star's ⭑.
    expect(marker.textContent).toBe("");
  });
});

/**
 * UI-19: the saved-view `icon` field (K104) was fully plumbed —
 * contracts, core, CLI, MCP — but rendered nowhere: the sidebar row
 * hardcoded a star for every view regardless of what `icon` held. The
 * fix renders the view's own icon via `IconGlyph` (the shared read-side
 * renderer, A279) when set, falling back to the star otherwise.
 */
describe("Sidebar saved-view icon (UI-19)", () => {
  it("renders the view's own icon when set, not the star", async () => {
    VIEWS = [
      {
        id: "v_mine",
        name: "My open bugs",
        filters: [{ kind: "simple", field: "status", op: "in", values: ["backlog"] }],
        // `globe` is a real LUCIDE_CATALOG entry.
        icon: "globe",
      },
    ];
    await renderSidebarAt("/list");

    const row = (await screen.findByText("My open bugs")).closest("a") as HTMLElement;
    // `Icon.tsx`'s hand-drawn `star` glyph is this exact path (Icon.tsx:101).
    // It must NOT be present once a real icon is set.
    const starPath = 'path[d^="M8 2.5l1.7 3.5"]';
    expect(row.querySelector(starPath)).toBeNull();
    // The Lucide `globe` glyph (via `IconGlyph`) renders as some other SVG.
    expect(row.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the star when the view has no icon", async () => {
    VIEWS = [
      {
        id: "v_mine",
        name: "My open bugs",
        filters: [{ kind: "simple", field: "status", op: "in", values: ["backlog"] }],
      },
    ];
    await renderSidebarAt("/list");

    const row = (await screen.findByText("My open bugs")).closest("a") as HTMLElement;
    const starPath = 'path[d^="M8 2.5l1.7 3.5"]';
    expect(row.querySelector(starPath)).not.toBeNull();
  });
});

/**
 * R2: on a narrow viewport an *expanded* sidebar (`collapsed={false}`) is
 * a floating overlay with a tap-away backdrop, not the in-grid column.
 * `renderSidebarAt` mounts with `collapsed={false}`, so a narrow width is
 * enough to exercise the overlay branch.
 */
describe("Sidebar mobile overlay (R2)", () => {
  function setWidth(px: number): void {
    Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
  }
  afterEach(() => { setWidth(1200); });

  it("renders a dismiss backdrop and floats the panel when narrow + expanded", async () => {
    // Covers R2 (review item; no case ID)
    setWidth(380);
    await renderSidebarAt("/list");
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.getAttribute("data-overlay")).toBe("true");
    // The panel floats over the main pane rather than widening the grid.
    expect(aside.className).toContain("fixed");
    expect(screen.getByTestId("sidebar-overlay-backdrop")).toBeTruthy();
  });

  it("is the ordinary in-grid column on a wide viewport", async () => {
    // Covers R2 (review item; no case ID) — desktop is unchanged: no overlay, no backdrop.
    setWidth(1200);
    await renderSidebarAt("/list");
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.getAttribute("data-overlay")).toBeNull();
    expect(screen.queryByTestId("sidebar-overlay-backdrop")).toBeNull();
  });

  it("a tap on the backdrop requests a dismiss (tap-away)", async () => {
    // Covers R2 (review item; no case ID) — the backdrop click fires the collapse signal the
    // hook listens for. We listen for that same window event here.
    setWidth(380);
    await renderSidebarAt("/list");
    let dismissed = false;
    const onCollapse = (): void => { dismissed = true; };
    window.addEventListener("loctt:sidebar-collapse", onCollapse);
    try {
      fireEvent.click(screen.getByTestId("sidebar-overlay-backdrop"));
      expect(dismissed).toBe(true);
    } finally {
      window.removeEventListener("loctt:sidebar-collapse", onCollapse);
    }
  });

  // The mobile drawer is now a proper modal dialog (B3 review blocker):
  // role="dialog" + aria-modal, a close button, Escape-to-close, and a
  // focus trap — not a bare floating <aside>.
  it("the drawer is a role=dialog with aria-modal", async () => {
    setWidth(380);
    await renderSidebarAt("/list");
    const aside = document.querySelector("aside") as HTMLElement;
    // Red-proof: the pre-fix overlay <aside> had neither attribute, so a
    // dialog role/modal flag would fail against it.
    expect(aside.getAttribute("role")).toBe("dialog");
    expect(aside.getAttribute("aria-modal")).toBe("true");
    expect(aside.getAttribute("aria-label")).toBe("Navigation");
  });

  it("has a close button that requests a dismiss", async () => {
    setWidth(380);
    await renderSidebarAt("/list");
    let dismissed = false;
    const onCollapse = (): void => { dismissed = true; };
    window.addEventListener("loctt:sidebar-collapse", onCollapse);
    try {
      fireEvent.click(screen.getByTestId("sidebar-overlay-close"));
      expect(dismissed).toBe(true);
    } finally {
      window.removeEventListener("loctt:sidebar-collapse", onCollapse);
    }
  });

  it("Escape requests a dismiss", async () => {
    setWidth(380);
    await renderSidebarAt("/list");
    let dismissed = false;
    const onCollapse = (): void => { dismissed = true; };
    window.addEventListener("loctt:sidebar-collapse", onCollapse);
    try {
      fireEvent.keyDown(document, { key: "Escape" });
      expect(dismissed).toBe(true);
    } finally {
      window.removeEventListener("loctt:sidebar-collapse", onCollapse);
    }
  });

  it("traps focus: it moves focus into the drawer on open", async () => {
    setWidth(380);
    await renderSidebarAt("/list");
    const aside = document.querySelector("aside") as HTMLElement;
    // useFocusTrap lands focus inside the panel on mount (its first tab
    // stop or the panel itself) — never left on document.body, from which
    // the next Tab would restart at the top of the page behind the drawer.
    expect(document.activeElement).not.toBe(document.body);
    expect(aside.contains(document.activeElement)).toBe(true);
  });

  it("does not cover the header: the drawer starts below it", async () => {
    setWidth(380);
    await renderSidebarAt("/list");
    // The drawer (and its scrim) start at the 48px header height so the
    // hamburger that opens/closes it stays reachable — it must not be
    // pinned to `top-0`.
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.style.top).toBe("3rem");
    const backdrop = screen.getByTestId("sidebar-overlay-backdrop");
    expect(backdrop.style.top).toBe("3rem");
  });
});

/**
 * #9 (Ken 2026-09-20): on a NARROW viewport there is no persistent in-grid
 * icon rail. The collapsed narrow state renders nothing at all — the header
 * hamburger opens the drawer overlay, which is the sole nav. Desktop keeps
 * the collapsed rail. `renderSidebarWith` mounts at an explicit `collapsed`
 * so both the narrow-collapsed (drawer-only) and wide-collapsed (rail)
 * branches can be exercised; it does not await "Projects" because a
 * collapsed sidebar hides the group labels (and the narrow-collapsed case
 * renders nothing).
 */
describe("Sidebar narrow rail suppression (#9)", () => {
  function setWidth(px: number): void {
    Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
  }
  afterEach(() => { setWidth(1200); });

  async function renderSidebarWith(collapsed: boolean): Promise<void> {
    if (priorQc) {
      await priorQc.cancelQueries();
      priorQc.clear();
    }
    stubFetch();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    priorQc = qc;
    const rootRoute = createRootRoute();
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/list",
      validateSearch: (s: Record<string, unknown>) => s,
      component: () => (
        <Sidebar collapsed={collapsed} currentUserId="u_ken" today="2026-06-08" />
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([listRoute]),
      history: createMemoryHistory({ initialEntries: ["/list"] }),
    });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    // Give the router a tick to resolve; do not depend on group text
    // (hidden while collapsed, absent when narrow-collapsed renders null).
    await waitFor(() => {
      expect(router.state.status).toBe("idle");
    });
  }

  it("renders NO in-grid sidebar element when narrow + collapsed (drawer-only)", async () => {
    // Red-proof: before the fix, narrow + collapsed rendered a persistent
    // `w-14` icon rail <aside>, so this <aside> query returned an element.
    setWidth(380);
    await renderSidebarWith(true);
    expect(document.querySelector("aside")).toBeNull();
    // And no backdrop either — the drawer is closed, nothing floats.
    expect(screen.queryByTestId("sidebar-overlay-backdrop")).toBeNull();
  });

  it("still renders the collapsed icon RAIL on a wide viewport (desktop unchanged)", async () => {
    setWidth(1200);
    await renderSidebarWith(true);
    const aside = document.querySelector("aside") as HTMLElement;
    // Red-proof against a fix that hides the rail everywhere: the wide
    // collapsed column must remain, at its fixed rail width, in-grid.
    expect(aside).not.toBeNull();
    expect(aside.getAttribute("data-overlay")).toBeNull();
    expect(aside.className).toContain("w-14");
  });

  it("narrow + expanded still opens the drawer overlay (hamburger path intact)", async () => {
    // The hamburger flips collapsed→false; at narrow width that is the
    // overlay drawer, not an in-grid rail.
    setWidth(380);
    await renderSidebarWith(false);
    const aside = document.querySelector("aside") as HTMLElement;
    expect(aside.getAttribute("data-overlay")).toBe("true");
    expect(aside.getAttribute("role")).toBe("dialog");
    expect(screen.getByTestId("sidebar-overlay-backdrop")).toBeTruthy();
  });
});

/**
 * @verifies UI-16c
 *
 * A built-in filter row ends in a count `Badge`, inset by `ItemShell`'s
 * own `px-2.5`. A saved-view row ends in a kebab (`RowActions`) that is a
 * SIBLING of `ItemShell`, outside that padding — so it sat flush against
 * the sidebar edge, 8.75px further right, and the Views column's right
 * edge zig-zagged row to row. The fix matches the kebab wrapper's own
 * right padding to `ItemShell`'s, so both row kinds end at the same x.
 */
describe("Sidebar Views section trailing-slot alignment (UI-16c)", () => {
  it("insets the saved-view kebab wrapper by the same padding ItemShell gives a badge row's right edge", async () => {
    // jsdom does not lay out CSS, so this cannot assert actual pixel
    // positions (getBoundingClientRect is always zero) — it asserts the
    // class-level contract instead: `ItemShell`'s own right inset is
    // `px-2.5` (`Sidebar.tsx`'s `ItemShell`, the `collapsed ? … :
    // "gap-2.5 px-2.5"` branch), and a kebab wrapper — a SIBLING of
    // `ItemShell`, outside that padding — needs a matching `pr-2.5` of
    // its own or its trailing edge sits 8.75px further out than a
    // badge's. Live-measured in the browser (dev server, 1440x900): both
    // edges land at x=178.25 with the fix, x=178.25 vs x=187 without it.
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    const viewRow = document.querySelector("[data-view-row]");
    expect(viewRow?.className).toMatch(/\bpr-2\.5\b/);
  });
});

/**
 * @verifies K100
 *
 * Point-of-use editing (K100): the Labels / Milestones / Projects sidebar
 * rows carry a kebab, a SIBLING of the row `<Link>` (a `<button>` inside an
 * `<a>` is invalid HTML), that opens the SAME shared edit dialog the
 * Settings panel renders. Sprints get no dialog — their overview becomes
 * reachable via an "All sprints" row (editing stays on the detail page).
 */
describe("Sidebar point-of-use editing (K100)", () => {
  /** Open a data-row's kebab by its accessible label, then a MenuItem. */
  function openRowKebab(ariaLabelPrefix: string): void {
    const kebab = document.querySelector<HTMLButtonElement>(
      `[aria-label='${ariaLabelPrefix}']`,
    );
    if (kebab === null) throw new Error(`no kebab ${ariaLabelPrefix}`);
    fireEvent.click(kebab);
  }
  function clickMenuItem(testId: string): void {
    const item = document.querySelector<HTMLButtonElement>(`[data-testid='${testId}']`);
    if (item === null) throw new Error(`no menu item ${testId}`);
    fireEvent.click(item);
  }

  it("opens the shared LabelEditDialog, prefilled, from a label row kebab", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("frontend");

    openRowKebab('Actions for label "frontend"');
    clickMenuItem("sidebar-label-edit");

    // The SAME component the panel renders (its testid), seeded from the row.
    await screen.findByTestId("label-edit-dialog");
    const name = screen.getByTestId<HTMLInputElement>("label-name-input");
    expect(name.value).toBe("frontend");
    const color = screen.getByTestId<HTMLInputElement>("label-color-input");
    expect(color.value).toBe("#1e6fcb");
  });

  it("opens the shared MilestoneEditDialog, prefilled, from a milestone row kebab", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("v1.0");

    openRowKebab('Actions for milestone "v1.0"');
    clickMenuItem("sidebar-milestone-edit");

    await screen.findByTestId("milestone-edit-dialog");
    const name = screen.getByTestId<HTMLInputElement>("milestone-name-input");
    expect(name.value).toBe("v1.0");
  });

  it("opens the shared ProjectEditDialog, prefilled, from a project row kebab", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("Web");

    openRowKebab('Actions for project "Web"');
    clickMenuItem("sidebar-project-edit");

    await screen.findByTestId("project-edit-dialog-p_web");
    const name = screen.getByTestId<HTMLInputElement>("project-name-input-p_web");
    expect(name.value).toBe("Web");
  });

  it("has no 'Manage projects…' / 'Manage milestones…' item on the project or milestone kebab (UI-17 / K105)", async () => {
    // UI-17: Ken hit this a second time after K105 was recorded BUILT —
    // "if im on a task, i dont want to see a link to manage all tasks.
    // same for milestones/sprints/labels/etc." The persistent Settings
    // gear (Footer, below) reaches Settings → Projects/Milestones already,
    // so nothing is stranded by dropping the items. (Labels and Sprints
    // are covered by their own kebab describe blocks.)
    await renderSidebarAt("/list");
    await screen.findByText("Web");
    await screen.findByText("v1.0");

    openRowKebab('Actions for project "Web"');
    expect(document.querySelector("[data-testid='sidebar-project-manage']")).toBeNull();

    openRowKebab('Actions for milestone "v1.0"');
    expect(document.querySelector("[data-testid='sidebar-milestone-manage']")).toBeNull();
  });

  it("keeps the row's kebab a sibling of the Link, not a descendant of it", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("frontend");
    const kebab = document.querySelector<HTMLButtonElement>(
      `[aria-label='Actions for label "frontend"']`,
    );
    expect(kebab).not.toBeNull();
    // No enclosing anchor: a button in an anchor is invalid HTML.
    expect(kebab?.closest("a")).toBeNull();
  });

  it("offers Archive on the label kebab, with no 'Manage labels…' item (UI-17 / K105)", async () => {
    await renderSidebarAt("/list");
    await screen.findByText("frontend");
    openRowKebab('Actions for label "frontend"');
    expect(document.querySelector("[data-testid='sidebar-label-archive']")).not.toBeNull();
    // UI-17: Ken hit this a second time after K105 was recorded BUILT —
    // "if im on a task, i dont want to see a link to manage all tasks.
    // same for milestones/sprints/labels/etc." The persistent Settings
    // gear (Footer) reaches Settings → Labels already, so nothing is
    // stranded by dropping the item.
    expect(document.querySelector("[data-testid='sidebar-label-manage']")).toBeNull();
  });

  it("adds an 'All sprints' row linking to /sprints", async () => {
    await renderSidebarAt("/list");
    const link = await screen.findByTestId("sidebar-sprints-link");
    expect(link.getAttribute("href")).toBe("/sprints");
    expect(link.textContent).toMatch(/All sprints/);
  });

  it("UI-20: 'All milestones' and 'All sprints' draw no type glyph", async () => {
    // UI-20 (2026-09-23 designer ruling, live-scroll verified): sections
    // never orphan their items from their heading in practice (they're
    // small, and per-section collapse is the escape hatch for a long
    // one), so a type glyph is decoration, not wayfinding. This test used
    // to assert the two rows drew DIFFERENT glyphs (flag vs calendar) —
    // that was itself only a partial fix; the full fix drops the glyph
    // from both anchor rows rather than picking a distinguishing one.
    await renderSidebarAt("/list");
    const milestonesLink = await screen.findByTestId("sidebar-milestones-link");
    const sprintsLink = await screen.findByTestId("sidebar-sprints-link");
    expect(milestonesLink.querySelector("svg")).toBeNull();
    expect(sprintsLink.querySelector("svg")).toBeNull();
  });

  it("UI-25: every top-level row's mark slot is the same width, so labels share one x", async () => {
    // UI-25 measured eight distinct label-left positions live, split
    // between a `w-4` icon slot (glyph rows) and a bare 8px `ColorDot`
    // with no slot at all (dot rows) — a 7px ragged edge. The fix wraps
    // every dot in the same `w-4` slot the icon rows use (or leaves an
    // empty `w-4` slot where UI-20 removed the mark), rather than
    // special-casing dot rows. This checks the DOM-structural cause
    // directly: jsdom has no layout engine, so it cannot assert the
    // live pixel position UI-25 measured, but every representative row's
    // FIRST child element is the mark slot, and it must carry `w-4` —
    // that class is what produced one shared x live (re-measured against
    // the dev server: 38.5px for every one of these rows before and
    // after, see the ticket's before/after table).
    await renderSidebarAt("/list");
    const rowsByLabel: [label: string, testId?: string][] = [
      ["All projects"],
      ["Web"], // project item (dot slot, now empty — UI-20)
      ["Assigned to me"], // built-in filter (icon slot)
      ["My open bugs"], // saved view (icon slot)
      ["All milestones"],
      ["v1.0"], // milestone item
      ["All sprints"],
      ["Sprint 12"], // sprint item (dot slot — unchanged content)
      ["frontend"], // label item (dot slot — unchanged content)
    ];
    for (const [label] of rowsByLabel) {
      const el = await screen.findByText(label);
      const row = el.closest("a") as HTMLElement;
      // <a> > ItemShell's <span data-active|title|class> > mark slot
      // (first child). Go through the ItemShell wrapper explicitly
      // rather than guessing depth.
      const itemShell = row.firstElementChild as HTMLElement | null;
      const slot = itemShell?.firstElementChild ?? null;
      expect(slot, `${label}: no first-child slot found`).toBeTruthy();
      expect(slot?.className, `${label}: slot missing w-4`).toMatch(/\bw-4\b/);
    }
  });

  it("opens the New-project dialog in place (U10 — no longer deep-links to Settings)", async () => {
    // Was: asserted `sidebar-new-project` was a link whose href pointed at
    // /settings/projects. U10 reversed that behavior — clicking "+ New
    // project" now opens the shared CreateProjectDialog right there, no
    // navigation. The old assertion was encoding the deep-link behavior
    // Ken asked us to remove, so it is rewritten to the new contract.
    await renderSidebarAt("/list");
    const button = await screen.findByTestId("sidebar-new-project");
    // It is a button now, not an anchor — there is no href to follow.
    expect(button.getAttribute("href")).toBeNull();
    expect(screen.queryByTestId("project-create-name")).toBeNull();
    fireEvent.click(button);
    // The dialog's own field proves it opened in place.
    expect(await screen.findByTestId("project-create-name")).not.toBeNull();
  });
});

/**
 * CONFIG-5 / P4 + K100: the sprint sidebar rows gained a kebab. Sprint
 * *editing* lives on the `/sprints/:key` detail page (no dialog), so the
 * kebab only navigates: "Open sprint" → the detail page (where Edit
 * lives). UI-17 / K105 removed "Manage sprints…" — Ken: "if im on a
 * task, i dont want to see a link to manage all tasks. same for
 * milestones/sprints/labels/etc." The row's own click still filters the
 * list by that sprint.
 *
 * These need the `/sprints/$key` route registered so `navigate` resolves;
 * the shared `renderSidebarAt` only knows `/list`. The router is returned
 * so the test can read where a kebab action landed.
 */
describe("Sidebar sprint row kebab (CONFIG-5, K100)", () => {
  async function renderShellAt(pathname: string, search: Record<string, unknown> = {}) {
    if (priorQc) {
      await priorQc.cancelQueries();
      priorQc.clear();
    }
    stubFetch();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    priorQc = qc;

    const rootRoute = createRootRoute();
    const sidebar = () => (
      <Sidebar collapsed={false} currentUserId="u_ken" today="2026-06-08" />
    );
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/list",
      validateSearch: (s: Record<string, unknown>) => s,
      component: sidebar,
    });
    const sprintDetailRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/sprints/$key",
      validateSearch: (s: Record<string, unknown>) => s,
      component: () => <div>sprint detail</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([listRoute, sprintDetailRoute]),
      history: createMemoryHistory({
        initialEntries: [
          `${pathname}?${new URLSearchParams(
            Object.fromEntries(Object.entries(search).map(([k, v]) => [k, String(v)])),
          ).toString()}`,
        ],
      }),
    });

    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    await screen.findByText("Projects");
    return router;
  }

  function openKebab(ariaLabel: string): void {
    const kebab = document.querySelector<HTMLButtonElement>(`[aria-label='${ariaLabel}']`);
    if (kebab === null) throw new Error(`no kebab ${ariaLabel}`);
    fireEvent.click(kebab);
  }

  it("offers 'Open sprint' navigating to the sprint's detail page", async () => {
    const router = await renderShellAt("/list");
    await screen.findByText("Sprint 12");
    openKebab('Actions for sprint "Sprint 12"');
    const open = document.querySelector<HTMLButtonElement>("[data-testid='sidebar-sprint-open']");
    expect(open).not.toBeNull();
    await waitFor(() => {
      fireEvent.click(open as HTMLButtonElement);
    });
    // `/sprints/$key` is keyed by the sprint's ULID (route decision V3),
    // so Open sprint lands on `/sprints/<id>` — where Edit lives.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/sprints/sp_12");
    });
  });

  it("has no 'Manage sprints…' item on the kebab (UI-17 / K105)", async () => {
    await renderShellAt("/list");
    await screen.findByText("Sprint 12");
    openKebab('Actions for sprint "Sprint 12"');
    // UI-17: Ken hit this a second time after K105 was recorded BUILT —
    // "if im on a task, i dont want to see a link to manage all tasks.
    // same for milestones/sprints/labels/etc." The persistent Settings
    // gear (Footer) reaches Settings → Sprints already, so nothing is
    // stranded by dropping the item.
    const manage = document.querySelector<HTMLButtonElement>("[data-testid='sidebar-sprint-manage']");
    expect(manage).toBeNull();
  });

  it("keeps the row's filter-link: clicking the sprint name filters the list by it", async () => {
    const router = await renderShellAt("/list");
    const rowName = await screen.findByText("Sprint 12");
    // The name is inside the row `<Link>`; the kebab is a sibling. The
    // link still carries the `sprint: [id]` filter scope.
    const link = rowName.closest("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/list");
      expect(router.state.location.search).toMatchObject({ sprint: ["sp_12"] });
    });
  });

  it("puts the kebab OUTSIDE the row anchor (a button in an anchor is invalid HTML)", async () => {
    await renderShellAt("/list");
    await screen.findByText("Sprint 12");
    const kebab = document.querySelector<HTMLButtonElement>(
      "[aria-label='Actions for sprint \"Sprint 12\"']",
    );
    expect(kebab).not.toBeNull();
    expect(kebab?.closest("a")).toBeNull();
  });
});

/**
 * @verifies A244 (K100 point-of-use)
 *
 * Task 2: the sidebar's own layout config is reachable INLINE from the
 * sidebar, not only buried in Settings. A "Customize sidebar" affordance
 * in the footer opens the SAME `SidebarGroupsPanel` the Settings section
 * renders (K100 in-place tier — the panel is a self-contained editor that
 * owns its mutation), inside a Sheet. It is discoverable, keyboard-
 * reachable (a real <button>), writes the same `sidebar_groups` user
 * setting through the same PUT (no second source of truth), and is kept
 * out of the way on a narrow/overlay viewport.
 */
describe("Sidebar inline customize (A244, K100)", () => {
  function setWidth(px: number): void {
    Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
  }
  afterEach(() => { setWidth(1200); });

  /**
   * A self-contained render for the write test: a QueryClient with
   * `staleTime: Infinity` so the settings query settles once and stays
   * settled. The shared `renderSidebarAt` uses `gcTime: 0`, and the
   * mutation's `onMutate` cancels the user-settings query — against a
   * constantly-refetching query that cancel/refetch cycle starves the
   * `waitFor` and the PUT never gets to run. A stable cache avoids it,
   * and the PUT body is captured here from the first render.
   */
  async function renderWithPutCapture(): Promise<{ puts: Record<string, unknown>[] }> {
    const puts: Record<string, unknown>[] = [];
    if (priorQc) { await priorQc.cancelQueries(); priorQc.clear(); }
    const current = globalThis.fetch as typeof globalThis.fetch & { mockRestore?: () => void };
    current.mockRestore?.();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = raw.replace(/^https?:\/\/[^/]+/, "");
        if ((init?.method ?? "GET") === "PUT" && path.startsWith("/api/user-settings")) {
          const b = init?.body;
          const body = (typeof b === "string" ? JSON.parse(b) : {}) as Record<string, unknown>;
          puts.push(body);
          SETTINGS = body;
          return Promise.resolve(new Response(JSON.stringify({ user: "u_ken", settings: body }), {
            status: 200, headers: { "Content-Type": "application/json" },
          }));
        }
        return Promise.resolve(new Response(JSON.stringify(routeFetch(path)), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      },
    );
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    priorQc = qc;
    const rootRoute = createRootRoute();
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/list",
      validateSearch: (s: Record<string, unknown>) => s,
      component: () => (
        <Sidebar collapsed={false} currentUserId="u_ken" today="2026-06-08" />
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([listRoute]),
      history: createMemoryHistory({ initialEntries: ["/list"] }),
    });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    );
    await screen.findByText("Projects");
    return { puts };
  }

  it("shows a keyboard-reachable Customize sidebar button in the footer", async () => {
    // Red-proof: removing the affordance from Footer fails this. It is a
    // real <button> (focusable, Enter/Space-activatable) — not a div.
    await renderSidebarAt("/list");
    const btn = await screen.findByTestId("sidebar-customize");
    expect(btn.tagName).toBe("BUTTON");
    // Discoverable label, on the button itself or its accessible name.
    expect(btn.getAttribute("aria-label") ?? btn.textContent ?? "").toMatch(/Customize sidebar/i);
    // It sits in the pinned footer, not the scrolling groups region.
    const scroller = document.querySelector('[data-sidebar-scroll="true"]');
    expect(scroller?.contains(btn)).toBe(false);
  });

  it("opens the shared SidebarGroupsPanel in a sheet (not a fork)", async () => {
    // Red-proof: if the affordance opened something other than the shared
    // panel, `sidebar-groups-panel` (the panel's own testid) would be
    // absent. Reusing the SAME component is the K100 in-place requirement.
    await renderSidebarAt("/list");
    fireEvent.click(await screen.findByTestId("sidebar-customize"));
    await screen.findByTestId("sidebar-customize-sheet");
    // The exact Settings panel is mounted inside the sheet.
    expect(await screen.findByTestId("sidebar-groups-panel")).toBeTruthy();
    // Embedded: the sheet supplies the title, so the panel drops its <h1>.
    expect(screen.queryByTestId("settings-panel-title")).toBeNull();
  });

  it("opens the responsive primitive as a DIALOG on desktop, not a bare Sheet", async () => {
    // Ken flagged this: Customize sidebar used a bare `Sheet`, so it was a
    // bottom drawer even on desktop. It is now a `ResponsiveDialog`, which
    // is a centered Dialog at desktop width. Red-proof: the desktop Dialog
    // has no Sheet ✕ close button — if it reverted to a bare Sheet, the
    // `sidebar-customize-sheet-close` control would be present here.
    setWidth(1200);
    await renderSidebarAt("/list");
    fireEvent.click(await screen.findByTestId("sidebar-customize"));
    await screen.findByTestId("sidebar-customize-sheet");
    expect(await screen.findByTestId("sidebar-groups-panel")).toBeTruthy();
    // Desktop → Dialog → no Sheet header/close button.
    expect(screen.queryByTestId("sidebar-customize-sheet-close")).toBeNull();
  });

  it("writes the same sidebar_groups setting through the same PUT", async () => {
    // Red-proof: this is the "no second source of truth" guard. The inline
    // editor must hit PUT /api/user-settings with sidebar_groups, exactly
    // as the Settings panel does — a fork writing elsewhere fails here.
    const { puts } = await renderWithPutCapture();
    fireEvent.click(await screen.findByTestId("sidebar-customize"));
    await screen.findByTestId("sidebar-groups-panel");
    // Hide a group from inside the sheet.
    fireEvent.click(await screen.findByTestId("sidebar-group-toggle-labels"));
    await waitFor(() => { expect(puts.length).toBeGreaterThan(0); });
    const last = puts[puts.length - 1];
    const groups = last?.["sidebar_groups"] as { hidden?: string[] } | undefined;
    expect(groups?.hidden).toContain("labels");
  });

  it("hides the affordance on a narrow/overlay viewport", async () => {
    // The sidebar is a temporary drawer when narrow; a nested config sheet
    // over it is fiddly on a phone, so the affordance is withheld there
    // (the setting stays reachable from Settings). Red-proof: rendering it
    // in the overlay fails this.
    setWidth(380);
    await renderSidebarAt("/list");
    // The overlay drawer is up...
    expect(screen.getByTestId("sidebar-overlay-backdrop")).toBeTruthy();
    // ...and the customize affordance is not offered inside it.
    expect(screen.queryByTestId("sidebar-customize")).toBeNull();
    // The Settings link is still present as the fallback route to config.
    expect(screen.getByText("Settings").closest("a")).not.toBeNull();
  });
});

describe("K104-view-colour — a saved view's icon carries its colour", () => {
  it("tints a Lucide icon with the view's resolved colour", async () => {
    // The handoff from the colour work: the field existed end-to-end
    // (contracts, core, CLI, MCP, the edit dialog) but the sidebar
    // passed no `color`, so a view's colour was invisible exactly where
    // a user would look for it.
    VIEWS = [{ id: "v_tint", name: "Tinted", filters: [], icon: "circle-check", color: "#B02F17" }];
    await renderSidebarAt("/list");
    // Both the row link and its inner shell carry the title.
    const row = (await screen.findAllByTitle("Tinted"))[0] as HTMLElement;
    const svg = row.querySelector("svg");
    expect(svg).not.toBeNull();
    // `IconGlyph` forwards `color` to the Lucide component, which sets
    // it as the stroke colour.
    const painted = `${svg?.getAttribute("color") ?? ""}${svg?.getAttribute("stroke") ?? ""}${svg?.style.color ?? ""}`;
    expect(painted.toLowerCase()).toContain("b02f17");
  });
});
