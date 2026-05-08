import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../integration/adapters/cli-spawn.js";
import { withGitLocttRemote } from "../integration/fixtures/git-loctt-with-remote.js";

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

describe("E2E journey: git-backed (with fake remote)", () => {
  it("walks enable, publish auto-pushes, out-of-band mutation, sync auto-fetches", async () => {
    await withGitLocttRemote(async ({ root, remoteRepo }) => {
      // enable + status confirms remote configured
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);
      const status = await runCli(["git", "status"], { cwd: root });
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("Enabled: true");

      // create + publish — bare receives the commit
      expect((await runCli(["create", "first"], { cwd: root })).exitCode).toBe(0);
      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);
      expect(publish.stdout).toContain("Pushed to remote");
      expect(await bareHasRef(remoteRepo, "loctt")).toBe(true);

      // Out-of-band: clone bare, push a marker commit on the loctt branch.
      const clone = await mkdtemp(path.join(tmpdir(), "loctt-e2e-clone-"));
      try {
        await execa("git", ["clone", "-q", remoteRepo, clone], { env: { ...process.env, ...gitEnv } });
        await execa("git", ["config", "user.email", "test@example.com"], { cwd: clone });
        await execa("git", ["config", "user.name", "Test"], { cwd: clone });
        await execa("git", ["checkout", "-q", "loctt"], { cwd: clone, env: { ...process.env, ...gitEnv } });
        await writeFile(path.join(clone, "out-of-band.txt"), "external\n");
        await execa("git", ["add", "out-of-band.txt"], { cwd: clone });
        await execa("git", ["commit", "-q", "-m", "external commit"], { cwd: clone, env: { ...process.env, ...gitEnv } });
        await execa("git", ["push", "-q", "origin", "loctt"], { cwd: clone, env: { ...process.env, ...gitEnv } });
      } finally {
        await rm(clone, { recursive: true, force: true }).catch(() => {});
      }

      // sync auto-fetches; local loctt branch sees the new file.
      const sync = await runCli(["git", "sync"], { cwd: root });
      expect(sync.exitCode).toBe(0);

      const show = await execa("git", ["show", "loctt:out-of-band.txt"], { cwd: root });
      expect(show.stdout).toContain("external");
    });
  });
});
