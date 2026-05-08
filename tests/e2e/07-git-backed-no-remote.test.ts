import { readdir } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withGitLoctt } from "../integration/fixtures/git-loctt.js";

describe("E2E journey: git-backed (no remote)", () => {
  it("walks enable, create, publish, mutate, sync, disable", async () => {
    await withGitLoctt(async ({ root }) => {
      // enable
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      const status = await runCli(["git", "status"], { cwd: root });
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("Enabled: true");
      expect(status.stdout).toContain("Branch: loctt");

      // create T-1, T-2
      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "second"], { cwd: root })).exitCode).toBe(0);

      // publish
      const pub1 = await runCli(["git", "publish"], { cwd: root });
      expect(pub1.exitCode).toBe(0);
      expect(pub1.stdout).toContain("Published");

      const ids = await readdir(path.join(root, ".loctt/tasks"));
      expect(ids.length).toBe(2);
      const firstId = ids[0]!;

      const showInBranch = await execa("git", ["show", `loctt:tasks/${firstId}/task.md`], { cwd: root });
      expect(showInBranch.stdout.length).toBeGreaterThan(0);

      const sha1 = (await execa("git", ["rev-parse", "loctt"], { cwd: root })).stdout;

      // mutate + publish again, branch advances
      expect((await runCli(["set", "T-1", "status", "in_progress"], { cwd: root })).exitCode).toBe(0);
      const pub2 = await runCli(["git", "publish"], { cwd: root });
      expect(pub2.exitCode).toBe(0);

      const sha2 = (await execa("git", ["rev-parse", "loctt"], { cwd: root })).stdout;
      expect(sha2).not.toBe(sha1);

      // sync — no remote, so it's effectively a no-op (exit 0)
      const sync = await runCli(["git", "sync"], { cwd: root });
      expect(sync.exitCode).toBe(0);

      // disable
      expect((await runCli(["git", "disable"], { cwd: root })).exitCode).toBe(0);
      const statusAfter = await runCli(["git", "status"], { cwd: root });
      expect(statusAfter.stdout).toContain("Enabled: false");
    });
  });
});
