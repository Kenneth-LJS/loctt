// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MilestonesView } from "./MilestonesView.tsx";

/**
 * MilestonesView unreadable-notice test (Phase Z, data-flow finding 2).
 *
 * The guarantee under test: `GET /api/milestones?progress=true` carries
 * a top-level `unreadable` list (K28) when a task file cannot be read.
 * The view must SURFACE it — the totals it renders are short by that
 * many, and a silently-shortened total is exactly the undercount K28
 * forbids (P-5). Before the fix the client hook narrowed the response
 * to `.items` and dropped `unreadable`, so nothing on the page said why
 * a total was short.
 *
 * Harness mirrors SprintsView.test.tsx: stub `fetch` so each hook
 * resolves with canned data, mount inside a memory router, assert DOM.
 */

interface UnreadableEntry {
  readonly id: string;
  readonly path: string;
  readonly reason: string;
}

let MILESTONES: { id: string; name: string; target_date?: string; archived?: boolean; progress?: { done: number; total: number; discarded: number; fraction: number } }[] = [];
let UNREADABLE: UnreadableEntry[] = [];
let TASKS: Record<string, unknown>[] = [];
let TODAY = "2026-06-08";

function routeFetch(path: string): unknown {
  if (path.startsWith("/api/info")) {
    return { exists: true, initState: "ready", taskCount: 0, cwd: "~/x", today: TODAY, timezone: "UTC" };
  }
  if (path.startsWith("/api/milestones")) {
    return {
      items: MILESTONES,
      total: MILESTONES.length,
      offset: 0,
      limit: 1000,
      ...(UNREADABLE.length > 0 ? { unreadable: UNREADABLE } : {}),
    };
  }
  if (path.startsWith("/api/tasks")) {
    return { items: TASKS, total: TASKS.length, offset: 0, limit: 1000 };
  }
  if (path.startsWith("/api/calendar")) {
    return { timezone: "UTC" };
  }
  return {};
}

function stubFetch() {
  const current = globalThis.fetch as typeof globalThis.fetch & { mockRestore?: () => void };
  current.mockRestore?.();
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

let priorQc: QueryClient | undefined;

async function renderView() {
  if (priorQc) {
    await priorQc.cancelQueries();
    priorQc.clear();
  }
  stubFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  priorQc = qc;

  const rootRoute = createRootRoute();
  const milestonesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/milestones",
    component: () => <MilestonesView />,
  });
  // A stub detail route so a full-card click has somewhere to land and
  // the navigation is observable (MSL-39).
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/milestones/$id",
    component: function DetailStub() {
      return <div data-testid="detail-stub">detail</div>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([milestonesRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/milestones"] }),
  });

  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  MILESTONES = [];
  UNREADABLE = [];
  TASKS = [];
  TODAY = "2026-06-08";
});

describe("MilestonesView — unreadable task notice (K28 / P-5)", () => {
  it("surfaces the unreadable count when the progress response carries one", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    UNREADABLE = [
      { id: "tk_bad", path: ".loctt/tasks/tk_bad/task.md", reason: "invalid YAML" },
    ];
    await renderView();

    const notice = await screen.findByTestId("milestones-unreadable");
    // Names the count, so the reader knows the total below is short.
    expect(notice.textContent).toContain("1");
    expect(notice.textContent?.toLowerCase()).toContain("could not be read");
    // The healthy milestone still renders — one unreadable task never
    // blanks the surface.
    expect(await screen.findByTestId("milestone-row")).toBeTruthy();
  });

  it("renders no notice when nothing is unreadable", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 2, total: 2, discarded: 0, fraction: 1 } },
    ];
    UNREADABLE = [];
    await renderView();

    await screen.findByTestId("milestone-row");
    await waitFor(() => {
      expect(screen.queryByTestId("milestones-unreadable")).toBeNull();
    });
  });
});

