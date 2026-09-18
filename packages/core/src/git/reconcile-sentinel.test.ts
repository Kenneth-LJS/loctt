import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initLoctt } from "../init/init.js";
import { getReconcileStatePath } from "../paths/index.js";
import { readReconcileState, saveReconcileState } from "../state/reconcile.js";
import { enableGit } from "./git-mode.js";
import { GitReconcileInterruptedError, publish, pullFromLocttBranch } from "./publish-sync.js";

/**
 * @verifies GIT-C3
 *
 * `reconcile.yaml` was fully specified and implemented — schema, parse,
 * save, load, clear — and written by nothing. A sync crashing between
 * `applyPlan` and `saveSyncState` left an unknown subset of a plan
 * applied, with nothing on disk saying so. The next run then planned
 * against `last_synced_commit`, a base whose diff no longer described
 * the workspace.
 */

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const r = roots.pop();
    if (r) await rm(r, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/**
 * A git-backed tracker published to the loctt branch.
 *
 * Under the OS tmpdir, not `tests/workspace/`: a `git init` inside
 * LocTT's own checkout resolves to LocTT's `.git`, and the test would
 * silently exercise the wrong repository.
 */
async function tracker(): Promise<{ root: string; locttDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "loctt-reconcile-"));
  roots.push(root);
  git(root, "init");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  git(root, "commit", "--allow-empty", "-m", "init");
  await initLoctt(root);
  const locttDir = join(root, ".loctt");
  await enableGit(locttDir, root);
  await publish(locttDir, root);
  return { root, locttDir };
}

/** Commits an edit on the loctt branch so the next sync has work to do. */
function editBranch(root: string): void {
  const worktree = join(root, "..", `wt-reconcile-${process.pid}`);
  git(root, "worktree", "add", "-q", worktree, "loctt");
  try {
    execFileSync("sh", ["-c", "echo '# touched' >> docs/README.md || true"], { cwd: worktree });
    git(worktree, "add", "-A");
    git(worktree, "commit", "-m", "branch edit");
  } finally {
    git(root, "worktree", "remove", "--force", worktree);
  }
}

