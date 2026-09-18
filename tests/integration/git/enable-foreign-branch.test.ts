import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withTmpLoctt } from "../fixtures/tmp-loctt.js";

/**
 * @verifies GIT-C7
 *
 * Publish refuses to adopt a branch holding content LocTT did not write
 * — mirroring would delete it. But enable succeeded silently, so the
 * user learned about the conflict only when a later publish failed,
 * having already configured git-backed mode.
 */
describe("git enable surfaces a foreign branch up front", () => {
  const seedForeignBranch = async (root: string, branch: string): Promise<void> => {
    await execa("git", ["init", "-q", "."], { cwd: root });
    await execa("git", ["config", "user.email", "t@example.com"], { cwd: root });
    await execa("git", ["config", "user.name", "Test"], { cwd: root });
    await execa("git", ["add", "-A"], { cwd: root });
    await execa("git", ["commit", "-qm", "base"], { cwd: root });
    await execa("git", ["checkout", "-q", "-b", branch], { cwd: root });
    await execa("git", ["commit", "-qm", "foreign", "--allow-empty"], { cwd: root });
    await execa("git", ["checkout", "-q", "-"], { cwd: root });
  };

  it("refuses, naming the branch and the config key", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seedForeignBranch(root, "loctt");

      const res = await runCli(["git", "enable"], { cwd: root });
      const out = `${res.stdout}${res.stderr}`;

      expect(res.exitCode).not.toBe(0);
      expect(out).toMatch(/loctt/);
      // The way out has to be in the message: the user is mid-setup and
      // does not know the branch is configurable.
      expect(out).toMatch(/git\.branch/);
    });
  });

  it("checks the configured branch, not the literal 'loctt'", async () => {
    await withTmpLoctt(async ({ root }) => {
      await seedForeignBranch(root, "my-tasks");
      // Enable first on a clean default branch, then point at the
      // foreign one — the guard must follow the config (GIT-C10).
      await runCli(["git", "enable"], { cwd: root });
      await runCli(["config", "set", "git.branch", "my-tasks"], { cwd: root });

      const res = await runCli(["git", "publish"], { cwd: root });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toMatch(/my-tasks/);
    });
  });

  it("enables normally when the branch does not exist", async () => {
    await withTmpLoctt(async ({ root }) => {
      await execa("git", ["init", "-q", "."], { cwd: root });
      await execa("git", ["config", "user.email", "t@example.com"], { cwd: root });
      await execa("git", ["config", "user.name", "Test"], { cwd: root });

      const res = await runCli(["git", "enable"], { cwd: root });
      expect(res.exitCode, `${res.stdout}${res.stderr}`).toBe(0);
    });
  });
});