describe("MilestonesView — per-milestone progress failure (MSL-35)", () => {
  // @verifies MSL-35
  it("shows one milestone's error row while its siblings show their numbers", async () => {
    // The exact case the documented ceiling blocked: a milestone whose
    // own progress could not be computed (server omits its `progress`,
    // so `progressState(undefined)` ⇒ kind "unavailable") renders the
    // named, retryable error IN PLACE of its numbers, while the other
    // milestones in the SAME list keep rendering their real done/total.
    // Under the old all-or-nothing scan this could not happen — a single
    // failure blanked every row's numbers together.
    MILESTONES = [
      // ms_bad: no `progress` field ⇒ unavailable (the attributed-failure
      // wire shape the server now emits for a per-milestone failure).
      { id: "ms_bad", name: "Broken" },
      // ms_ok: real numbers, must be untouched by the sibling's failure.
      { id: "ms_ok", name: "Healthy", progress: { done: 3, total: 5, discarded: 0, fraction: 0.6 } },
    ];
    await renderView();

    // The failing milestone shows its named error, not `0 / 0`.
    const errText = await screen.findByTestId("milestone-ms_bad-progress-error-text");
    expect(errText.textContent).toContain("Broken");
    expect(errText.textContent?.toLowerCase()).toContain("could not be computed");
    // It offers a retry (MSL-35's retryable affordance).
    expect(screen.getByTestId("milestone-ms_bad-progress-retry")).toBeTruthy();
    // The failing row shows NO numeric readout…
    expect(screen.queryByTestId("milestone-ms_bad-readout")).toBeNull();

    // …while the healthy sibling shows its real numbers simultaneously.
    const okReadout = screen.getByTestId("milestone-ms_ok-readout");
    expect(okReadout.textContent).toContain("3");
    expect(okReadout.textContent).toContain("5");
    // And the healthy sibling shows NO error row.
    expect(screen.queryByTestId("milestone-ms_ok-progress-error")).toBeNull();
  });
});

describe("MilestonesView — full-card click (MSL-39)", () => {
  // @verifies MSL-39
  it("clicking anywhere on the card opens the milestone", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    await renderView();

    const card = await screen.findByTestId("milestone-row");
    // A click on the card body — not on the name link itself — must
    // still navigate. Target the progress bar region, which is a
    // non-interactive descendant well away from the name link.
    const bar = await screen.findByTestId("milestone-ms_1-bar");
    fireEvent.click(bar);

    expect(await screen.findByTestId("detail-stub")).toBeTruthy();
    // The card advertises itself as clickable to assistive tech.
    expect(card.getAttribute("role")).toBe("link");
  });

  // @verifies MSL-39
  it("a click on a nested interactive control is not swallowed by the card", async () => {
    // A milestone whose progress failed renders a Retry button inside
    // the card (MSL-35). Clicking it must fire the button, not navigate.
    MILESTONES = [{ id: "ms_1", name: "v1" }]; // no progress ⇒ unavailable
    await renderView();

    await screen.findByTestId("milestone-row");
    const retry = await screen.findByTestId("milestone-ms_1-progress-retry");
    fireEvent.click(retry);

    // The retry re-runs the query; it does NOT navigate to the detail.
    await waitFor(() => {
      expect(screen.queryByTestId("detail-stub")).toBeNull();
    });
    // Still on the milestones view.
    expect(screen.getByTestId("milestones")).toBeTruthy();
  });
});

describe("MilestonesView — no countdown, no Overdue badge (K132, superseding MSL-40/MSL-17)", () => {
  // @verifies MSL-40
  // @verifies MSL-17
  it("shows neither a countdown nor an Overdue badge for a past-due milestone with open tasks", async () => {
    TODAY = "2026-06-08";
    MILESTONES = [
      {
        id: "ms_1",
        name: "v1",
        target_date: "2026-06-05", // 3 days ago, still incomplete
        progress: { done: 1, total: 4, discarded: 0, fraction: 0.25 },
      },
    ];
    await renderView();

    await screen.findByTestId("milestone-row");
    await waitFor(() => {
      expect(screen.queryByTestId("milestone-ms_1-countdown")).toBeNull();
      expect(screen.queryByTestId("milestone-overdue")).toBeNull();
    });
    // The date itself is still shown as-is.
    expect(screen.getByTestId("milestone-date").textContent).toContain(
      "Jun 5, 2026",
    );
  });

  // @verifies MSL-40
  // @verifies MSL-17
  it("shows neither a countdown nor an Overdue badge for a milestone dated ahead of today", async () => {
    TODAY = "2026-06-08";
    MILESTONES = [
      {
        id: "ms_1",
        name: "v1",
        target_date: "2026-06-13", // 5 days out
        progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 },
      },
    ];
    await renderView();

    await screen.findByTestId("milestone-row");
    await waitFor(() => {
      expect(screen.queryByTestId("milestone-ms_1-countdown")).toBeNull();
      expect(screen.queryByTestId("milestone-overdue")).toBeNull();
    });
    expect(screen.getByTestId("milestone-date").textContent).toContain(
      "Jun 13, 2026",
    );
  });

  // @verifies MSL-40
  it("degrades cleanly for an undated milestone — no countdown, no crash", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    await renderView();

    await screen.findByTestId("milestone-row");
    await waitFor(() => {
      expect(screen.queryByTestId("milestone-ms_1-countdown")).toBeNull();
    });
    // The date slot still reads "No target date", never blank.
    expect(screen.getByTestId("milestone-date").textContent).toContain(
      "No target date",
    );
  });
});

