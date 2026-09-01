// @vitest-environment jsdom
import type { TrackerInfoResponse } from "@loctt/contracts";
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

/** Overrides the workspace label, per-test (ONB-23, SHL-19). */
let CWD = "~/PDev/loctt";

/** Makes /api/views fail, per-test (SHL-32). */
let FAIL_VIEWS = false;

/** Saved views returned by /api/views, per-test (SHL-32). */
let VIEWS: { id: string; name: string; query: string }[] = [
  { id: "v_mine", name: "My open bugs", query: "x" },
];

const INFO: TrackerInfoResponse = {
  exists: true,
  taskCount: 7,
  keyPrefix: "WEB-",
  nextKey: "WEB-8",
  schemaStatus: { kind: "current", version: 3 },
  cwd: "~/PDev/loctt",
  today: "2026-08-14",
    timezone: "UTC",
};

/** `INFO` with the per-test workspace label applied. */
function info(): TrackerInfoResponse {
  return { ...INFO, cwd: CWD };
}

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
    return { queries: VIEWS };
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

async function renderSidebarAt(pathname: string, search: Record<string, unknown> = {}) {
  stubFetch();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/list",
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => (
      <Sidebar collapsed={false} info={info()} currentUserId="u_ken" today="2026-06-08" />
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
  vi.restoreAllMocks();
  RECENTS = [];
  EFFECTIVE_DEFAULT = undefined;
  PRIORITIES = undefined;
  WORKFLOW_STATUSES = [];
  CWD = "~/PDev/loctt";
  VIEWS = [{ id: "v_mine", name: "My open bugs", query: "x" }];
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
    for (const label of ["Projects", "Saved filters", "Milestones", "Sprints", "Labels", "Recently viewed"]) {
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

  it("hides completed sprints, shows active ones", async () => {
    await renderSidebarAt("/list");
    expect(await screen.findByText("Sprint 12")).toBeTruthy();
    expect(screen.queryByText("Sprint 11")).toBeNull();
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

  it("renders all six built-in filters including deferred 'Mentions me'", async () => {
    await renderSidebarAt("/list");
    for (const label of [
      "Assigned to me", "Reported by me", "Mentions me",
      "Due this week", "Overdue", "High priority",
    ]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it("shows live count badges on resolvable built-ins but not on 'Mentions me'", async () => {
    await renderSidebarAt("/list");
    // Stubbed /api/tasks returns total: 3 for every count query.
    //
    // The row starts inert — "High priority" resolves against the
    // workflow config (VUE-24), which arrives a tick later — so wait
    // for the link rather than for the text, which is present in both
    // states.
    const highPriority = await screen.findByRole("link", { name: /High priority/ });
    expect(within(highPriority).getByText("3")).toBeTruthy();
    // "Mentions me" is deferred: inert text, no link, no badge.
    const mentions = await screen.findByText("Mentions me");
    expect(mentions.closest("a")).toBeNull();
    expect(within(mentions.closest("div") as HTMLElement).queryByText("3")).toBeNull();
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
 * The footer names the workspace so two `loctt ui` windows are
 * distinguishable, and pins a Settings link beside it.
 */
describe("Sidebar footer (SHL-11)", () => {
  it("shows the workspace label and a Settings link", async () => {
    await renderSidebarAt("/list");

    expect(await screen.findByText("~/PDev/loctt")).toBeTruthy();
    const settings = screen.getByText("Settings").closest("a") as HTMLAnchorElement;
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
   * The workspace label truncates in place and keeps the Settings link
   * visible beside it.
   */
  it("truncates a long workspace path without displacing Settings", async () => {
    await renderSidebarAt("/list");

    const cwd = await screen.findByText("~/PDev/loctt");
    expect(cwd.className).toContain("truncate");
    expect(cwd.getAttribute("title")).toBe("~/PDev/loctt");
    expect(screen.getByText("Settings").closest("a")).not.toBeNull();
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
    // ...and the footer is not.
    const footer = screen.getByText("~/PDev/loctt");
    expect(scroller?.contains(footer)).toBe(false);
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
   *
   * No badge at all on "Mentions me" — not a `0`, which would be a
   * claim about data nobody has counted.
   */
  it("gives 'Mentions me' no badge and no link", async () => {
    await renderSidebarAt("/list");

    const mentions = await screen.findByText("Mentions me");
    expect(mentions.closest("a")).toBeNull();
    const row = mentions.closest("[aria-disabled]") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).not.toMatch(/\d/);
    expect(row.getAttribute("title")).toMatch(/comments/i);
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
describe("Sidebar footer with a very long workspace label", () => {
  it("truncates in place and keeps Settings reachable", async () => {
    // ~200 characters, of the shape `displayPath` actually emits.
    CWD = `~/${"deeply-nested-project-directory".repeat(3)}/${"another-long-segment-name".repeat(3)}`;
    expect(CWD.length).toBeGreaterThan(150);

    await renderSidebarAt("/list");

    const label = await screen.findByText(CWD);
    // Truncated by CSS rather than wrapped: one line, ellipsis.
    expect(label.className).toContain("truncate");
    // The full label is available on hover.
    expect(label.getAttribute("title")).toBe(CWD);

    // Settings is beside it, not pushed out of the footer.
    const settings = screen.getByText("Settings").closest("a") as HTMLAnchorElement;
    expect(settings.getAttribute("href")).toContain("/settings/");
    // And it is outside the scrolling region, so it cannot scroll away.
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
      { id: "v_mine", name: "My open bugs", query: "x" },
      { id: "v_gone", name: "Release blockers", query: "y" },
    ];
    await renderSidebarAt("/list");
    expect(await screen.findByText("Release blockers")).toBeTruthy();
    cleanup();

    // The user edits queries.yaml and refreshes.
    VIEWS = [{ id: "v_mine", name: "My open bugs", query: "x" }];
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
      { id: "v_mine", name: "My open bugs", query: "x" },
      { id: "v_gone", name: "Release blockers", query: "y" },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("Release blockers");
    cleanup();

    VIEWS = [{ id: "v_mine", name: "My open bugs", query: "x" }];
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
      { id: "v_mine", name: "My open bugs", query: "x" },
      { id: "v_gone", name: "Release blockers", query: "y" },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("Release blockers");
    cleanup();

    VIEWS = [{ id: "v_mine", name: "My open bugs", query: "x" }];
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
    VIEWS = [{ id: "v_mine", name: "My open bugs", query: "x" }];
    await renderSidebarAt("/list");
    await screen.findByText("My open bugs");
    expect(screen.queryByText(/was removed/)).toBeNull();
  });

  it("says nothing when the views request failed", async () => {
    // A failed read is not a deletion. Reporting every remembered pin
    // as removed because a request errored would be the same ERR-1
    // conflation one layer up.
    VIEWS = [
      { id: "v_mine", name: "My open bugs", query: "x" },
      { id: "v_gone", name: "Release blockers", query: "y" },
    ];
    await renderSidebarAt("/list");
    await screen.findByText("Release blockers");
    cleanup();

    FAIL_VIEWS = true;
    await renderSidebarAt("/list");
    await screen.findByText("Saved filters");
    expect(screen.queryByText(/was removed/)).toBeNull();
  });
});
