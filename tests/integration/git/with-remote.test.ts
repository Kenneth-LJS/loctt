import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withGitLocttRemote } from "../fixtures/git-loctt-with-remote.js";

const gitEnv = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_TERMINAL_PROMPT: "0",
};

async function bareHasRef(bareRepo: string, ref: string): Promise<boolean> {
  const result = await execa("git", ["--git-dir", bareRepo, "rev-parse", "--verify", ref], { reject: false });
  return result.exitCode === 0;
}

describe("git-backed CLI lifecycle (with remote)", () => {
  it("default auto_push pushes loctt branch to bare remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);

      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);
      expect(publish.stdout).toContain("Pushed to remote");

      expect(await bareHasRef(remoteRepo, "loctt")).toBe(true);
    });
  });

  it("auto_push=false skips push to remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["config", "set", "git.auto_push", "false"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);

      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);
      expect(publish.stdout).not.toContain("Pushed to remote");

      expect(await bareHasRef(remoteRepo, "loctt")).toBe(false);
    });
  });

  it("auto_fetch on sync picks up out-of-band commits from the bare remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);

      // Push an out-of-band commit to the bare repo's loctt branch via a
      // temporary clone. This simulates another machine publishing.
      const clone = await mkdtemp(path.join(tmpdir(), "loctt-clone-"));
      try {
        await execa("git", ["clone", "-q", remoteRepo, clone], { env: { ...process.env, ...gitEnv } });
        await execa("git", ["config", "user.email", "test@example.com"], { cwd: clone });
        await execa("git", ["config", "user.name", "Test"], { cwd: clone });
        await execa("git", ["checkout", "-q", "--orphan", "loctt"], { cwd: clone });
        await execa("git", ["rm", "-rfq", "--ignore-unmatch", "."], { cwd: clone, reject: false });
        await writeFile(path.join(clone, "marker.txt"), "from-other-machine\n");
        await execa("git", ["add", "marker.txt"], { cwd: clone });
        await execa("git", ["commit", "-q", "-m", "out-of-band"], { cwd: clone, env: { ...process.env, ...gitEnv } });
        await execa("git", ["push", "-q", "origin", "loctt"], { cwd: clone, env: { ...process.env, ...gitEnv } });
      } finally {
        await rm(clone, { recursive: true, force: true }).catch(() => {});
      }

      const syncResult = await runCli(["git", "sync"], { cwd: root });
      expect(syncResult.exitCode).toBe(0);
      expect(syncResult.stdout).toContain("Fetched from remote");

      // Verify local loctt branch now has the marker file.
      const show = await execa("git", ["show", "loctt:marker.txt"], { cwd: root });
      expect(show.stdout).toContain("from-other-machine");
    });
  });

  it("unreachable remote: publish exits 0, warns on stderr, local commit is durable", async () => {
    await withGitLocttRemote(async ({ root }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      await execa("git", ["remote", "set-url", "origin", "/nonexistent/path/repo.git"], { cwd: root });

      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);

      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);
      expect(publish.stderr.toLowerCase()).toContain("warning");

      const ref = await execa("git", ["rev-parse", "loctt"], { cwd: root });
      expect(ref.stdout).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it("custom branch name lands on the configured ref locally and on remote", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["config", "set", "git.branch", "my-tasks"], { cwd: root })).exitCode).toBe(0);

      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);
      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);

      // local: my-tasks exists, default loctt does not
      const myTasksLocal = await execa("git", ["rev-parse", "--verify", "my-tasks"], { cwd: root, reject: false });
      expect(myTasksLocal.exitCode).toBe(0);
      const locttLocal = await execa("git", ["rev-parse", "--verify", "loctt"], { cwd: root, reject: false });
      expect(locttLocal.exitCode).not.toBe(0);

      // bare: my-tasks present
      expect(await bareHasRef(remoteRepo, "my-tasks")).toBe(true);
      expect(await bareHasRef(remoteRepo, "loctt")).toBe(false);
    });
  });
});
