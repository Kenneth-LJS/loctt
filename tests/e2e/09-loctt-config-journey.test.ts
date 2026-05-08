import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withGitLocttRemote } from "../integration/fixtures/git-loctt-with-remote.js";

async function bareHasRef(bareRepo: string, ref: string): Promise<boolean> {
  const result = await execa("git", ["--git-dir", bareRepo, "rev-parse", "--verify", ref], { reject: false });
  return result.exitCode === 0;
}

describe("E2E journey: loctt config walkthrough", () => {
  it("walks through config defaults, enable, toggles, and observable effects", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      // config list before git enable — shows defaults for every key.
      const listBefore = await runCli(["config", "list"], { cwd: root });
      expect(listBefore.exitCode).toBe(0);
      expect(listBefore.stdout).toContain("git.enabled");
      expect(listBefore.stdout).toContain("git.auto_push");
      expect(listBefore.stdout).toContain("git.branch");

      // config get default
      const defaultAutoPush = await runCli(["config", "get", "git.auto_push"], { cwd: root });
      expect(defaultAutoPush.exitCode).toBe(0);
      expect(defaultAutoPush.stdout.trim()).toBe("true");

      // git enable
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);

      // config list now reflects enabled
      const listAfter = await runCli(["config", "list"], { cwd: root });
      expect(listAfter.stdout).toMatch(/git\.enabled\s*=\s*true/);

      // config get git.auto_push still true
      const ap = await runCli(["config", "get", "git.auto_push"], { cwd: root });
      expect(ap.stdout.trim()).toBe("true");

      // config set git.auto_push false
      expect((await runCli(["config", "set", "git.auto_push", "false"], { cwd: root })).exitCode).toBe(0);
      const apAfter = await runCli(["config", "get", "git.auto_push"], { cwd: root });
      expect(apAfter.stdout.trim()).toBe("false");

      // create + publish — local commit lands but bare is NOT pushed
      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);
      const pub = await runCli(["git", "publish"], { cwd: root });
      expect(pub.exitCode).toBe(0);
      expect(await bareHasRef(remoteRepo, "loctt")).toBe(false);

      // local loctt branch has the commit
      const localRef = await execa("git", ["rev-parse", "--verify", "loctt"], { cwd: root, reject: false });
      expect(localRef.exitCode).toBe(0);

      // turn auto_push back on, set custom branch
      expect((await runCli(["config", "set", "git.auto_push", "true"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["config", "set", "git.branch", "my-tasks"], { cwd: root })).exitCode).toBe(0);

      // create + publish — commit lands on my-tasks locally and on remote
      expect((await runCli(["create", "second"], { cwd: root })).exitCode).toBe(0);
      const pub2 = await runCli(["git", "publish"], { cwd: root });
      expect(pub2.exitCode).toBe(0);

      const myTasksLocal = await execa("git", ["rev-parse", "--verify", "my-tasks"], { cwd: root, reject: false });
      expect(myTasksLocal.exitCode).toBe(0);
      expect(await bareHasRef(remoteRepo, "my-tasks")).toBe(true);

      // unset git.auto_push restores default (true)
      expect((await runCli(["config", "unset", "git.auto_push"], { cwd: root })).exitCode).toBe(0);
      const apReset = await runCli(["config", "get", "git.auto_push"], { cwd: root });
      expect(apReset.stdout.trim()).toBe("true");
    });
  });
});
