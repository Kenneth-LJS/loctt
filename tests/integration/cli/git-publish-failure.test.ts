import { execSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies GIT-C4
 *
 * Core reports a failed push correctly — `pushed: false` plus a
 * `pushError`, with the local commit durable. The CLI discarded both,
 * printed "Published local state to loctt branch", and exited 0. The
 * user's work stayed local and nothing said so.
 */
describe("CLI git publish reports a failed push (spawned binary)", () => {
  it("exits non-zero and names the failure when the remote is unreachable", async () => {
    await withTmpLoctt(async ({ root }) => {
      execSync("git init -q .", { cwd: root });
      execSync("git config user.email t@example.com", { cwd: root });
      execSync("git config user.name Test", { cwd: root });
      // A remote that cannot resolve: the push fails, the commit does not.
      execSync("git remote add origin /nonexistent/definitely-not-a-repo.git", { cwd: root });

      // `--remote` was silently discarded here — `git.ts` never read it,
      // and the remote is configured by `git remote add` above anyway.
      // It only surfaced when the dispatcher started rejecting unknown
      // flags, which then left git mode disabled and the publish failing
      // for an unrelated reason.
      const enabled = await runCli(["git", "enable"], { cwd: root });
      expect(enabled.exitCode, "git enable must succeed for this test to mean anything").toBe(0);
      await runCli(["create", "a task"], { cwd: root });

      const res = await runCli(["git", "publish"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      // The failure must be visible in the exit code — a script that
      // checks it is the whole reason this matters.
      expect(res.exitCode).not.toBe(0);

      // And must not claim the push happened.
      expect(res.stdout).not.toMatch(/Pushed to remote/);

      // The local commit did succeed, and saying so is what stops the
      // user re-doing work that is already safe.
      expect(out).toMatch(/local commit succeeded|committed/i);
      // With the retry command, since the fix is a plain git push.
      expect(out).toMatch(/git push/);

      // And the cause, not a fragment of it. Taking git's last stderr
      // line yielded "and the repository exists." — the tail of a
      // sentence, which explains nothing on its own.
      expect(out).toMatch(/does not appear to be a git repository|repository not found/i);

      // @verifies GIT-29
      // The failure is classified, not opaque: the CLI names the remote
      // and states it could not be reached (distinct from an auth failure
      // or a non-fast-forward rejection, which say different things) —
      // P10 parity with the panel's push-failure classification.
      expect(out).toMatch(/could not be reached/i);
      expect(out).toMatch(/origin/);
    });
  });

  it("still exits 0 and reports success when there is no remote to push to", async () => {
    await withTmpLoctt(async ({ root }) => {
      execSync("git init -q .", { cwd: root });
      execSync("git config user.email t@example.com", { cwd: root });
      execSync("git config user.name Test", { cwd: root });

      await runCli(["git", "enable"], { cwd: root });
      await runCli(["create", "a task"], { cwd: root });

      // No remote configured is not a failure — publishing to the local
      // branch is the whole operation.
      const res = await runCli(["git", "publish"], { cwd: root });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toMatch(/Published local state/);
    });
  });
});
