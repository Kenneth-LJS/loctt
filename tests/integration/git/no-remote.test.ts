import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initLoctt } from "@loctt/core";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "../adapters/cli-spawn.js";
import { withGitLoctt } from "../fixtures/git-loctt.js";

describe("git-backed CLI lifecycle (no remote)", () => {
  it("enable then status reports enabled, branch loctt, in-git", async () => {
    await withGitLoctt(async ({ root }) => {
      const enable = await runCli(["git", "enable"], { cwd: root });
      expect(enable.exitCode).toBe(0);

      const status = await runCli(["git", "status"], { cwd: root });
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("Enabled: true");
      expect(status.stdout).toContain("Branch: loctt");
      expect(status.stdout).toContain("Inside git repo: true");
    });
  });

  it("enable, create, publish — local loctt branch contains task content", async () => {
    await withGitLoctt(async ({ root }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);

      const create = await runCli(["create", "first"], { cwd: root });
      expect(create.exitCode).toBe(0);
      expect(create.stdout).toContain("T-1");

      const publish = await runCli(["git", "publish"], { cwd: root });
      expect(publish.exitCode).toBe(0);
      expect(publish.stdout).toContain("Published");

      // local loctt branch exists
      const ref = await execa("git", ["rev-parse", "loctt"], { cwd: root });
      expect(ref.stdout).toMatch(/^[0-9a-f]{40}$/);

      // find the task id and verify file is on the branch
      const tasksDir = path.join(root, ".loctt/tasks");
      const ids = await readdir(tasksDir);
      expect(ids.length).toBe(1);
      const taskId = ids[0];

      const show = await execa("git", ["show", `loctt:tasks/${taskId}/task.md`], { cwd: root });
      expect(show.stdout).toContain("first");
    });
  });

  it("enable on a non-git directory exits non-zero with a useful error", async () => {
    // Must be outside the loctt repo's own git work tree, otherwise git
    // walks up and considers tests/workspace/ inside a repo.
    const root = await mkdtemp(path.join(tmpdir(), "loctt-nogit-"));
    try {
      await initLoctt(root);
      const result = await runCli(["git", "enable"], { cwd: root });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain("git");
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("disable then status reports disabled and persists in sync.yaml", async () => {
    await withGitLoctt(async ({ root }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);

      const disable = await runCli(["git", "disable"], { cwd: root });
      expect(disable.exitCode).toBe(0);

      const status = await runCli(["git", "status"], { cwd: root });
      expect(status.stdout).toContain("Enabled: false");

      const syncYaml = await readFile(path.join(root, ".loctt/local/sync.yaml"), "utf-8");
      expect(syncYaml).toMatch(/enabled:\s*false/);
    });
  });

  it("publish twice advances the loctt branch", async () => {
    await withGitLoctt(async ({ root }) => {
      expect((await runCli(["git", "enable"], { cwd: root })).exitCode).toBe(0);

      expect((await runCli(["create", "one"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["git", "publish"], { cwd: root })).exitCode).toBe(0);

      const first = (await execa("git", ["rev-parse", "loctt"], { cwd: root })).stdout;

      expect((await runCli(["create", "two"], { cwd: root })).exitCode).toBe(0);
      expect((await runCli(["git", "publish"], { cwd: root })).exitCode).toBe(0);

      const second = (await execa("git", ["rev-parse", "loctt"], { cwd: root })).stdout;
      expect(second).not.toBe(first);
    });
  });
});
