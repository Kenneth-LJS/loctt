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
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { BoardView } from "./BoardView.tsx";

/**
 * Board point-of-use config affordances (BRD-52, K100).
 *
 * These cover the K100 assignment for the board: the column-header menu
 * (one in-place action — Hide — and two deep links), the toolbar
 * overflow deep links, and the drift banner's link to the panel. Board
 * columns are a whole-document editor the Settings panel owns, so per
 * K100 the config affordances are LINKS, not forked in-place editors;
 * the only in-place action is the per-user Hide (the same write the
 * chips bar makes).
 *
 * Mounted inside a memory router with the `/settings/$section` route
 * registered so `<Link>`s resolve to a real `href` we can assert on —
 * the same harness shape SprintsView.test.tsx uses.
 */

interface Status {
  key: string;
  label: string;
  category: string;
}
interface BoardCol {
  key: string;
  label: string;
  statuses: string[];
  wip?: number;
}

let STATUSES: Status[] = [{ key: "todo", label: "To do", category: "pending" }];
let BOARD_COLUMNS: BoardCol[] | undefined;
/** UI-8: cards for the column-spacing tests. Empty by default (unchanged for every other test). */
let TASKS: { id: string; key: string; status: string }[] = [];

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  if (path.startsWith("/api/tasks")) {
    return { items: TASKS, total: TASKS.length, offset: 0, limit: 200 };
  }
  if (path.startsWith("/api/workflow")) {
    return {
      statuses: STATUSES,
      priorities: [],
      task_types: [],
      ...(BOARD_COLUMNS !== undefined ? { boards: { columns: BOARD_COLUMNS } } : {}),
    };
  }
  if (path.startsWith("/api/user-settings")) {
    return { settings: {} };
  }
  if (path.startsWith("/api/projects")) {
    return { items: [], total: 0, offset: 0, limit: 1000, default: null };
  }
  if (path.startsWith("/api/users")) {
    return { items: [], total: 0, offset: 0, limit: 1000, current: null };
  }
  if (
    path.startsWith("/api/labels") ||
    path.startsWith("/api/milestones") ||
    path.startsWith("/api/sprints")
  ) {
    return { items: [], total: 0, offset: 0, limit: 1000 };
  }
  return {};
}

/** Records every PUT to /api/user-settings so the Hide write is provable. */
let SETTINGS_PUTS: unknown[] = [];

