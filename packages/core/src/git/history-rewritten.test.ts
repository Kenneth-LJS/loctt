import { execSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { loadSyncState } from "../state/sync.js";
import { createTask } from "../task/create.js";
import { enableGit } from "./git-mode.js";
import {
  GitConflictError,
  GitHistoryRewrittenError,
  GitReconcileNeededError,
  publish,
  sync,
} from "./publish-sync.js";

/**
 * GIT-21 (K93): a force-push / history rewrite that drops the last-synced
 * commit must be DETECTED and REFUSED, never treated as ordinary
 * divergence — which would let `planSync` take incoming over local edits
 * whose base is gone (A188 H-e, silent data loss).
 */
describe("git-sync history-rewrite refusal (GIT-21 / K93)", () => {
  let root: string;
  let locttDir: string;
  let taskProjectId: string;

  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    root = await mkdtemp(join(tmpdir(), "loctt-rewrite-"));
    execSync("git init", { cwd: root, stdio: "pipe" });
    execSync("git config user.email test@test.com", { cwd: root, stdio: "pipe" });
    execSync("git config user.name Test", { cwd: root, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", { cwd: root, stdio: "pipe" });
    await initLoctt(root);
    locttDir = resolveLocttDir(root);
    await enableGit(locttDir, root);
    const cfg = await loadProjectsConfig(locttDir);
    taskProjectId = cfg.projects[0]?.id as string;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Rewrites the `loctt` branch onto a brand-new orphan history, so the
   * recorded base commit is no longer an ancestor of the head — exactly
   * what a `git push --force` of a rewritten history looks like after a
   * fetch. Returns the new head sha.
   */
  function forcePushRewrite(): string {
    const wt = join(root, `.rewrite-${Math.random().toString(36).slice(2)}`);
    // Detach a worktree at the current branch so we can build an orphan
    // there without touching the user's checkout.
    execSync(`git worktree add --detach ${wt} loctt`, { cwd: root, stdio: "pipe" });
    try {
      // Orphan branch: no parent, so nothing on `loctt` is its ancestor.
      execSync("git checkout --orphan rewritten", { cwd: wt, stdio: "pipe" });
      execSync("git rm -rf . >/dev/null 2>&1 || true", { cwd: wt, stdio: "pipe" });
      execSync("git commit --allow-empty -m 'rewritten history'", { cwd: wt, stdio: "pipe" });
      const newHead = execSync("git rev-parse HEAD", { cwd: wt, encoding: "utf-8" }).trim();
      // Force the branch ref to the orphan — the force-push.
      execSync(`git branch -f loctt ${newHead}`, { cwd: root, stdio: "pipe" });
      return newHead;
    } finally {
      execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
    }
  }

  // @verifies GIT-21
  it("refuses to sync a force-pushed branch and names the missing commit", async () => {
    // Base: publish one task so `last_synced_commit` is set.
    const s1 = await loadState(locttDir);
    const task = await createTask({
      locttDir, state: s1, options: { project: taskProjectId, title: "Local work" },
    });
    await saveState(locttDir, s1);
    await publish(locttDir, root);

    const before = await loadSyncState(locttDir);
    const base = before.git.last_synced_commit;
    expect(base).toBeDefined();

    // A local edit made AFTER the base — the work the guard protects.
    await writeFile(join(locttDir, "config", "queries.yaml"), "queries: []\n");

    // Someone force-pushes a rewritten history that no longer contains base.
    const newHead = forcePushRewrite();
    expect(newHead).not.toBe(base);

    // Sync must refuse with the distinct error, naming the missing commit.
    let caught: unknown;
    try {
      await sync(locttDir, root);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitHistoryRewrittenError);
    // NOT surfaced as an ordinary conflict / reconcile.
    expect(caught).not.toBeInstanceOf(GitReconcileNeededError);
    expect(caught).not.toBeInstanceOf(GitConflictError);

    const err = caught as GitHistoryRewrittenError;
    expect(err.missingCommit).toBe(base);
    expect(err.remoteHead).toBe(newHead);
    // The message names the (short) missing commit and says it was rewritten.
    expect(err.message).toContain((base as string).slice(0, 8));
    expect(err.message).toMatch(/rewritten|history/i);

    // Nothing was written: the local task still exists and the guarded edit
    // is untouched.
    const localTasks = await readdir(join(locttDir, "tasks")).catch(() => [] as string[]);
    expect(localTasks).toContain(task.frontmatter.id);
    const queries = await readFile(join(locttDir, "config", "queries.yaml"), "utf-8");
    expect(queries).toBe("queries: []\n");

    // last_synced_commit is unchanged — no silent re-base.
    const after = await loadSyncState(locttDir);
    expect(after.git.last_synced_commit).toBe(base);
  });

  // @verifies GIT-21
  it("refuses even when the old base was pruned (unresolvable), still writing nothing", async () => {
    // Same setup, but the base commit is not even a resolvable object on
    // the new history — the strongest force-push case (rewritten AND gc'd).
    const s1 = await loadState(locttDir);
    await createTask({ locttDir, state: s1, options: { project: taskProjectId, title: "Local" } });
    await saveState(locttDir, s1);
    await publish(locttDir, root);
    const before = await loadSyncState(locttDir);
    const base = before.git.last_synced_commit as string;

    forcePushRewrite();
    // Expire the reflog and gc so the base object is genuinely gone. This
    // makes `merge-base --is-ancestor <base> <head>` exit non-1 (128) —
    // the "unresolvable base" branch of the guard.
    execSync("git reflog expire --expire=now --all", { cwd: root, stdio: "pipe" });
    execSync("git gc --prune=now >/dev/null 2>&1 || true", { cwd: root, stdio: "pipe" });

    await expect(sync(locttDir, root)).rejects.toBeInstanceOf(GitHistoryRewrittenError);

    // Still nothing written.
    const after = await loadSyncState(locttDir);
    expect(after.git.last_synced_commit).toBe(base);
  });

  // @verifies GIT-21
  it("refuses a publish when the branch was rewritten past the base", async () => {
    // The publish-divergence path guard: a rewrite + a local change routes
    // through detectPublishReconcile, which must refuse before planSync.
    const s1 = await loadState(locttDir);
    await createTask({ locttDir, state: s1, options: { project: taskProjectId, title: "Local" } });
    await saveState(locttDir, s1);
    await publish(locttDir, root);
    const before = await loadSyncState(locttDir);
    const base = before.git.last_synced_commit as string;

    // Local change so a divergence check runs.
    await writeFile(join(locttDir, "config", "queries.yaml"), "queries: []\n");

    forcePushRewrite();

    let caught: unknown;
    try {
      await publish(locttDir, root);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitHistoryRewrittenError);
    expect(caught).not.toBeInstanceOf(GitReconcileNeededError);
    expect((caught as GitHistoryRewrittenError).missingCommit).toBe(base);

    // Nothing was written locally and the base is unchanged.
    const after = await loadSyncState(locttDir);
    expect(after.git.last_synced_commit).toBe(base);
  });

  // @verifies GIT-21
  it("still syncs normally when the base IS an ancestor (fast-forward, not a rewrite)", async () => {
    // Positive control: an ordinary branch advance (base stays an ancestor)
    // must NOT trip the guard — otherwise the check would refuse every sync.
    const s1 = await loadState(locttDir);
    await createTask({ locttDir, state: s1, options: { project: taskProjectId, title: "Base" } });
    await saveState(locttDir, s1);
    await publish(locttDir, root);

    // The branch gains a NEW task as an ordinary commit on top (base still
    // an ancestor).
    const wt = join(root, ".advance");
    execSync(`git worktree add ${wt} loctt`, { cwd: root, stdio: "pipe" });
    try {
      const id = "01M0ADVANCE0000000000000EF";
      await mkdir(join(wt, "tasks", id), { recursive: true });
      await writeFile(
        join(wt, "tasks", id, "task.md"),
        `---\nid: ${id}\nkey: T-900\ntitle: Advanced\nstatus: todo\n`
        + `project: ${taskProjectId}\ncreated_at: 2026-01-01T00:00:00Z\n`
        + `updated_at: 2026-01-01T00:00:00Z\n---\nbody\n`,
      );
      execSync("git add -A && git commit -m advance", { cwd: wt, stdio: "pipe" });
    } finally {
      execSync(`git worktree remove ${wt} --force`, { cwd: root, stdio: "pipe" });
    }

    // Ordinary fast-forward sync succeeds — the guard does not fire.
    const result = await sync(locttDir, root);
    expect(result.updated).toBe(true);
  });
});

describe("GitHistoryRewrittenError message (A346, K129)", () => {
  // The cause and the recovery, nothing arguing what it is not
  // ("This is not an ordinary conflict." was removed).
  it("is exactly the cause, the no-change note and the recovery steps", () => {
    const err = new GitHistoryRewrittenError({
      missingCommit: "aaaaaaaa11111111", remoteHead: "bbbbbbbb22222222",
      branch: "loctt", remote: "origin",
    });
    expect(err.message).toBe(
      "Sync aborted: the history of origin/loctt was rewritten. The last commit "
      + "synced against (aaaaaaaa) is no longer part of the branch (its head is now "
      + "bbbbbbbb), so there is no shared base to merge against. A force-push or "
      + "history rewrite happened on the remote.\n\n"
      + "Nothing was written. Your local files are untouched, and last_synced_commit "
      + "was not changed.\n\n"
      + "Recover in git:\n"
      + "  - Inspect the rewritten branch: 'git log loctt' and compare with your "
      + "local .loctt/, so you can see what the rewrite dropped.\n"
      + "  - Re-establish a base explicitly in git once you have reviewed and merged "
      + "the two by hand (for example 'git branch -f loctt <commit>' to a commit you "
      + "have inspected), then sync again.",
    );
  });
});
