import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../../adapters/cli-spawn.js";
import { withTmpLoctt } from "../../fixtures/tmp-loctt.js";

const gitEnv = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function initGitRepo(cwd: string): Promise<void> {
  await execa("git", ["init", "-q"], { cwd });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd });
  await execa("git", ["config", "user.name", "Test"], { cwd });
  await execa("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd, env: { ...process.env, ...gitEnv } });
}

describe("CLI loctt config edge cases (spawned binary)", () => {
  it("config get returns default before git enable", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["config", "get", "git.auto_push"], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("true");
    });
  });

  it("config set errors before git enable", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["config", "set", "git.auto_push", "false"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/git mode is not enabled/i);
    });
  });

  it("config set unknown key lists valid keys", async () => {
    await withTmpLoctt(async ({ root }) => {
      const result = await runCli(["config", "set", "unknown.key", "value"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/unknown config key/i);
      expect(result.stderr).toContain("git.auto_push");
    });
  });

  it("config set with unparseable boolean lists accepted forms", async () => {
    await withTmpLoctt(async ({ root }) => {
      await initGitRepo(root);
      const enable = await runCli(["git", "enable"], { cwd: root, env: gitEnv });
      expect(enable.exitCode).toBe(0);

      const result = await runCli(
        ["config", "set", "git.auto_push", "notabool"],
        { cwd: root, env: gitEnv },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("boolean");
      expect(result.stderr).toMatch(/true\/false/);
    });
  });

  it("config set parses boolean values case-insensitively", async () => {
    await withTmpLoctt(async ({ root }) => {
      await initGitRepo(root);
      const enable = await runCli(["git", "enable"], { cwd: root, env: gitEnv });
      expect(enable.exitCode).toBe(0);

      const result = await runCli(
        ["config", "set", "git.auto_push", "FALSE"],
        { cwd: root, env: gitEnv },
      );
      expect(result.exitCode).toBe(0);

      const get = await runCli(["config", "get", "git.auto_push"], { cwd: root, env: gitEnv });
      expect(get.exitCode).toBe(0);
      expect(get.stdout.trim()).toBe("false");
    });
  });
});
