// @vitest-environment jsdom
import type { HistoryEntry, WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityPanel } from "./ActivityPanel.tsx";

/** ActivityPanel is URL-controlled (CMT-18); this holds the tab in state
 *  and feeds it back through `onTabChange`, standing in for the router. */
function ControlledActivityPanel(): React.JSX.Element {
  const [tab, setTab] = useState<"comments" | "activity" | "all" | undefined>(undefined);
  return (
    <ActivityPanel
      taskRef="T-1"
      {...(tab !== undefined ? { tab } : {})}
      onTabChange={setTab}
      workflow={workflow}
      users={[]}
      labels={[]}
      milestones={[]}
      sprints={[]}
      projects={[]}
      calendar={{ timezone: "UTC" } as never}
    />
  );
}

/**
 * ActivityPanel rendering, turned on what the feed SAYS rather than the
 * server round-trip (server tests cover the wire against a real
 * tracker). The subject here is Phase-7B / CMT-37's second bullet: when
 * the server could read some entries but dropped a malformed row, the
 * response carries an `unreadable` count and the feed must SAY the list
 * is incomplete — never present a partial log as complete.
 *
 * The `unreadable` path had no client test at all before this file; the
 * count was wired end-to-end (server → hook → panel) and unverified.
 */

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A minimal workflow so `describeEntry` has labels to resolve against. */
const workflow = {
  key: { prefix: "T-" },
  statuses: [
    { key: "backlog", label: "Icebox", category: "pending", default: true },
    { key: "in_progress", label: "Cooking", category: "active" },
  ],
  priorities: [],
  task_types: [],
  relationships: [],
  custom_fields: [],
} as unknown as WorkflowConfig;

function entry(over: Partial<HistoryEntry> & { kind: HistoryEntry["kind"] }): HistoryEntry {
  return { timestamp: "2026-08-28T09:00:00.000Z", ...over };
}

/**
 * Renders the lane and opens the **Activity** tab — the subject of every
 * test in this file. The lane defaults to the Comments tab (K-5), so the
 * feed lives in a `hidden` panel until this click; without it the
 * assertions would be reading a hidden subtree. The click also proves
 * the tab actually reveals the feed.
 */
// These tests assert the FEED's behaviour, which lives behind the
// Activity tab. The panel is URL-controlled now (CMT-18), so open the
// Activity tab by passing `tab="activity"` rather than clicking (a click
// only calls `onTabChange`; the URL, not internal state, drives the tab).
function renderPanel() {
  return render(
    <ActivityPanel
      taskRef="T-1"
      tab="activity"
      workflow={workflow}
      users={[]}
      labels={[]}
      milestones={[]}
      sprints={[]}
      projects={[]}
      calendar={{ timezone: "UTC" } as never}
    />,
    { wrapper: wrapper() },
  );
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

/** The response the `/activity` endpoint should return in a given test. */
let activityBody: unknown;

beforeEach(() => {
  activityBody = { entries: [], total: 0, unreadable: 0 };
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  // Route by URL: the Comments tab mounts too (hidden) and hits
  // `/comments`, which must not receive an activity-shaped body. The
  // comments query is not the subject here, so it always sees an empty
  // thread; `/activity` gets the per-test body via `setActivity`.
  fetchMock.mockImplementation(((input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? "");
    if (url.includes("/comments")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse(activityBody));
  }) as never);
  vi.stubGlobal("fetch", fetchMock);
});

/** Sets the body the `/activity` endpoint returns for the current test. */
function setActivity(body: unknown): void {
  activityBody = body;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ActivityPanel — loading is announced", () => {
  // The loading indicator was a bare <p aria-busy> with no role=status, so
  // a screen reader was never told the feed was loading (design-review §A3).
  // It now uses LoadingState (role=status). Red-proven: the pre-fix <p> had
  // no role, so this query returns null.
  it("announces the load with role=status", async () => {
    // An /activity request that never resolves keeps the panel loading.
    fetchMock.mockImplementation(((input: unknown) => {
      const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? "");
      if (url.includes("/comments")) return Promise.resolve(jsonResponse([]));
      return new Promise<Response>(() => { /* never resolves */ });
    }) as never);

    renderPanel();

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/Loading activity/i);
    expect(status.getAttribute("aria-busy")).toBe("true");
  });
});