describe("MilestonesView — status breakdown (MSL-41)", () => {
  // @verifies MSL-41
  it("breaks the counts down by category at a glance", async () => {
    // 8 counted (total), 3 done ⇒ 5 remaining; 2 discarded excluded.
    MILESTONES = [
      {
        id: "ms_1",
        name: "v1",
        progress: { done: 3, total: 8, discarded: 2, fraction: 3 / 8 },
      },
    ];
    await renderView();

    const bd = await screen.findByTestId("milestone-ms_1-breakdown");
    const text = bd.textContent ?? "";
    expect(screen.getByTestId("milestone-ms_1-breakdown-done").textContent).toContain("3");
    expect(screen.getByTestId("milestone-ms_1-breakdown-remaining").textContent).toContain("5");
    expect(screen.getByTestId("milestone-ms_1-breakdown-discarded").textContent).toContain("2");
    expect(text.toLowerCase()).toContain("done");
    expect(text.toLowerCase()).toContain("remaining");
    expect(text.toLowerCase()).toContain("discarded");
  });

  // @verifies MSL-41
  it("omits the discarded chip when there are none", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 2, total: 5, discarded: 0, fraction: 0.4 } },
    ];
    await renderView();

    await screen.findByTestId("milestone-ms_1-breakdown");
    expect(screen.getByTestId("milestone-ms_1-breakdown-done").textContent).toContain("2");
    expect(screen.getByTestId("milestone-ms_1-breakdown-remaining").textContent).toContain("3");
    expect(screen.queryByTestId("milestone-ms_1-breakdown-discarded")).toBeNull();
  });

  // @verifies MSL-41
  it("shows no breakdown for a zero-task milestone", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 0, total: 0, discarded: 0, fraction: 0 } },
    ];
    await renderView();

    await screen.findByTestId("milestone-row");
    await waitFor(() => {
      expect(screen.queryByTestId("milestone-ms_1-breakdown")).toBeNull();
    });
  });
});

describe("MilestonesView — create affordance + copy (K105)", () => {
  it("carries no page-intro subhead or 'Settings → Milestones' pointer", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    await renderView();

    // K105 retired the "Manage them in Settings → Milestones" prose.
    // K129 pass: the subhead itself ("Progress toward every milestone,
    // with the tasks counting toward each.") was then removed entirely
    // as a page-intro (messaging.md §1 — the page's own progress bars
    // and task counts already show what it is for). No case requires a
    // subhead to exist (MSL-42 is about Settings' own copy, not this
    // page), so the element is gone rather than emptied.
    await screen.findByText("Milestones");
    expect(screen.queryByTestId("milestones-subhead")).toBeNull();
    expect(screen.queryByText(/settings/i)).toBeNull();
  });

  it("'+ New milestone' in the header opens the shared create dialog in place", async () => {
    MILESTONES = [
      { id: "ms_1", name: "v1", progress: { done: 1, total: 2, discarded: 0, fraction: 0.5 } },
    ];
    await renderView();

    // The affordance is a button on the page, not a deep link to a
    // Settings form.
    const newBtn = await screen.findByTestId("milestones-new");
    expect(newBtn.tagName).toBe("BUTTON");
    expect(screen.queryByTestId("milestone-create-dialog")).toBeNull();

    // Clicking it opens the SHARED dialog in its create mode, in place.
    fireEvent.click(newBtn);
    const dialog = await screen.findByTestId("milestone-create-dialog");
    expect(dialog).toBeTruthy();
    // The create-mode fields are present (name), confirming mode="create".
    expect(screen.getByTestId("milestone-create-name")).toBeTruthy();
  });

  it("empty state gives a '+ New milestone' button (no 'Settings → Milestones' prose)", async () => {
    MILESTONES = [];
    await renderView();

    const empty = await screen.findByTestId("milestones-empty");
    // K105: the prose "Create one in Settings → Milestones" link is gone.
    expect(empty.textContent?.toLowerCase()).not.toContain("settings");
    expect(empty.querySelector("a")).toBeNull();

    // In its place, a button that opens the shared create dialog in place.
    const emptyNew = screen.getByTestId("milestones-empty-new");
    fireEvent.click(emptyNew);
    expect(await screen.findByTestId("milestone-create-dialog")).toBeTruthy();
  });
});