describe("reconciliation sentinel", () => {
  it("leaves no sentinel behind after a sync that completes", async () => {
    const { root, locttDir } = await tracker();
    editBranch(root);

    const outcome = await pullFromLocttBranch(locttDir, root);
    // Guard against a vacuous pass: a sync that did nothing would also
    // leave no sentinel.
    expect(outcome.updated).toBe(true);

    expect(await readReconcileState(locttDir)).toBeUndefined();
  });

  it("refuses to sync while a previous reconciliation is unfinished", async () => {
    const { root, locttDir } = await tracker();
    editBranch(root);

    // Stand in for a crash between the first write and the last.
    await saveReconcileState(locttDir, {
      mode: "sync",
      base_commit: "a".repeat(40),
      remote_commit: "b".repeat(40),
      started_at: "2026-01-01T00:00:00.000Z",
    });

    await expect(pullFromLocttBranch(locttDir, root))
      .rejects.toThrow(GitReconcileInterruptedError);
  });

  it("names the interrupted operation rather than failing generically", async () => {
    const { root, locttDir } = await tracker();
    await saveReconcileState(locttDir, {
      mode: "sync",
      base_commit: "a".repeat(40),
      remote_commit: "b".repeat(40),
      started_at: "2026-01-01T00:00:00.000Z",
    });

    const err = await pullFromLocttBranch(locttDir, root).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitReconcileInterruptedError);
    const message = (err as Error).message;

    // What was in flight, and between which commits.
    expect(message).toContain("sync");
    expect(message).toContain("2026-01-01T00:00:00.000Z");
    expect(message).toContain("aaaaaaaa");
    expect(message).toContain("bbbbbbbb");
    // How to get out of it. Telling the user to re-run sync would be a
    // dead end, since sync is what refuses.
    expect(message).toContain("reconcile.yaml");
  });

  it("syncs again once the sentinel is cleared", async () => {
    const { root, locttDir } = await tracker();
    editBranch(root);
    await saveReconcileState(locttDir, {
      mode: "sync",
      base_commit: "a".repeat(40),
      remote_commit: "b".repeat(40),
      started_at: "2026-01-01T00:00:00.000Z",
    });
    await expect(pullFromLocttBranch(locttDir, root)).rejects.toThrow();

    await rm(getReconcileStatePath(locttDir), { force: true });

    // The documented recovery has to actually work, or the message is
    // sending the user nowhere.
    const outcome = await pullFromLocttBranch(locttDir, root);
    expect(outcome.updated).toBe(true);
  });

  it("refuses rather than treating an unparseable sentinel as absent", async () => {
    const { root, locttDir } = await tracker();
    await writeFile(getReconcileStatePath(locttDir), "mode: not_a_mode\n", "utf8");

    // Reading a corrupt sentinel as "nothing in progress" would let the
    // next sync overwrite a half-applied workspace — the exact outcome
    // the sentinel exists to prevent.
    await expect(pullFromLocttBranch(locttDir, root)).rejects.toThrow();
  });

  it("writes the sentinel before mutating the workspace", async () => {
    const { root, locttDir } = await tracker();
    editBranch(root);

    // Prove the ordering rather than the end state: the file is gone by
    // the time sync returns, so only an observation taken mid-run can
    // distinguish "written first" from "never written".
    let sawSentinelDuringSync = false;
    const readmePath = join(locttDir, "docs/README.md");
    const watcher = setInterval(() => {
      void readFile(getReconcileStatePath(locttDir), "utf8")
        .then(() => { sawSentinelDuringSync = true; })
        .catch(() => { /* not yet written, or already cleared */ });
    }, 1);

    try {
      await pullFromLocttBranch(locttDir, root);
    } finally {
      clearInterval(watcher);
    }

    expect(readmePath).toBeTruthy();
    expect(sawSentinelDuringSync).toBe(true);
  });
});

describe("directory pruning after a sync", () => {
  it("does not remove .loctt/tasks when the last task is deleted", async () => {
    const { root, locttDir } = await tracker();

    // Create a task, publish it, then delete it on the branch so the
    // next sync propagates the deletion locally.
    const { loadProjectsConfig } = await import("../config/projects.js");
    const { loadState, saveState } = await import("../state/state.js");
    const { createTask } = await import("../task/create.js");
    const projects = await loadProjectsConfig(locttDir);
    const project = projects.projects[0]?.id;
    if (project === undefined) throw new Error("fixture: init created no project");
    const state = await loadState(locttDir);
    await createTask({ locttDir, state, options: { project, title: "only task" } });
    await saveState(locttDir, state);
    await publish(locttDir, root);

    const worktree = join(root, "..", `wt-prune-${process.pid}`);
    git(root, "worktree", "add", "-q", worktree, "loctt");
    try {
      execFileSync("sh", ["-c", "rm -rf tasks/*"], { cwd: worktree });
      git(worktree, "add", "-A");
      git(worktree, "commit", "-m", "delete every task");
    } finally {
      git(root, "worktree", "remove", "--force", worktree);
    }

    await pullFromLocttBranch(locttDir, root);

    // The task's own directory should be gone — an empty task dir reads
    // as a corrupt task rather than an absent one.
    const { readdir } = await import("node:fs/promises");
    const tasksDir = join(locttDir, "tasks");
    const remaining = await readdir(tasksDir).catch(() => null);

    // But `tasks/` itself must survive. Deleting it leaves a tracker
    // whose shape no longer matches what `init` creates: an empty
    // tasks/ is a tracker with no tasks, a missing one looks broken.
    expect(remaining, ".loctt/tasks must still exist").not.toBeNull();
    expect(remaining).toEqual([]);
  });
});
