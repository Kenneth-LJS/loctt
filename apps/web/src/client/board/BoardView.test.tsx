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

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: "2026-06-08", timezone: "UTC" };
  }
  if (path.startsWith("/api/tasks")) {
    return { items: [], total: 0, offset: 0, limit: 200 };
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
});

describe("BoardView — titled header (Ken 2026-09-20)", () => {
  it("renders a 'Board' h1 title", async () => {
    await renderBoard();
    const heading = await screen.findByRole("heading", { name: "Board", level: 1 });
    expect(heading.tagName).toBe("H1");
  });

  it("keeps the '+ Add task' control in the header", async () => {
    await renderBoard();
    // The Add-task button moved into the PageHeader actions slot; it must
    // still be present and functional (NEW-1's board entry point).
    expect(await screen.findByTestId("board-add-task")).toBeTruthy();
    expect(screen.getByTestId("board-options-menu")).toBeTruthy();
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

describe("BoardView — toolbar overflow (K100)", () => {
  it("offers Customize columns… and Card layout… as deep links", async () => {
    await renderBoard();

    fireEvent.click(await screen.findByTestId("board-options-menu"));

    const columns = screen.getByTestId<HTMLAnchorElement>("board-options-columns");
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
