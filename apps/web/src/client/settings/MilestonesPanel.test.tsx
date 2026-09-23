// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MilestonesPanel } from "./MilestonesPanel.tsx";

/**
 * MilestonesPanel — broken-entry degradation (DEG-30 / A138).
 *
 * A milestone whose stored fields do not validate is lifted by the
 * tolerant loader into `broken` and rides the list endpoint
 * (`handleListMilestones`). The panel must show it as a marked, read-only
 * row rather than silently omitting it, and the healthy milestones must
 * still render. Before this the panel read only `data.items`, so a corrupt
 * milestone vanished with no notice.
 *
 * Red-proof: remove the `broken.map(...)` block from the panel and the
 * "marker renders" assertion goes red while the healthy-row assertion
 * stays green — proving the marker is what is under test.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

const WITH_BROKEN = {
  items: [
    { id: "ms_ok", name: "Healthy milestone", target_date: "2026-09-01", taskCount: 0 },
  ],
  total: 1,
  offset: 0,
  limit: 500,
  broken: [
    { id: "ms_bad", index: 1, rawText: "name: 42\n", error: "name: Expected string, received number" },
  ],
};

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(WITH_BROKEN)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

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

describe("MilestonesPanel — broken-entry degradation (DEG-30)", () => {
  it("renders a broken milestone as a marked row and keeps the healthy one", async () => {
    render(<MilestonesPanel />, { wrapper: wrapper() });
    // Healthy milestone still renders...
    await screen.findByTestId("milestone-row-ms_ok");
    // ...and the corrupt one is a marked, read-only row rather than gone.
    const brokenRow = screen.getByTestId("milestone-broken-ms_bad");
    expect(brokenRow.getAttribute("aria-disabled")).toBe("true");
    // Wording trimmed under K116 (row 94): the sentence now leads with
    // "Couldn't be read (...)" rather than "<name> — couldn't be read
    // (...)", so match case-insensitively.
    expect(brokenRow.textContent?.toLowerCase()).toContain("couldn't be read");
    expect(brokenRow.textContent).toContain("Expected string, received number");
  });

  it("does not read a lone broken milestone as an empty list", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({
        items: [],
        total: 0,
        offset: 0,
        limit: 500,
        broken: WITH_BROKEN.broken,
      })),
    );
    render(<MilestonesPanel />, { wrapper: wrapper() });
    await screen.findByTestId("milestone-broken-ms_bad");
    // The "No milestones yet" empty state must NOT show — there IS a
    // milestone, it just could not be read.
    expect(screen.queryByTestId("milestones-empty")).toBeNull();
  });

  it("Repair refetches the milestones", async () => {
    render(<MilestonesPanel />, { wrapper: wrapper() });
    const repair = await screen.findByTestId("milestone-broken-repair-ms_bad");
    const before = fetchMock.mock.calls.length;
    fireEvent.click(repair);
    await waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThan(before); });
  });
});

/**
 * @verifies SET-55
 *
 * MilestonesPanel already carried `settings-panel-title`, but its create
 * action sat in a `secondary`-variant row below the description, at a
 * different vertical position than the title. Converged via the shared
 * `SettingsPanelHeader`.
 */
describe("MilestonesPanel header convergence (N-4)", () => {
  it("renders the canonical title markup via SettingsPanelHeader", async () => {
    render(<MilestonesPanel />, { wrapper: wrapper() });

    const title = await screen.findByTestId("settings-panel-title");
    expect(title.tagName).toBe("H1");
    expect(title.textContent).toBe("Milestones");
    expect(title.className).toContain("text-text-primary");
  });

  it("puts the create action in the header row next to the title", async () => {
    render(<MilestonesPanel />, { wrapper: wrapper() });

    const title = await screen.findByTestId("settings-panel-title");
    const createBtn = await screen.findByTestId("milestone-create-open");
    const header = title.closest("header");
    expect(header).not.toBeNull();
    expect(header?.contains(createBtn)).toBe(true);
  });

  it("uses the canonical primary variant for the create action, not the old secondary", async () => {
    render(<MilestonesPanel />, { wrapper: wrapper() });

    const createBtn = await screen.findByTestId("milestone-create-open");
    // `Button`'s primary variant fills with `bg-accent`; the pre-N-4
    // secondary variant instead bordered (`border-border-default`).
    expect(createBtn.className).toContain("bg-accent");
    expect(createBtn.className).not.toContain("border-border-default");
  });
});