function stubFetch() {
  const current = globalThis.fetch as typeof globalThis.fetch & { mockRestore?: () => void };
  current.mockRestore?.();
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/api/user-settings") && (init?.method ?? "GET") !== "GET") {
      const body = init?.body;
      SETTINGS_PUTS.push(typeof body === "string" ? JSON.parse(body) : null);
      return Promise.resolve(new Response(JSON.stringify({ settings: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(routeFetch(path)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

let priorQc: QueryClient | undefined;

async function renderBoard() {
  if (priorQc) {
    await priorQc.cancelQueries();
    priorQc.clear();
  }
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  priorQc = qc;

  const rootRoute = createRootRoute();
  const boardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/board",
    component: () => (
      <CreateTaskProvider>
        <BoardView />
      </CreateTaskProvider>
    ),
  });
  // Registered so the deep links resolve to a concrete href.
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    component: () => <div data-testid="settings-stub" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([boardRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ["/board"] }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  STATUSES = [{ key: "todo", label: "To do", category: "pending" }];
  BOARD_COLUMNS = undefined;
  SETTINGS_PUTS = [];
  TASKS = [];
});

describe("BoardView — titled header (Ken 2026-09-20)", () => {
  it("renders a 'Board' h1 title", async () => {
    await renderBoard();
    const heading = await screen.findByRole("heading", { name: "Board", level: 1 });
    expect(heading.tagName).toBe("H1");
  });

  it("carries no actions in the header — no '+ Add task', and NO second ⋯ beside it (UI-3, UI-13)", async () => {
    await renderBoard();
    // UI-13: the header's own "+ Add task" called the identical
    // `createTask.open()` the shell header's "+ New task" already calls
    // — same modal, same fields, ~200px apart. It was removed as a
    // duplicate entry point; this used to assert the opposite
    // (`board-add-task` present in the header), which was pinning the
    // defect UI-13 exists to fix.
    expect(screen.queryByTestId("board-add-task")).toBeNull();
    // UI-3: this asserted `board-options-menu` — a SECOND ⋯ overflow in
    // the header, a few pixels from the filter bar's own ⋯ and at a
    // different size (24.5px vs 28px). That duplicate entry point was
    // the defect; its two deep links moved into the bar's single menu,
    // so the header must no longer carry an overflow of its own.
    expect(screen.queryByTestId("board-options-menu")).toBeNull();
    const header = await screen.findByTestId("board-header");
    expect(within(header).queryByRole("button", { name: /options/i })).toBeNull();
    expect(within(header).queryAllByRole("button")).toHaveLength(0);
  });

  // Cross-view layout standardisation (commit 02b05cd): the board root
  // shares the `p-4` / `gap-3` rhythm with List and Timeline.
  it("uses the shared p-4/gap-3 layout rhythm on its root container", async () => {
    await renderBoard();
    const root = await screen.findByTestId("board");
    expect(root.className).toContain("p-4");
    expect(root.className).toContain("gap-3");
    expect(root.className).not.toContain("p-6");
  });
});

describe("BoardView — column-header menu (BRD-52, K100)", () => {
  it("renders a menu on each column header with the three items", async () => {
    await renderBoard();

    const trigger = await screen.findByTestId("board-column-menu-todo");
    fireEvent.click(trigger);

    // In-place: Hide column.
    expect(screen.getByTestId("board-column-hide-todo").textContent).toContain("Hide column");
    // Deep links: labelled as navigation, not "Edit" in-place.
    expect(screen.getByTestId("board-column-wip-todo").textContent).toContain("Set WIP limit");
    expect(screen.getByTestId("board-column-edit-todo").textContent).toContain("Edit board columns");
  });

  /**
   * UI-3: "this surface" and "this item" must not be the same button.
   *
   * The per-column kebab and the page-level ⋯ both drew the identical
   * horizontal `more` glyph, so a column's menu looked like the view's
   * menu. The column one is now VERTICAL. Asserted on the rendered
   * geometry rather than a class name: the three dots must vary in `cy`
   * and share `cx` (vertical), which is precisely inverted if someone
   * swaps the glyph back to `more`.
   */
  it("draws the per-column kebab as a VERTICAL glyph, distinct from the page-level ⋯", async () => {
    await renderBoard();

    const trigger = await screen.findByTestId("board-column-menu-todo");
    const dots = Array.from(trigger.querySelectorAll("circle"));
    expect(dots).toHaveLength(3);
    const cx = new Set(dots.map(d => d.getAttribute("cx")));
    const cy = new Set(dots.map(d => d.getAttribute("cy")));
    // Vertical: one column of dots, three distinct rows.
    expect(cx.size).toBe(1);
    expect(cy.size).toBe(3);

    // And the page-level ⋯ stays horizontal — the contrast is the point.
    const pageLevel = screen.getByTestId("view-actions-menu");
    const pageDots = Array.from(pageLevel.querySelectorAll("circle"));
    expect(new Set(pageDots.map(d => d.getAttribute("cy"))).size).toBe(1);
    expect(new Set(pageDots.map(d => d.getAttribute("cx"))).size).toBe(3);
  });

  it("Hide column writes board_hidden_columns (the same per-user pref the chips bar sets)", async () => {
    await renderBoard();

    fireEvent.click(await screen.findByTestId("board-column-menu-todo"));
    fireEvent.click(screen.getByTestId("board-column-hide-todo"));

    await waitFor(() => {
      expect(SETTINGS_PUTS.length).toBeGreaterThan(0);
    });
    const put = SETTINGS_PUTS[0] as { board_hidden_columns?: string[] };
    expect(put.board_hidden_columns).toEqual(["todo"]);
  });

  it("'Edit board columns…' is a link to the board-columns settings section", async () => {
    await renderBoard();

    fireEvent.click(await screen.findByTestId("board-column-menu-todo"));
    const link = screen.getByTestId<HTMLAnchorElement>("board-column-edit-todo");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/settings/board-columns");
  });

  it("'Set WIP limit…' deep-links to the board-columns section with a #column-<id> anchor", async () => {
    await renderBoard();

    fireEvent.click(await screen.findByTestId("board-column-menu-todo"));
    const link = screen.getByTestId<HTMLAnchorElement>("board-column-wip-todo");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/settings/board-columns#column-todo");
  });
});

describe("BoardView — toolbar overflow (K100, merged per UI-3)", () => {
  // UI-3: these two links used to open from `board-options-menu`, the
  // board's own second ⋯. They are now a "Configure" section inside the
  // filter bar's single "View options" ⋯ — same labels, same hrefs,
  // same testIds, one menu. K100's rule (board config is reachable from
  // the board, as navigation not in-place edits) is unchanged.
  it("offers Customize columns… and Card layout… as deep links, from the ONE view-options menu", async () => {
    await renderBoard();

    fireEvent.click(await screen.findByTestId("view-actions-menu"));

    const columns = await screen.findByTestId<HTMLAnchorElement>("board-options-columns");
    expect(columns.tagName).toBe("A");
    expect(columns.getAttribute("href")).toBe("/settings/board-columns");

    const cardLayout = screen.getByTestId<HTMLAnchorElement>("board-options-card-layout");
    expect(cardLayout.tagName).toBe("A");
    expect(cardLayout.getAttribute("href")).toBe("/settings/card-layout");
  });
});

describe("BoardView — column drift banner (BRD-17, K100)", () => {
  it("links 'Board columns' to the panel when a column names a missing status", async () => {
    // A configured column naming a status workflow.yaml no longer defines.
    BOARD_COLUMNS = [{ key: "done", label: "Done", statuses: ["shipped"] }];
    await renderBoard();

    const banner = await screen.findByTestId("board-column-drift");
    const link = within(banner).getByTestId<HTMLAnchorElement>("board-column-drift-link");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/settings/board-columns");
  });
});

describe("BoardView — card-to-card gap (UI-8)", () => {
  // jsdom does not run layout, so this cannot assert the measured 7px
  // gap directly (that was verified live, at 1440x900, against the
  // built client — see docs/dev/design/ui-issues.md UI-8). What it CAN
  // assert, and what actually distinguishes the fix from the bug, is
  // the class-level cause: the list container no longer hands out a
  // margin to every flow child including the zero-height
  // `DropIndicator` (`space-y-2`/`space-y-*` on the scroll container),
  // and each card instead carries its own spacing directly.
  it("does not put space-y-* on the card list (the doubling cause)", async () => {
    TASKS = [
      { id: "01AAA", key: "APP-1", status: "todo" },
      { id: "01BBB", key: "APP-2", status: "todo" },
    ];
    await renderBoard();

    const column = await screen.findByTestId("board-column-todo");
    // Each card's `<article>` sits inside its own `mb-2` wrapper div
    // (see the next test), which is itself a flow child of the actual
    // scroll/list container — so the container under test is the
    // article's GRANDparent, not its immediate parent.
    const list = column.querySelector("article")?.parentElement?.parentElement;
    expect(list).not.toBeNull();
    expect(list?.className ?? "").not.toMatch(/\bspace-y-(?!0\b)/);
  });

  it("gives each card wrapper its own bottom margin instead", async () => {
    TASKS = [
      { id: "01AAA", key: "APP-1", status: "todo" },
      { id: "01BBB", key: "APP-2", status: "todo" },
    ];
    await renderBoard();

    const articles = await screen.findAllByRole("article");
    expect(articles).toHaveLength(2);
    // The card's own flow wrapper (its parent) carries the gap, so a
    // hidden `DropIndicator` sibling — 0 height, no margin of its own —
    // cannot add a second one next to it.
    for (const article of articles) {
      expect(article.parentElement?.className ?? "").toMatch(/\bmb-2\b/);
    }
  });

  it("still renders a DropIndicator between every pair of cards, ready to animate open on drag (BRD-11)", async () => {
    TASKS = [
      { id: "01AAA", key: "APP-1", status: "todo" },
      { id: "01BBB", key: "APP-2", status: "todo" },
    ];
    await renderBoard();

    await screen.findAllByRole("article");
    const indicators = screen.getAllByTestId("board-drop-indicator");
    // 2 cards -> 3 indicator slots (before, between, after), all inactive
    // at rest, all still present in the DOM so the drop gap can slide
    // rather than teleport (the indicator's own docstring).
    expect(indicators).toHaveLength(3);
    for (const indicator of indicators) {
      expect(indicator.getAttribute("data-active")).toBe("false");
      expect(indicator.className).toMatch(/\bh-0\b/);
    }
  });
});
