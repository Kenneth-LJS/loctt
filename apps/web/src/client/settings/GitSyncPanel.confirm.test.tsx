// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitStatus } from "../api/hooks/useGit.ts";
import { GitSyncPanel } from "./GitSyncPanel.tsx";

/**
 * GIT-1 happy-path enable confirmation copy.
 *
 * The confirmation that lists what enabling git sync will do leaked the
 * git term "temporary worktree" into the ordinary happy path — a phrase
 * that means nothing to a user who is not a git internals expert. The
 * reword keeps the meaning (the publish happens in the background without
 * switching the user's working tree or branch) in plain language.
 *
 * Red-proof: restore "temporary worktree" in the confirm bullet and the
 * "does not leak" assertion goes red while the "explains the effect"
 * assertion stays green.
 *
 * The hard-error / refusal banners (force-push, history-rewrite, SHAs)
 * legitimately keep git terms and are NOT touched — those are exercised
 * by GitSyncPanel.test.ts against the detector helpers.
 */

const DISABLED_STATUS: GitStatus = {
  enabled: false,
  branch: "loctt",
  remote: "origin",
  autoPush: true,
  autoFetch: true,
  isGitRepo: true,
  remoteConfigured: true,
};

let fetchMock: ReturnType<typeof vi.fn<(...args: never[]) => Promise<Response>>>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock = vi.fn<(...args: never[]) => Promise<Response>>();
  fetchMock.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/api/git/status")) return Promise.resolve(jsonResponse(DISABLED_STATUS));
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("GitSyncPanel — happy-path enable confirm copy (GIT-1)", () => {
  it("explains the effect in plain language, without the 'temporary worktree' jargon", async () => {
    render(<GitSyncPanel />, { wrapper: wrapper() });
    // Reach the confirm by clicking Enable in the disabled state.
    const enable = await screen.findByTestId("git-enable");
    fireEvent.click(enable);

    const confirm = await screen.findByTestId("git-enable-confirm");
    // The effect is still explained (branch is not switched).
    expect(confirm.textContent).toContain("never");
    // Red-proof: the jargon phrase is gone from the happy-path confirm.
    expect(confirm.textContent).not.toContain("temporary worktree");
    expect(confirm.textContent).not.toContain("worktree");
  });
});
