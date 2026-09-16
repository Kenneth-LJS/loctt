import type { ErrorResponse } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client.ts";
import type { GitRemoteFailure } from "../api/hooks/useGit.ts";
import { historyRewritten, publishFailureLine } from "./GitSyncPanel.tsx";

/**
 * @verifies GIT-29
 *
 * The panel must tell a non-fast-forward push rejection apart from an
 * auth failure: the first recommends Sync first (the remote moved), the
 * second points at git credentials. Both must state the local commit is
 * safe (GIT-29: "the message states the local state was not modified by
 * the failed push"). `publishFailureLine` is the pure text these branch
 * on, tested directly so the distinction is deterministic (a non-ff
 * rejection cannot be triggered end-to-end without the reconcile
 * detector intercepting it first — see push-fetch.test.ts for the core
 * detection).
 */

function failure(kind: GitRemoteFailure["kind"], detail: string): GitRemoteFailure {
  return { kind, summary: `${kind} summary`, detail, message: detail, remote: "origin" };
}

describe("publishFailureLine (GIT-29)", () => {
  it("a non-fast-forward rejection recommends Sync first and names the remote", () => {
    const line = publishFailureLine("loctt", failure("non_fast_forward", "the remote has moved on since your last sync"));
    expect(line).toMatch(/rejected/i);
    expect(line).toMatch(/moved on/i);
    expect(line).toMatch(/sync first/i);
    expect(line).toMatch(/origin/);
    // The commit is safe — this is not a total failure.
    expect(line).toMatch(/safe locally/i);
  });

  it("an auth failure points at git credentials, distinct from a non-ff rejection", () => {
    const line = publishFailureLine("loctt", failure("auth", "authentication failed"));
    expect(line).toMatch(/authenticat/i);
    expect(line).toMatch(/credentials/i);
    // It must NOT tell the user to Sync — that is the non-ff remedy.
    expect(line).not.toMatch(/sync first/i);
    expect(line).toMatch(/safe locally/i);
  });

  it("an unreachable remote says so and names it, offering retry (not Sync)", () => {
    const line = publishFailureLine("loctt", failure("unreachable", "the remote could not be reached"));
    expect(line).toMatch(/could not be reached/i);
    expect(line).toMatch(/origin/);
    expect(line).not.toMatch(/sync first/i);
    expect(line).toMatch(/safe locally/i);
  });

  it("an unrecognised failure falls back to the raw cause, still safe", () => {
    const line = publishFailureLine("loctt", failure("other", "some novel git failure"));
    expect(line).toMatch(/some novel git failure/);
    expect(line).toMatch(/safe locally/i);
  });
});

/**
 * @verifies GIT-21
 *
 * The panel routes a `history_rewritten` refusal (K93) to its dedicated
 * banner, NOT the generic retryable ErrorState. `historyRewritten` is the
 * detector the render branches on: it must recognise the code and hand
 * back the typed payload (missing commit + remote head + branch + remote),
 * and reject everything else — an ordinary conflict, a non-ApiError, a
 * bare ApiError with no envelope — so those still fall through to
 * ErrorState. Tested directly so the branch is deterministic (a real
 * force-push cannot be arranged in a jsdom unit; the end-to-end refusal is
 * in flow-git-sync.spec.ts and core history-rewritten.test.ts).
 */
function apiError(code: ErrorResponse["code"], extra: Partial<ErrorResponse> = {}): ApiError {
  const envelope: ErrorResponse = { code, message: "boom", ...extra };
  return new ApiError("boom", { status: 409, body: envelope, endpoint: "/api/git/sync", envelope });
}

describe("historyRewritten detector (GIT-21)", () => {
  it("returns the typed payload for a history_rewritten envelope", () => {
    const info = historyRewritten(apiError("history_rewritten", {
      history_rewritten: {
        missing_commit: "abcdef1234567890",
        remote_head: "0987654321fedcba",
        branch: "loctt",
        remote: "origin",
      },
    }));
    expect(info).toBeDefined();
    expect(info?.missing_commit).toBe("abcdef1234567890");
    expect(info?.remote_head).toBe("0987654321fedcba");
    expect(info?.branch).toBe("loctt");
    expect(info?.remote).toBe("origin");
  });

  it("returns undefined for an ordinary conflict (so it uses ErrorState)", () => {
    expect(historyRewritten(apiError("conflict"))).toBeUndefined();
    expect(historyRewritten(apiError("reconcile_needed"))).toBeUndefined();
    expect(historyRewritten(apiError("git_failed"))).toBeUndefined();
  });

  it("returns undefined for a non-ApiError or an envelope-less error", () => {
    expect(historyRewritten(new Error("plain"))).toBeUndefined();
    expect(historyRewritten(undefined)).toBeUndefined();
    // A history_rewritten code but no payload — still no crash, no payload.
    expect(historyRewritten(apiError("history_rewritten"))).toBeUndefined();
  });
});
