import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";
import { createTask } from "../task/create.js";
import { setField } from "../task/update.js";
import { enableGit } from "./git-mode.js";
import { publish, sync } from "./publish-sync.js";

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

    // REPLACED (decision M2). This test previously asserted that a task
    // changed on both sides aborts the whole sync. That was the
    // behaviour M2 reverses: the abort meant two clones which each
    // created a task could never merge at all. It now asserts the
    // merge, and that nothing is dropped by it.
    it("writes the merge_resolved entry to history, not just to memory", async () => {
      // A fallback resolution is only auditable if it reaches disk.
      //
      // The field must be one history genuinely cannot explain, i.e. one
      // absent at creation: `created` carries the whole initial
      // frontmatter (M3), so a hand-edit to a field the task was born
      // with resolves to the birth value instead of falling back. That
      // is the documented consequence of hand-editing (decisions.md,
      // "M2 scope") — here we need the other case.
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Contested" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      const dir = join(locttDir, "tasks", task.frontmatter.id);
      const published = await readFile(join(dir, "task.md"), "utf-8");
      // Both sides hand-add `assignee`, which no history entry mentions.
      const withAssignee = (raw: string, who: string, updatedAt?: string): string => {
        const out = raw.replace(/^title: .*$/m, m => `${m}\nassignee: ${who}`);
        return updatedAt === undefined
          ? out
          : out.replace(/^updated_at: .*$/m, `updated_at: ${updatedAt}`);
      };

      await commitOnBranch(async wt => {
        await writeFile(join(wt, "tasks", task.frontmatter.id, "task.md"),
          withAssignee(published, "u-branch", "2099-01-01T00:00:00.000Z"));
      }, "hand-add on branch");
      await writeFile(join(dir, "task.md"), withAssignee(published, "u-local"));

      await sync(locttDir, root);

      const history = await readFile(join(dir, "_history.yaml"), "utf-8");
      expect(history).toContain("merge_resolved");
      expect(history).toContain("assignee");
      // The losing value is the whole point of the entry.
      expect(history).toContain("u-local");
    });

    it("reports a key collision it could not resolve", async () => {
      // @verifies GIT-C2
      //
      // RekeyOutcome's contract says a skip is "never silently dropped:
      // a task sharing a key with another is exactly the state the
      // caller invoked this to remove". The only caller read
      // outcome.rekeyed and never outcome.skipped, so an unresolvable
      // collision left two tasks sharing a key while sync reported a
      // clean merge — and `loctt show <key>` became ambiguous.
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Colliding" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      const dir = join(locttDir, "tasks", task.frontmatter.id);
      const published = await readFile(join(dir, "task.md"), "utf-8");

      // The branch adds a second task claiming the same key, in a
      // project this clone has no counter for — so the rekey pass has
      // nowhere to allocate a replacement from and must skip it.
      await commitOnBranch(async wt => {
        const otherId = "01M0COLLIDING000000000000";
        await mkdir(join(wt, "tasks", otherId), { recursive: true });
        await writeFile(
          join(wt, "tasks", otherId, "task.md"),
          published
            .replace(/^id: .*$/m, `id: ${otherId}`)
            .replace(/^project: .*$/m, "project: 01M0NOSUCHPROJECT00000000")
            .replace(/^title: .*$/m, "title: Collides on key"),
        );
      }, "add a colliding task");

      const result = await sync(locttDir, root);

      // Named, not swallowed. The user has to be able to act on it.
      expect(result.unresolvedKeys ?? []).toContain(task.frontmatter.key);
    });

    it("recovers from a worktree left registered by a hard kill", async () => {
      // Cleanup runs in a finally block with an rm fallback, so ordinary
      // failures are handled. A SIGKILL or power loss is different:
      // nothing runs, and git keeps the worktree registered in
      // .git/worktrees even though the directory is gone. `rm` before
      // `worktree add` does not clear that registration, so the next
      // sync died with "missing but already registered worktree" — raw
      // git plumbing naming a path the user has never seen, for an
      // operation they would not connect to last week's crash.
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Before crash" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      // The branch must move, or sync returns early on
      // `last_synced_commit === remoteHead` and never touches a worktree
      // — which is how an earlier version of this test passed with the
      // fix removed.
      const published = await readFile(
        join(locttDir, "tasks", task.frontmatter.id, "task.md"), "utf-8",
      );
      await commitOnBranch(async wt => {
        await writeFile(join(wt, "tasks", task.frontmatter.id, "task.md"),
          published.replace(/^title: .*$/m, "title: Renamed on branch")
            .replace(/^updated_at: .*$/m, "updated_at: 2099-01-01T00:00:00.000Z"));
      }, "move the branch");

      // Simulate the hard kill: register a worktree, then delete only
      // the directory, exactly as an interrupted run leaves things.
      const stale = join(locttDir, "local", ".worktree-sync");
      execSync(`git worktree add "${stale}" loctt`, { cwd: root, stdio: "ignore" });
      await rm(stale, { recursive: true, force: true });

      // Precondition: git must actually consider it stale, or this test
      // proves nothing about prune.
      expect(execSync("git worktree list", { cwd: root }).toString()).toMatch(/prunable/);

      // Must complete rather than dying on the stale registration.
      const result = await sync(locttDir, root);
      expect(result.updated).toBe(true);
    });

    // @verifies GIT-C1
    it("keeps both sides' structured edits to different fields", async () => {
      // What whole-record LWW lost, end to end. Branch sets status and
      // records it; local sets priority through the real write path.
      // Neither touched the other's field, so both must survive — the
      // newer record used to take the whole task with it.
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Contested" },
      });
      await saveState(locttDir, state);
      // This fixture's createTask writes no `status`, so set one through
      // the real path first — otherwise the branch edit below has no
      // line to replace and the test silently exercises nothing.
      await setField({
        locttDir, taskId: task.frontmatter.id, field: "status", value: "backlog",
      });
      await publish(locttDir, root);

      const dir = join(locttDir, "tasks", task.frontmatter.id);
      const publishedTask = await readFile(join(dir, "task.md"), "utf-8");
      const publishedHistory = await readFile(join(dir, "_history.yaml"), "utf-8");

      await commitOnBranch(async wt => {
        const f = join(wt, "tasks", task.frontmatter.id, "task.md");
        await writeFile(f, publishedTask
          .replace(/^status: .*$/m, "status: in_progress")
          .replace(/^updated_at: .*$/m, "updated_at: 2099-01-01T00:00:00.000Z"));
        await writeFile(
          join(wt, "tasks", task.frontmatter.id, "_history.yaml"),
          `${publishedHistory}- timestamp: 2099-01-01T00:00:00.000Z\n  kind: field_change\n  field: status\n  before: backlog\n  after: in_progress\n`,
        );
      }, "status on branch");

      await setField({
        locttDir,
        taskId: task.frontmatter.id,
        field: "priority",
        value: "high",
      });

      await sync(locttDir, root);

      const after = await readFile(join(dir, "task.md"), "utf-8");
       
      console.log("MERGED TASK:\n" + after);
       
      const h = await readFile(join(dir, "_history.yaml"), "utf-8");
       
      console.log("HAS status field_change:", h.includes("field: status"), "| entries:", (h.match(/^- timestamp/gm) ?? []).length);
      // The branch's status won its own field...
      expect(after).toContain("status: in_progress");
      // ...and the local priority was not dropped along with the record.
      expect(after).toContain("priority: high");
    });

    it("merges a task changed on both sides instead of aborting", async () => {
      const state = await loadState(locttDir);
      const task = await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Contested" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      const taskFile = join(locttDir, "tasks", task.frontmatter.id, "task.md");
      const published = await readFile(taskFile, "utf-8");

      // Branch renames the task, as a structured write would: the
      // frontmatter changes AND history records it. Editing only the
      // file is a hand-edit, which M2 explicitly does not cover — the
      // merge has no evidence it happened and `created` still says
      // "Contested".
      const historyFile = join(locttDir, "tasks", task.frontmatter.id, "_history.yaml");
      const publishedHistory = await readFile(historyFile, "utf-8");
      await commitOnBranch(async wt => {
        const f = join(wt, "tasks", task.frontmatter.id, "task.md");
        await writeFile(f, published
          .replace(/^title: .*$/m, "title: Renamed on branch")
          .replace(/^updated_at: .*$/m, "updated_at: 2099-01-01T00:00:00.000Z"));
        await writeFile(
          join(wt, "tasks", task.frontmatter.id, "_history.yaml"),
          `${publishedHistory}- timestamp: 2099-01-01T00:00:00.000Z\n  kind: field_change\n  field: title\n  before: Contested\n  after: Renamed on branch\n`,
        );
      }, "rename on branch");

      // Local changes the body, i.e. a different edit to the same file.
      await writeFile(taskFile, `${published}\nLocal-only paragraph.\n`);

      const result = await sync(locttDir, root);
      expect(result.merged).toBe(1);

      const after = await readFile(taskFile, "utf-8");
      // The branch's newer title won...
      expect(after).toContain("Renamed on branch");
      // ...and the local body it displaced was preserved beside the
      // task rather than silently dropped (M4).
      const displaced = await readFile(
        join(locttDir, "tasks", task.frontmatter.id, "task.local.md"),
        "utf-8",
      );
      expect(displaced).toContain("Local-only paragraph.");
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

      // A task.md now merges, so this no longer aborts. The path-naming
      // contract is asserted below on a file that genuinely has no
      // merge rule.
      const result = await sync(locttDir, root);
      expect(result.merged).toBe(1);
    });

    it("still aborts, naming the path, for a file with no merge rule", async () => {
      const state = await loadState(locttDir);
      await createTask({
        locttDir, state, options: { project: taskProjectId, title: "Workflow fixture" },
      });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      // workflow.yaml has no field-level rule: statuses and priorities
      // are referenced by every task, so unioning two divergent
      // vocabularies could leave tasks pointing at a status that the
      // merged config does not define.
      const wfPath = join(locttDir, "config", "workflow.yaml");
      const published = await readFile(wfPath, "utf-8");
      await commitOnBranch(async wt => {
        await writeFile(
          join(wt, "config", "workflow.yaml"),
          `${published}\n# branch-side edit\n`,
        );
      }, "workflow edit on branch");
      await writeFile(wfPath, `${published}\n# local-side edit\n`);

      await expect(sync(locttDir, root)).rejects.toThrow(
        /config\/workflow\.yaml/,
      );

      // Nothing was written: both versions are intact for the user.
      expect(await readFile(wfPath, "utf-8")).toContain("local-side edit");
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
