// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitSyncPanel } from "./GitSyncPanel.tsx";

/**
 * @verifies A328 (B6)
 *
 * Before this, Disable's `useGitDisable` mutation error was never read —
 * a failed or timed-out Disable (`data_state: "unknown"` on a K115
 * timeout) did nothing visible: the confirm box just sat there with no
 * word of what happened. This turns on the inline notice A328 specifies
 * (verbatim copy) and proves the confirm box stays open on error rather
 * than closing as if the toggle had succeeded.
 *
 * Red-proof: comment out the `disable.isError && <InlineFailureNotice …>`
 * block in `GitSyncPanel.tsx`'s `EnabledState` and
 * "shows the not-saved notice ... on a plain rejection" goes red — no
 * `git-disable-error` node is found. Restore, and reintroduce the OLD
 * eager-close behaviour (call `setConfirmingDisable(false)` unconditionally
 * from the click handler instead of leaving it to the user) and
 * "the confirm box stays open when Disable fails" goes red.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(envelope: Record<string, unknown>, status = 500): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ENABLED_STATUS = {
  enabled: true,
  branch: "loctt",
  remote: "origin",
  autoPush: false,
  autoFetch: false,
  isGitRepo: true,
  remoteConfigured: true,
  localChanges: 0,
  remoteChanges: false,
};

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;
let disableOutcome: "unknown" | "not_saved" | null;

beforeEach(() => {
  disableOutcome = null;
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method;
    if (u.includes("/api/git/status")) {
      return Promise.resolve(jsonResponse(ENABLED_STATUS));
    }
    if (u.includes("/api/git/reconcile") && method === undefined) {
      return Promise.resolve(jsonResponse({ reconcile: null }));
    }
    if (u.includes("/api/git/disable") && method === "POST") {
      if (disableOutcome === "unknown") {
        return Promise.resolve(errorResponse({
          code: "unknown",
          message: "boom",
          data_state: "unknown",
        }, 504));
      }
      if (disableOutcome === "not_saved") {
        return Promise.resolve(errorResponse({
          code: "git_failed",
          message: "boom",
          data_state: "not_saved",
        }, 500));
      }
      return Promise.resolve(jsonResponse({ enabled: false }));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function renderPanel(): void {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={qc}>
      <GitSyncPanel />
    </QueryClientProvider>,
  );
}

async function openDisableConfirm(): Promise<void> {
  fireEvent.click(await screen.findByTestId("git-disable"));
  await screen.findByTestId("git-disable-confirm");
}

describe("GitSyncPanel — Disable inline failure notice (A328/B6)", () => {
  it("shows the unknown-state copy and keeps the confirm box open on a timeout", async () => {
    disableOutcome = "unknown";
    renderPanel();
    await openDisableConfirm();

    fireEvent.click(screen.getByTestId("git-disable-confirm-button"));

    const notice = await screen.findByTestId("git-disable-error");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain(
      "Couldn't confirm git sync was turned off. Refresh to check.",
    );
    // The confirm box is still on screen — Disable did not read as done.
    expect(screen.getByTestId("git-disable-confirm")).toBeTruthy();
  });

  it("shows the not-saved copy on a plain rejection, with a working Try again", async () => {
    disableOutcome = "not_saved";
    renderPanel();
    await openDisableConfirm();

    fireEvent.click(screen.getByTestId("git-disable-confirm-button"));

    const notice = await screen.findByTestId("git-disable-error");
    expect(notice.textContent).toContain("Git sync wasn't turned off. Try again.");

    const before = fetchMock.mock.calls.filter(c =>
      String(c[0]).includes("/api/git/disable")).length;
    fireEvent.click(screen.getByTestId("git-disable-error-retry"));
    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(c =>
        String(c[0]).includes("/api/git/disable")).length;
      expect(after).toBeGreaterThan(before);
    });
  });

  it("the confirm box stays open when Disable fails (red-proved against the old close-on-click ordering)", async () => {
    disableOutcome = "not_saved";
    renderPanel();
    await openDisableConfirm();

    fireEvent.click(screen.getByTestId("git-disable-confirm-button"));
    await screen.findByTestId("git-disable-error");

    // Never replaced by the bare "Disable git sync" trigger button, which
    // is what the panel would show if the box had closed.
    expect(screen.queryByTestId("git-disable-confirm")).toBeTruthy();
  });
});
