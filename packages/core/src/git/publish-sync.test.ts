import { execSync } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "../task/create.js";
import { enableGit } from "./git-mode.js";
import { publish, sync } from "./publish-sync.js";

describe("publish-sync", () => {
  let root: string;
  let locttDir: string;

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    root = await mkdtemp(join(tmpdir(), "loctt-pubsync-"));
    // Initialize a git repo with an initial commit
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("publish", () => {
    it("does not modify the user's working tree or current branch", async () => {
      // Record the state before publish
      const branchBefore = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf-8" }).trim();
      const statusBefore = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();

      // Create a task so there's something to publish
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { title: "Test task" } });
      await saveState(locttDir, state);

      await publish(locttDir, root);

      // Verify the user's checkout is untouched
      const branchAfter = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf-8" }).trim();
      const statusAfter = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
      expect(branchAfter).toBe(branchBefore);
      expect(statusAfter).toBe(statusBefore);
    });

    it("removes files from loctt branch when deleted locally", async () => {
      const state = await loadState(locttDir);
      const task = await createTask({ locttDir, state, options: { title: "Will be deleted" } });
      await saveState(locttDir, state);

      // First publish
      await publish(locttDir, root);

      // Delete the task locally
      await rm(join(locttDir, "tasks", task.frontmatter.id), { recursive: true, force: true });

      // Second publish should remove it from the branch too
      const result = await publish(locttDir, root);
      expect(result.committed).toBe(true);

      // Verify the task dir is gone from the branch
      const worktreeDir = join(root, ".verify-worktree");
      execSync(`git worktree add ${worktreeDir} loctt`, { cwd: root, stdio: "pipe" });
      try {
        const tasks = await readdir(join(worktreeDir, "tasks")).catch(() => [] as string[]);
        expect(tasks).not.toContain(task.frontmatter.id);
      } finally {
        execSync(`git worktree remove ${worktreeDir} --force`, { cwd: root, stdio: "pipe" });
      }
    });
  });

  describe("sync", () => {
    it("removes locally deleted files that were removed on the branch", async () => {
      const state = await loadState(locttDir);
      const task = await createTask({ locttDir, state, options: { title: "Remote delete test" } });
      await saveState(locttDir, state);

      // Publish to branch
      await publish(locttDir, root);

      // Manually delete the task from the branch
      const worktreeDir = join(root, ".edit-worktree");
      execSync(`git worktree add ${worktreeDir} loctt`, { cwd: root, stdio: "pipe" });
      try {
        await rm(join(worktreeDir, "tasks", task.frontmatter.id), { recursive: true, force: true });
        execSync("git add -A && git commit -m 'delete task'", { cwd: worktreeDir, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${worktreeDir} --force`, { cwd: root, stdio: "pipe" });
      }

      // Sync should pull the deletion
      const result = await sync(locttDir, root);
      expect(result.updated).toBe(true);

      // Verify the task is gone locally
      const localTasks = await readdir(join(locttDir, "tasks")).catch(() => [] as string[]);
      expect(localTasks).not.toContain(task.frontmatter.id);
    });

    it("preserves the local/ directory during sync", async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { title: "Sync test" } });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      // Write something to local/
      const localDir = join(locttDir, "local");
      await writeFile(join(localDir, "custom.txt"), "preserve me");

      // Force a sync by advancing the branch
      const worktreeDir = join(root, ".edit-worktree");
      execSync(`git worktree add ${worktreeDir} loctt`, { cwd: root, stdio: "pipe" });
      try {
        await writeFile(join(worktreeDir, "config", "queries.yaml"), "queries: []");
        execSync("git add -A && git commit -m 'add queries'", { cwd: worktreeDir, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${worktreeDir} --force`, { cwd: root, stdio: "pipe" });
      }

      await sync(locttDir, root);

      // local/ should still have our file
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(join(localDir, "custom.txt"), "utf-8");
      expect(content).toBe("preserve me");
    });
  });
});
