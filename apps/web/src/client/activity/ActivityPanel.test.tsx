// @vitest-environment jsdom
import type { HistoryEntry, WorkflowConfig } from "@loctt/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityPanel } from "./ActivityPanel.tsx";

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

function renderPanel() {
  return render(
    <ActivityPanel
      taskRef="T-1"
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

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
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
    fetchMock.mockResolvedValue(
      jsonResponse({
        entries: [
          entry({ kind: "field_change", field: "status", before: "backlog", after: "in_progress" }),
        ],
        total: 1,
        unreadable: 2,
      }),
    );

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
    fetchMock.mockResolvedValue(
      jsonResponse({ entries: [], total: 0, unreadable: 3 }),
    );

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
    fetchMock.mockResolvedValue(
      jsonResponse({
        entries: [entry({ kind: "created" })],
        total: 1,
        // unreadable omitted — an older server, or a clean file.
      }),
    );

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
    fetchMock.mockResolvedValue(
      jsonResponse({ entries: [], total: 0, unreadable: 0 }),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("activity-empty")).toBeTruthy();
    });
    expect(screen.queryByTestId("activity-incomplete")).toBeNull();
  });
});
