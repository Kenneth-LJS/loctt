import { execSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";
import { createTask } from "../task/create.js";
import { enableGit } from "./git-mode.js";
import { GitConflictError, publish, sync } from "./publish-sync.js";

describe("publish-sync", () => {
  let root: string;
  let locttDir: string;
  let taskProjectId: string;

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
    const { loadProjectsConfig } = await import("../config/projects.js");
    const cfg = await loadProjectsConfig(locttDir);
    taskProjectId = cfg.projects[0]?.id as string;
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
      await createTask({ locttDir, state, options: { project: taskProjectId, title: "Test task" } });
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
      const task = await createTask({ locttDir, state, options: { project: taskProjectId, title: "Will be deleted" } });
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
      const task = await createTask({ locttDir, state, options: { project: taskProjectId, title: "Remote delete test" } });
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
      await createTask({ locttDir, state, options: { project: taskProjectId, title: "Sync test" } });
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

  /**
   * Sync used to be a blind mirror of the branch over `.loctt/`: anything
   * present locally but absent on the branch was deleted, and anything
   * differing was overwritten. That destroys work whenever both sides moved
   * since the last sync. These cover the three ways it lost data, plus the
   * publish-side branch adoption.
   *
   * Each case creates the data it expects to survive (or to be destroyed),
   * so the assertion is about *this* fixture, never about generic state.
   */
  describe("sync does not destroy local work", () => {
    /** Advances the loctt branch by editing it directly in a worktree. */
    async function commitOnBranch(
      mutate: (worktreeDir: string) => Promise<void>,
      message: string,
    ): Promise<void> {
      const wt = join(root, `.branch-edit-${Math.random().toString(36).slice(2)}`);
      execSync(`git worktree add ${wt} loctt`, { cwd: root, stdio: "pipe" });
      try {
        await mutate(wt);
        execSync(`git add -A && git commit -m '${message}'`, { cwd: wt, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
      }
    }

    it("keeps a locally-created task that never reached the branch", async () => {
      // Fixture: one published task, so the branch has a known base.
      const s1 = await loadState(locttDir);
      await createTask({ locttDir, state: s1, options: { project: taskProjectId, title: "Published" } });
      await saveState(locttDir, s1);
      await publish(locttDir, root);

      // The task under test: created locally, never published.
      const s2 = await loadState(locttDir);
      const local = await createTask({
        locttDir, state: s2, options: { project: taskProjectId, title: "Created offline" },
      });
      await saveState(locttDir, s2);

      // Someone else advances the branch, unrelated to our task.
      await commitOnBranch(async wt => {
        await writeFile(join(wt, "config", "queries.yaml"), "queries: []\n");
      }, "unrelated change");

      await sync(locttDir, root);

      const tasks = await readdir(join(locttDir, "tasks")).catch(() => [] as string[]);
      expect(tasks).toContain(local.frontmatter.id);
    });

    it("aborts without writing when the same task changed on both sides", async () => {
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Contested" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      const taskFile = join(locttDir, "tasks", task.frontmatter.id, "task.md");
      const published = await readFile(taskFile, "utf-8");

      // Branch changes the title.
      await commitOnBranch(async wt => {
        const f = join(wt, "tasks", task.frontmatter.id, "task.md");
        await writeFile(f, published.replace(/^title: .*$/m, "title: Renamed on branch"));
      }, "rename on branch");

      // Local changes the body, i.e. a different edit to the same file.
      await writeFile(taskFile, `${published}\nLocal-only paragraph.\n`);

      await expect(sync(locttDir, root)).rejects.toThrow(GitConflictError);

      // Nothing was written: the local edit survives and the branch's does
      // not silently replace it.
      const after = await readFile(taskFile, "utf-8");
      expect(after).toContain("Local-only paragraph.");
      expect(after).not.toContain("Renamed on branch");
    });

    it("names the conflicting paths in the error", async () => {
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Named in error" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      const taskFile = join(locttDir, "tasks", task.frontmatter.id, "task.md");
      const published = await readFile(taskFile, "utf-8");
      await commitOnBranch(async wt => {
        const f = join(wt, "tasks", task.frontmatter.id, "task.md");
        await writeFile(f, published.replace(/^title: .*$/m, "title: Branch side"));
      }, "branch edit");
      await writeFile(taskFile, published.replace(/^title: .*$/m, "title: Local side"));

      await expect(sync(locttDir, root)).rejects.toThrow(
        new RegExp(`tasks/${task.frontmatter.id}/task\\.md`),
      );
    });

    it("never takes .schema-version from the branch", async () => {
      const svPath = join(locttDir, ".schema-version");
      const original = await readFile(svPath, "utf-8").catch(() => undefined);
      if (original === undefined) return; // no schema file in this layout

      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: taskProjectId, title: "Schema fixture" } });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      // A clone on a newer LocTT publishes a higher schema version.
      await commitOnBranch(async wt => {
        await writeFile(join(wt, ".schema-version"), "999\n");
      }, "bump schema on branch");

      await sync(locttDir, root);

      // Mirroring this would brick the tracker: every command is gated by
      // the schema guard, including `git disable`.
      expect(await readFile(svPath, "utf-8")).toBe(original);
    });

    it("reports how many files it changed", async () => {
      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: taskProjectId, title: "Counted" } });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      await commitOnBranch(async wt => {
        await writeFile(join(wt, "config", "queries.yaml"), "queries: []\n");
      }, "edit queries");

      const result = await sync(locttDir, root);
      expect(result.updated).toBe(true);
      expect(result.copied).toBeGreaterThan(0);
    });
  });

  /**
   * `git.branch` is user-configurable, so nothing may assume the literal
   * `loctt`. Publish-to-a-renamed-branch is covered in
   * tests/integration/git/with-remote.test.ts; these cover the paths that
   * one does not — sync's 3-way comparison and the adoption guard.
   */
  describe("respects a reconfigured git.branch", () => {
    async function renameBranchTo(name: string): Promise<void> {
      const st = await loadSyncState(locttDir);
      await saveSyncState(locttDir, {
        git: {
          enabled: st.git.enabled,
          branch: name,
          remote: st.git.remote,
          auto_push: st.git.auto_push,
          auto_fetch: st.git.auto_fetch,
          ...(st.git.last_synced_commit ? { last_synced_commit: st.git.last_synced_commit } : {}),
        },
      });
    }

    it("syncs from the configured branch, not from `loctt`", async () => {
      await renameBranchTo("my-tasks");

      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "On my-tasks" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      // The configured branch exists; the default name does not.
      expect(() => execSync("git rev-parse --verify my-tasks", { cwd: root, stdio: "pipe" })).not.toThrow();
      expect(() => execSync("git rev-parse --verify loctt", { cwd: root, stdio: "pipe" })).toThrow();

      // Advance the configured branch, then sync from it.
      const wt = join(root, ".renamed-wt");
      execSync(`git worktree add ${wt} my-tasks`, { cwd: root, stdio: "pipe" });
      try {
        await writeFile(join(wt, "config", "queries.yaml"), "queries: []\n");
        execSync("git add -A && git commit -m 'edit on renamed branch'", { cwd: wt, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
      }

      const result = await sync(locttDir, root);
      expect(result.updated).toBe(true);
      expect(result.copied).toBeGreaterThan(0);

      // The task published before the rename is still intact — the 3-way
      // comparison resolved the base against the configured branch.
      const tasks = await readdir(join(locttDir, "tasks")).catch(() => [] as string[]);
      expect(tasks).toContain(task.frontmatter.id);
    });

    it("keeps a locally-created task when syncing a renamed branch", async () => {
      await renameBranchTo("tracker");

      const s1 = await loadState(locttDir);
      await createTask({ locttDir, state: s1, options: { project: taskProjectId, title: "Published" } });
      await saveState(locttDir, s1);
      await publish(locttDir, root);

      const s2 = await loadState(locttDir);
      const localOnly = await createTask({
        locttDir, state: s2, options: { project: taskProjectId, title: "Local only" },
      });
      await saveState(locttDir, s2);

      const wt = join(root, ".tracker-wt");
      execSync(`git worktree add ${wt} tracker`, { cwd: root, stdio: "pipe" });
      try {
        await writeFile(join(wt, "config", "queries.yaml"), "queries: []\n");
        execSync("git add -A && git commit -m 'unrelated'", { cwd: wt, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
      }

      await sync(locttDir, root);

      const tasks = await readdir(join(locttDir, "tasks")).catch(() => [] as string[]);
      expect(tasks).toContain(localOnly.frontmatter.id);
    });

    it("applies the foreign-content guard to the configured branch", async () => {
      // A branch named `notes` already holds unrelated work.
      const wt = join(root, ".notes-wt");
      execSync(`git worktree add --detach ${wt}`, { cwd: root, stdio: "pipe" });
      try {
        execSync("git checkout --orphan notes-src", { cwd: wt, stdio: "pipe" });
        execSync("git rm -rqf . || true", { cwd: wt, stdio: "pipe" });
        await writeFile(join(wt, "meeting-notes.md"), "keep me\n");
        execSync("git add -A && git commit -m notes", { cwd: wt, stdio: "pipe" });
        execSync("git branch -f notes notes-src", { cwd: wt, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
      }

      await renameBranchTo("notes");
      const st = await loadSyncState(locttDir);
      await saveSyncState(locttDir, {
        git: {
          enabled: st.git.enabled, branch: "notes", remote: st.git.remote,
          auto_push: st.git.auto_push, auto_fetch: st.git.auto_fetch,
        },
      });

      await expect(publish(locttDir, root)).rejects.toThrow(/refusing to publish/);
      expect(
        execSync("git ls-tree --name-only notes", { cwd: root, stdio: "pipe", encoding: "utf-8" }),
      ).toContain("meeting-notes.md");
    });
  });

  describe("publish branch adoption", () => {
    it("refuses to publish over a branch holding non-LocTT content", async () => {
      // Fixture: a loctt branch that predates LocTT and holds real work.
      const wt = join(root, ".foreign-wt");
      execSync(`git worktree add --detach ${wt}`, { cwd: root, stdio: "pipe" });
      try {
        execSync("git checkout --orphan loctt-foreign", { cwd: wt, stdio: "pipe" });
        execSync("git rm -rqf . || true", { cwd: wt, stdio: "pipe" });
        await writeFile(join(wt, "precious.txt"), "irreplaceable\n");
        execSync("git add -A && git commit -m precious", { cwd: wt, stdio: "pipe" });
        execSync("git branch -f loctt loctt-foreign", { cwd: wt, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
      }

      // Clear last_synced_commit: this is a first publish onto that branch.
      const st = await loadSyncState(locttDir);
      await saveSyncState(locttDir, {
        git: {
          enabled: st.git.enabled,
          branch: st.git.branch,
          remote: st.git.remote,
          auto_push: st.git.auto_push,
          auto_fetch: st.git.auto_fetch,
        },
      });

      await expect(publish(locttDir, root)).rejects.toThrow(/refusing to publish/);

      const listed = execSync("git ls-tree --name-only loctt", {
        cwd: root, stdio: "pipe", encoding: "utf-8",
      });
      expect(listed).toContain("precious.txt");
    });
  });
});
