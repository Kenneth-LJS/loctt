import { describe, expect, it } from "vitest";

import type { GitRemoteFailure } from "../api/hooks/useGit.ts";
import { publishFailureLine } from "./GitSyncPanel.tsx";

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
