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
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const INFO: TrackerInfoResponse = {
  exists: true,
  taskCount: 7,
  keyPrefix: "WEB-",
  nextKey: "WEB-8",
  schemaStatus: { kind: "current", version: 3 },
  cwd: "~/PDev/loctt",
  today: "2026-08-14",
};

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
    return { queries: [{ id: "v_mine", name: "My open bugs", query: "x" }] };
  }
  if (path.startsWith("/api/milestones")) {
    return { items: [{ id: "m_v1", name: "v1.0" }], total: 1, offset: 0, limit: 100 };
  }
  if (path.startsWith("/api/sprints")) {
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
  if (path.startsWith("/api/tasks")) {
    return { total: 3 }; // built-in count badges
  }
  return {};
}

function stubFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
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
  });
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
      <Sidebar collapsed={false} info={INFO} currentUserId="u_ken" today="2026-06-08" />
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

  it("renders the empty-state note for recents", async () => {
    await renderSidebarAt("/list");
    expect(await screen.findByText("No recent tasks")).toBeTruthy();
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
    const highPriority = (await screen.findByText("High priority")).closest("a");
    expect(within(highPriority as HTMLElement).getByText("3")).toBeTruthy();
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
