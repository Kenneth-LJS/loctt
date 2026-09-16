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
import { GitReconcileNeededError, GitRekeyNeededError, GitSyncFirstError, publish, sync } from "./publish-sync.js";
import { abandonReconcile } from "./reconcile-session.js";

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

    // @verifies GIT-23
    it("reports incremental write progress for a multi-task sync", async () => {
      // Fixture: several tasks created on the branch (not locally), so
      // the sync's plan is a batch of copies whose progress we can watch.
      // 500 is the case's number but slow to fixture in a unit test; a
      // handful is enough to prove the callback fires per file and reaches
      // the total — the loop is the same at any size.
      // A publish first, to create the `loctt` branch to seed onto.
      const seedState = await loadState(locttDir);
      await createTask({ locttDir, state: seedState, options: { project: taskProjectId, title: "Base" } });
      await saveState(locttDir, seedState);
      await publish(locttDir, root);

      const worktreeDir = join(root, ".seed-worktree");
      execSync(`git worktree add ${worktreeDir} loctt`, { cwd: root, stdio: "pipe" });
      const N = 6;
      try {
        for (let i = 0; i < N; i += 1) {
          const id = `01SEED${String(i).padStart(20, "0")}`;
          await mkdir(join(worktreeDir, "tasks", id), { recursive: true });
          await writeFile(
            join(worktreeDir, "tasks", id, "task.md"),
            `---\nid: ${id}\nkey: T-${String(100 + i)}\ntitle: Seeded ${String(i)}\n`
            + `status: todo\nproject: ${taskProjectId}\ncreated_at: 2020-01-01T00:00:00.000Z\n`
            + `updated_at: 2020-01-01T00:00:00.000Z\n---\nbody\n`,
          );
        }
        execSync("git add -A && git commit -m 'seed tasks on branch'", { cwd: worktreeDir, stdio: "pipe" });
      } finally {
        execSync(`git worktree remove ${worktreeDir} --force`, { cwd: root, stdio: "pipe" });
      }

      const ticks: Array<{ applied: number; total: number }> = [];
      const result = await sync(locttDir, root, (applied, total) => {
        ticks.push({ applied, total });
      });

      expect(result.updated).toBe(true);
      // Progress fired at all — not an indefinite spinner (GIT-23 b1).
      expect(ticks.length).toBeGreaterThan(0);
      // Every tick names the same, honest total (the plan's write count),
      // and that total covers the seeded tasks.
      const total = ticks[0]?.total ?? 0;
      expect(total).toBeGreaterThanOrEqual(N);
      expect(ticks.every(t => t.total === total)).toBe(true);
      // `applied` is monotonic non-decreasing and reaches the total, so a
      // caller rendering applied/total lands on 100%.
      for (let i = 1; i < ticks.length; i += 1) {
        expect(ticks[i]!.applied).toBeGreaterThanOrEqual(ticks[i - 1]!.applied);
      }
      expect(ticks.at(-1)?.applied).toBe(total);
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

      // Both sides set `assignee` to different values from an absent base
      // — a genuine two-sided conflict. Since reconciliation landed
      // (GIT-6, GIT-11), this is surfaced for the user to resolve rather
      // than silently last-write-wins-merged with a `merge_resolved`
      // audit entry. (This test previously asserted the audit entry,
      // encoding that pre-reconciliation auto-merge; the one-sided
      // fallback that entry documents is still exercised by "keeps both
      // sides' structured edits to different fields", where only one side
      // moves a field.)
      let caught: unknown;
      try {
        await sync(locttDir, root);
      } catch (err) { caught = err; }
      expect(caught).toBeInstanceOf(GitReconcileNeededError);
      expect((caught as GitReconcileNeededError).plan.conflicts.some(c => c.field === "assignee")).toBe(true);
      await abandonReconcile(locttDir);
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
      //
      // `created_at` must be LATER than the local task's, or the skip
      // path is never reached. The fixture used to copy the published
      // file wholesale, giving both tasks an identical `created_at`;
      // the tiebreak then fell to the id, and the hardcoded
      // `01M0COLLIDING…` sorts *before* a real ULID. So the colliding
      // task won the key, the local task was rekeyed — successfully,
      // because its project does have a counter — and `skipped` was
      // empty. The test asserted an outcome its own fixture made
      // unreachable.
      //
      // Per GIT-C2: "the task with the earlier created_at keeps the
      // key". The later one is the one that must be rekeyed, and here
      // it is the one that cannot be.
      await commitOnBranch(async wt => {
        const otherId = "01M0COLLIDING000000000000";
        await mkdir(join(wt, "tasks", otherId), { recursive: true });
        await writeFile(
          join(wt, "tasks", otherId, "task.md"),
          published
            .replace(/^id: .*$/m, `id: ${otherId}`)
            .replace(/^project: .*$/m, "project: 01M0NOSUCHPROJECT00000000")
            .replace(/^created_at: .*$/m, "created_at: 2099-01-01T00:00:00.000Z")
            .replace(/^title: .*$/m, "title: Collides on key"),
        );
      }, "add a colliding task");

      const result = await sync(locttDir, root);

      // Named, not swallowed. The user has to be able to act on it.
      expect(result.unresolvedKeys ?? []).toContain(task.frontmatter.key);
    });

    /**
     * Builds the two-clones-collide fixture: a published base, a
     * locally-created offline task, and a branch task claiming the SAME
     * key in the SAME project with an EARLIER created_at (so the branch
     * task keeps the key and the local task is the loser). Returns the
     * local (losing) task and its colliding key.
     */
    async function twoClonesCollide(): Promise<{ localId: string; key: string }> {
      const s1 = await loadState(locttDir);
      await createTask({ locttDir, state: s1, options: { project: taskProjectId, title: "Base" } });
      await saveState(locttDir, s1);
      await publish(locttDir, root);

      const s2 = await loadState(locttDir);
      const local = await createTask({
        locttDir, state: s2, options: { project: taskProjectId, title: "Local offline" },
      });
      await saveState(locttDir, s2);
      // Pin the local task's created_at to LATER than the branch task's, so
      // the branch task keeps the key and the local task is renumbered.
      const localDir = join(locttDir, "tasks", local.frontmatter.id);
      const localRaw = await readFile(join(localDir, "task.md"), "utf-8");
      await writeFile(
        join(localDir, "task.md"),
        localRaw.replace(/^created_at: .*$/m, "created_at: 2099-01-01T00:00:00.000Z"),
      );

      await commitOnBranch(async wt => {
        const otherId = "01M0BRANCHTASK0000000000A";
        await mkdir(join(wt, "tasks", otherId), { recursive: true });
        await writeFile(
          join(wt, "tasks", otherId, "task.md"),
          `---\nid: ${otherId}\nkey: ${local.frontmatter.key}\ntitle: Branch offline\n`
          + `status: todo\nproject: ${taskProjectId}\ncreated_at: 2020-01-01T00:00:00.000Z\n`
          + `updated_at: 2020-01-01T00:00:00.000Z\n---\nbody\n`,
        );
      }, "add a colliding task from another clone");

      return { localId: local.frontmatter.id, key: local.frontmatter.key };
    }

    it("does not renumber a colliding task until the rekey is confirmed", async () => {
      // @verifies GIT-8
      const { localId, key } = await twoClonesCollide();
      const localTaskPath = join(locttDir, "tasks", localId, "task.md");

      // An unconfirmed sync must NOT renumber: it throws the preview and
      // leaves the colliding key on disk untouched (K92 — no auto-apply of
      // a rekey in the UI path).
      let caught: unknown;
      try {
        await sync(locttDir, root);
      } catch (err) { caught = err; }
      expect(caught).toBeInstanceOf(GitRekeyNeededError);

      const plan = (caught as GitRekeyNeededError).plan;
      expect(plan.losers).toHaveLength(1);
      expect(plan.losers[0]?.loserId).toBe(localId);
      expect(plan.losers[0]?.key).toBe(key);
      expect(plan.losers[0]?.tiebreak).toBe("created_at");
      // Both timestamps and both ULIDs are in the preview (GIT-8/GIT-9).
      expect(plan.losers[0]?.keeperId).toBe("01M0BRANCHTASK0000000000A");
      expect(plan.losers[0]?.newKey).toBeDefined();

      // Disk unchanged: the loser still holds the colliding key pre-confirm.
      const raw = await readFile(localTaskPath, "utf-8");
      expect(raw).toMatch(new RegExp(`^key: ${key}$`, "m"));
      await abandonReconcile(locttDir);
    });

    it("applies the rekey once confirmed and reports old→new (GIT-9)", async () => {
      // @verifies GIT-9
      const { localId, key } = await twoClonesCollide();
      // First, unconfirmed → throws (sets the rekey-pending sentinel).
      await expect(sync(locttDir, root)).rejects.toBeInstanceOf(GitRekeyNeededError);

      // Confirm → the loser is renumbered, old key kept in key_history (P-7).
      const result = await sync(locttDir, root, undefined, { rekeyConfirmed: true });
      expect(result.rekeys).toBeDefined();
      const mine = (result.rekeys ?? []).find(r => r.taskId === localId);
      expect(mine?.oldKey).toBe(key);
      expect(mine?.newKey).not.toBe(key);

      const raw = await readFile(join(locttDir, "tasks", localId, "task.md"), "utf-8");
      expect(raw).toMatch(new RegExp(`^key: ${mine?.newKey}$`, "m"));
      // Old key preserved so it still resolves (P-7).
      expect(raw).toMatch(new RegExp(`key_history:[\\s\\S]*${key}`, "m"));
    });

    it("a confirmed rekey renumbers what it can and reports what it cannot (GIT-33)", async () => {
      // @verifies GIT-33
      // Two collisions on confirm: one resolvable (local task, its project
      // has a counter) and one not (a branch task in a project with no
      // counter). The confirmed rekey applies the first and reports the
      // second as unresolved — it does not claim a clean rekey.
      const { localId, key } = await twoClonesCollide();
      // Add a second, UNRESOLVABLE collision on a different key.
      const s3 = await loadState(locttDir);
      const second = await createTask({
        locttDir, state: s3, options: { project: taskProjectId, title: "Second local" },
      });
      await saveState(locttDir, s3);
      const secondDir = join(locttDir, "tasks", second.frontmatter.id);
      const secondRaw = await readFile(join(secondDir, "task.md"), "utf-8");
      // The local `second` is EARLIER, so it keeps its key; the branch task
      // in a no-counter project is LATER, so it is the loser — and being in
      // a project with no counter, it cannot be renumbered (the GIT-33
      // partial-failure path).
      await writeFile(
        join(secondDir, "task.md"),
        secondRaw.replace(/^created_at: .*$/m, "created_at: 2020-06-01T00:00:00.000Z"),
      );
      await commitOnBranch(async wt => {
        const otherId = "01M0BRANCHTASK0000000000B";
        await mkdir(join(wt, "tasks", otherId), { recursive: true });
        await writeFile(
          join(wt, "tasks", otherId, "task.md"),
          `---\nid: ${otherId}\nkey: ${second.frontmatter.key}\ntitle: Branch second\n`
          + `status: todo\nproject: 01M0NOSUCHPROJECT00000000\ncreated_at: 2099-06-01T00:00:00.000Z\n`
          + `updated_at: 2099-06-01T00:00:00.000Z\n---\nbody\n`,
        );
      }, "add a second colliding task with no counter");

      await expect(sync(locttDir, root)).rejects.toBeInstanceOf(GitRekeyNeededError);
      const result = await sync(locttDir, root, undefined, { rekeyConfirmed: true });

      // The resolvable one was renumbered…
      expect((result.rekeys ?? []).some(r => r.taskId === localId)).toBe(true);
      // …and the unresolvable one is reported, not swallowed.
      expect(result.unresolvedKeys ?? []).toContain(second.frontmatter.key);
      // Old key of the renumbered task still recorded (P-7).
      const raw = await readFile(join(locttDir, "tasks", localId, "task.md"), "utf-8");
      expect(raw).toMatch(new RegExp(`key_history:[\\s\\S]*${key}`, "m"));
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

      // Both sides moved `title` from the base to different values — a
      // genuine conflict. Since the reconciliation feature landed (GIT-6,
      // GIT-11), sync no longer silently last-write-wins this: it opens
      // reconciliation and names the field. (This test previously
      // asserted `result.merged === 1`, encoding the pre-reconciliation
      // auto-merge that GIT-6 forbids — "Sync stops and opens the
      // reconciliation panel instead of picking a winner".)
      let caught: unknown;
      try {
        await sync(locttDir, root);
      } catch (err) { caught = err; }
      expect(caught).toBeInstanceOf(GitReconcileNeededError);
      expect((caught as GitReconcileNeededError).plan.conflicts.some(c => c.field === "title")).toBe(true);
      // Leave no sentinel behind for the next test in the suite.
      await abandonReconcile(locttDir);
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
      // WAS ASSERTING THE BUG (GIT-35 / K94). The old version put schema
      // "999" on the branch and asserted the sync SUCCEEDED while keeping
      // the local `.schema-version` (relying on NEVER_MIRROR). Under K94 a
      // branch written by a NEWER LocTT must be REFUSED before applying —
      // silently syncing unknown-newer-schema data is exactly the hazard
      // the guard exists to prevent (see schema-remote-newer.test.ts for
      // that refusal). So the newer-schema scenario now belongs to the
      // guard, and this test keeps only its still-valid intent: when the
      // branch schema is NOT newer, a sync that applies branch work still
      // never overwrites the local (LOCAL_OWNED/NEVER_MIRROR)
      // `.schema-version`. The branch schema is written EQUAL to local so
      // the guard does not fire and the mirror question is the one under
      // test.
      const svPath = join(locttDir, ".schema-version");
      const original = await readFile(svPath, "utf-8").catch(() => undefined);
      if (original === undefined) return; // no schema file in this layout

      const state = await loadState(locttDir);
      await createTask({ locttDir, state, options: { project: taskProjectId, title: "Schema fixture" } });
      await saveState(locttDir, state);
      await publish(locttDir, root);

      // A clone at the SAME schema publishes real work AND its own
      // `.schema-version` — same version NUMBER (so the K94 guard stays
      // silent and the sync proceeds) but different BYTES (extra
      // whitespace). If NEVER_MIRROR were broken the mirror would copy
      // these bytes over local's; the exact-bytes assertion below catches
      // exactly that.
      const branchVariant = ` ${original.trim()} \n`;
      expect(branchVariant).not.toBe(original); // the bytes genuinely differ
      await commitOnBranch(async wt => {
        await writeFile(join(wt, "config", "queries.yaml"), "queries: []\n");
        await writeFile(join(wt, ".schema-version"), branchVariant);
      }, "edit + republish schema on branch");

      const result = await sync(locttDir, root);
      expect(result.updated).toBe(true);

      // The branch's `.schema-version` was NOT mirrored over local's own
      // (NEVER_MIRROR/LOCAL_OWNED): sync leaves it byte-for-byte as it was.
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

  // Phase Z G1: publish blind-mirrored the branch whenever there were no
  // per-FIELD conflicts, treating "no field conflict" as "safe to
  // fast-forward". It is not: a task the branch added, or a task the
  // branch edited that local never touched, is classified `copy` by
  // planSync (not `conflict`), so the mirror deleted it from the branch —
  // and pushed the loss to the remote. Publish must refuse and route
  // through `sync` (which merges the branch's work) when the branch holds
  // remote-only changes.
  describe("publish refuses to clobber remote-only branch work (Phase Z G1)", () => {
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

    it("throws GitSyncFirstError instead of deleting a task the branch added", async () => {
      // Base: one published task.
      const s1 = await loadState(locttDir);
      const base = await createTask({
        locttDir, state: s1, options: { project: taskProjectId, title: "Base" },
      });
      await saveState(locttDir, s1);
      await publish(locttDir, root);

      // The branch gains a task this clone never synced (another clone's
      // publish). Written as a real task dir so planSync sees a `copy`.
      const remoteId = "01M0REMOTEONLY0000000000AB";
      await commitOnBranch(async wt => {
        await mkdir(join(wt, "tasks", remoteId), { recursive: true });
        await writeFile(
          join(wt, "tasks", remoteId, "task.md"),
          `---\nid: ${remoteId}\nkey: TBASE-2\ntitle: Remote only\n`
          + `project: ${taskProjectId}\ncreated_at: 2026-01-01T00:00:00Z\n`
          + `updated_at: 2026-01-01T00:00:00Z\nstatus: todo\n---\nRemote body.\n`,
        );
      }, "remote-only task");

      // An unrelated local edit, then publish. Before the fix this
      // returned committed:true and the branch tip lost the remote task.
      await writeFile(join(locttDir, "config", "queries.yaml"), "queries: []\n");
      await expect(publish(locttDir, root)).rejects.toBeInstanceOf(GitSyncFirstError);

      // Nothing was written: the branch tip still holds the remote task.
      const listed = execSync("git ls-tree -r --name-only loctt", {
        cwd: root, stdio: "pipe", encoding: "utf-8",
      });
      expect(listed).toContain(`tasks/${remoteId}/task.md`);
      expect(listed).toContain(`tasks/${base.frontmatter.id}/task.md`);
    });

    it("still publishes a plain local delete — the branch did not change (G1 review regression)", async () => {
      // The review of the G1 fix caught this: `planSync` labels a
      // locally-deleted, still-on-branch file `copy` ("present on branch,
      // absent locally") — the SAME class as a remote add. Folding all
      // copies into the refusal wrongly blocked a legitimate delete, and
      // the `sync` it routed to resurrected the task. When the branch has
      // NOT moved this is a true fast-forward and publish proceeds; the
      // interesting case (below) is a delete alongside a real branch move.
      const s1 = await loadState(locttDir);
      const keep = await createTask({
        locttDir, state: s1, options: { project: taskProjectId, title: "Keep" },
      });
      const doomed = await createTask({
        locttDir, state: s1, options: { project: taskProjectId, title: "Doomed" },
      });
      await saveState(locttDir, s1);
      await publish(locttDir, root); // base now has both

      // Delete one task locally; the branch is untouched.
      const { deleteTask } = await import("../task/lifecycle.js");
      await deleteTask(locttDir, doomed.frontmatter.id, { force: true });

      // Publish must SUCCEED (not throw GitSyncFirstError) and remove the
      // deleted task from the branch — honouring the user's delete.
      const result = await publish(locttDir, root);
      expect(result.committed).toBe(true);
      const listed = execSync("git ls-tree -r --name-only loctt", {
        cwd: root, stdio: "pipe", encoding: "utf-8",
      });
      expect(listed).toContain(`tasks/${keep.frontmatter.id}/task.md`);
      expect(listed).not.toContain(`tasks/${doomed.frontmatter.id}/task.md`);
    });

    it("names only the genuinely-remote path when the branch moved AND local deleted a base file (G1 review)", async () => {
      // The exact regression the fix review probed: the branch advances
      // with a real remote add (R) while local ALSO deletes a base file
      // (B). Publish must refuse (R is real remote work), but the refusal
      // must name ONLY R — never B — because listing B as "changed on the
      // branch" is false and routes the user to a sync that resurrects
      // their deleted task. `branchDiffersFromBase` filters B out because
      // its branch content still equals base (the branch never touched
      // it); this test reddens if that filter is removed.
      const s1 = await loadState(locttDir);
      await createTask({ locttDir, state: s1, options: { project: taskProjectId, title: "Base" } });
      const doomed = await createTask({
        locttDir, state: s1, options: { project: taskProjectId, title: "Doomed" },
      });
      await saveState(locttDir, s1);
      await publish(locttDir, root); // base has Base + Doomed

      // Remote add on the branch (moves the branch head).
      const remoteId = "01M0REMOTEADD00000000000CD";
      await commitOnBranch(async wt => {
        await mkdir(join(wt, "tasks", remoteId), { recursive: true });
        await writeFile(
          join(wt, "tasks", remoteId, "task.md"),
          `---\nid: ${remoteId}\nkey: TBASE-3\ntitle: Remote add\n`
          + `project: ${taskProjectId}\ncreated_at: 2026-01-01T00:00:00Z\n`
          + `updated_at: 2026-01-01T00:00:00Z\nstatus: todo\n---\nR.\n`,
        );
      }, "remote add");

      // Local deletes a base file, unrelated to the remote add.
      const { deleteTask } = await import("../task/lifecycle.js");
      await deleteTask(locttDir, doomed.frontmatter.id, { force: true });

      // Publish refuses (R is real remote work)…
      let caught: unknown;
      try { await publish(locttDir, root); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(GitSyncFirstError);
      // …and names ONLY the remote add, never the locally-deleted task.
      const paths = (caught as GitSyncFirstError).incomingPaths.join("\n");
      expect(paths).toContain(remoteId);
      expect(paths).not.toContain(doomed.frontmatter.id);
    });
  });
});