describe("ActivityPanel — incomplete history (CMT-37 second bullet)", () => {
  /**
   * @verifies CMT-37
   *
   * Entries render AND the incomplete notice appears with the count.
   * Mutation that proves this load-bearing: drop the `unreadable` field
   * from the response (or delete the `<IncompleteNotice>` render in
   * ActivityPanel) and this assertion goes red — the entry alone still
   * renders, so a test that only checked "something rendered" would not
   * catch a feed presenting a partial log as complete.
   */
  // @verifies DEG-18
  it("says the list is incomplete when the server dropped malformed rows", async () => {
    setActivity({
        entries: [
          entry({ kind: "field_change", field: "status", before: "backlog", after: "in_progress" }),
        ],
        total: 1,
        unreadable: 2,
      });

    renderPanel();

    // The readable entry is on screen…
    await waitFor(() => {
      expect(screen.getByText(/changed Status/)).toBeTruthy();
    });
    // …and the feed says it is incomplete, naming the count and the file.
    const notice = screen.getByTestId("activity-incomplete");
    expect(notice.textContent).toContain("2");
    expect(notice.textContent).toContain("_history.yaml");
    expect(notice.textContent?.toLowerCase()).toContain("incomplete");
  });

  /**
   * @verifies CMT-37, CMT-19
   *
   * A file whose EVERY row is malformed is not the empty state: it must
   * NOT say "no activity has been recorded" (which would be false), and
   * it MUST show the incomplete notice. Mutation: make the empty branch
   * ignore `unreadable` and this flips to the empty message → red.
   */
  // @verifies DEG-18
  it("shows the incomplete notice, not the empty message, when all rows are malformed", async () => {
    setActivity({ entries: [], total: 0, unreadable: 3 });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("activity-incomplete")).toBeTruthy();
    });
    expect(screen.queryByTestId("activity-empty")).toBeNull();
    expect(screen.getByTestId("activity-incomplete").textContent).toContain("3");
  });

  /**
   * The negative that keeps the two above honest: a clean response
   * (no `unreadable`, or zero) shows the entries and NO notice. Without
   * this, an implementation that always rendered the notice would pass
   * the positive tests.
   */
  // @verifies DEG-18
  it("shows no incomplete notice when nothing was dropped", async () => {
    setActivity({
        entries: [entry({ kind: "created" })],
        total: 1,
        // unreadable omitted — an older server, or a clean file.
      });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("activity-scope")).toBeTruthy();
    });
    expect(screen.queryByTestId("activity-incomplete")).toBeNull();
  });

  /**
   * @verifies CMT-19
   *
   * A genuinely empty history (no entries, nothing dropped) DOES say so
   * — the counterpart to the all-malformed case, so the two states stay
   * visually distinct.
   */
  it("shows the empty message for a genuinely empty history", async () => {
    setActivity({ entries: [], total: 0, unreadable: 0 });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("activity-empty")).toBeTruthy();
    });
    expect(screen.queryByTestId("activity-incomplete")).toBeNull();
  });
});

/**
 * The K-5 tab split. The lane is Comments / Activity / All, and the
 * inactive tabs are `hidden` (in the DOM, out of the a11y tree) rather
 * than unmounted so a switch does not throw away a query or a draft.
 *
 * Red-first proof: before the split the component STACKED the two
 * sections and had no `activity-tabs` tablist at all, so
 * `getByTestId("activity-tabs")` and every tab/panel selector below
 * threw. This whole block is red against the pre-tab shape.
 */
describe("ActivityPanel — Comments / Activity / All tabs (K-5)", () => {
  /**
   * @verifies CMT-18
   *
   * Three tabs exist; the Comments tab is selected by default (K-5 — the
   * tabbed panel is the single comments home now that TaskDetail no longer
   * renders a standalone Comments section); clicking a tab reveals its
   * panel and hides the others. The panel wrappers stay in the DOM with
   * their testids so `hidden` is assertable; the CONTENT is mounted on
   * activation.
   */
  it("renders three tabs and switches the visible panel", async () => {
    setActivity({ entries: [entry({ kind: "created" })], total: 1, unreadable: 0 });

    render(<ControlledActivityPanel />, { wrapper: wrapper() });

    // A tablist with exactly the three named tabs.
    expect(screen.getByTestId("activity-tabs")).toBeTruthy();
    expect(screen.getByTestId("activity-tab-comments").textContent).toBe("Comments");
    expect(screen.getByTestId("activity-tab-activity").textContent).toBe("Activity");
    expect(screen.getByTestId("activity-tab-all").textContent).toBe("All");

    // Default: Comments selected, its panel visible; Activity hidden.
    expect(screen.getByTestId("activity-tab-comments").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("activity-tabpanel-comments").hidden).toBe(false);
    expect(screen.getByTestId("activity-tabpanel-activity").hidden).toBe(true);

    // Switch to Activity: its panel shows and the feed mounts.
    fireEvent.click(screen.getByTestId("activity-tab-activity"));
    expect(screen.getByTestId("activity-tab-activity").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("activity-tabpanel-activity").hidden).toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId("activity-tabpanel-activity").querySelector("[data-testid='activity-scope']")).toBeTruthy();
    });

    // Switch to All: its panel shows, Activity hides, and both lanes are
    // present under the one panel.
    fireEvent.click(screen.getByTestId("activity-tab-all"));
    expect(screen.getByTestId("activity-tab-all").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("activity-tabpanel-all").hidden).toBe(false);
    expect(screen.getByTestId("activity-tabpanel-activity").hidden).toBe(true);
    const all = screen.getByTestId("activity-tabpanel-all");
    await waitFor(() => {
      expect(all.querySelector("[data-testid='activity-scope']")).toBeTruthy();
    });
  });
});
