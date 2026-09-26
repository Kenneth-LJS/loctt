import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig } from "../config/projects.js";
import { initLoctt } from "../init/init.js";
import { getLocalDir, getTaskFilePath, resolveLocttDir } from "../paths/index.js";
import { loadState, saveState } from "../state/state.js";
import { createTask } from "../task/create.js";
import { enableGit } from "./git-mode.js";
import { GitWorktreeMissingError, publish, sync } from "./publish-sync.js";

/**
 * GIT-36: LocTT's temporary publish/sync worktree is registered by git but
 * its directory is gone and prune cannot clear it (a *locked* worktree
 * whose directory was deleted by hand). `git worktree add` then dies with
 * "missing but locked worktree" — an opaque fatal naming an internal path.
 *
 * The behaviour under test is the NAMING and the untouched local files, not
 * new worktree logic: publish/sync must refuse with a {@link
 * GitWorktreeMissingError} that names the worktree and states it is
 * missing, and must not have modified any local task file.
 */
describe("GIT-36 · a missing/corrupt publish/sync worktree", () => {
  let root: string;
  let locttDir: string;
  let taskProjectId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-git36-"));
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
   * Wedges the named worktree into git's "registered + locked, directory
   * gone" state — the case prune will NOT clear, so the next `add` fatals.
   * Requires the loctt branch to already exist (a prior publish).
   */
  function wedgeWorktree(name: string): void {
    const wt = join(getLocalDir(locttDir), name);
    execSync(`git worktree add "${wt}" loctt`, { cwd: root, stdio: "pipe" });
    execSync(`git worktree lock "${wt}"`, { cwd: root, stdio: "pipe" });
    // Delete the directory by hand while git still has it locked.
    execSync(`rm -rf "${wt}"`, { cwd: root, stdio: "pipe" });
  }

  // @verifies GIT-36
  it("publish refuses with a named error naming the worktree, leaving local files untouched", async () => {
    // A first publish creates the loctt branch and a real task on disk.
    const state = await loadState(locttDir);
    const task = await createTask({
      locttDir, state, options: { project: taskProjectId, title: "Untouched" },
    });
    await saveState(locttDir, state);
    await publish(locttDir, root);

    const taskFile = getTaskFilePath(locttDir, task.frontmatter.id);
    const before = await readFile(taskFile, "utf-8");

    wedgeWorktree(".worktree-publish");

    let caught: unknown;
    try {
      await publish(locttDir, root);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GitWorktreeMissingError);
    const e = caught as GitWorktreeMissingError;
    // Names the worktree specifically, and that it is missing.
    expect(e.worktreeDir).toContain(".worktree-publish");
    expect(e.operation).toBe("publish");
    expect(e.message).toContain(".worktree-publish");
    expect(e.message.toLowerCase()).toContain("missing");
    // Not an opaque git fatal: it names LocTT's worktree, not just git's line.
    expect(e.message).toMatch(/worktree/i);
    // Offers a concrete repair path stating what it does to local files.
    expect(e.message).toMatch(/disable/i);
    expect(e.message).toMatch(/re-establish|prune|unlock/i);
    // Local task file was NOT modified by the failed publish.
    expect(await readFile(taskFile, "utf-8")).toBe(before);
  });

  // @verifies GIT-36
  it("sync refuses with a named error and does not modify local task files", async () => {
    const state = await loadState(locttDir);
    const task = await createTask({
      locttDir, state, options: { project: taskProjectId, title: "Sync untouched" },
    });
    await saveState(locttDir, state);
    await publish(locttDir, root);

    // Advance the branch so a sync would actually want to apply something —
    // proving the refusal happens before any local write, not because there
    // was nothing to do.
    const editWt = join(root, ".edit-worktree");
    execSync(`git worktree add "${editWt}" loctt`, { cwd: root, stdio: "pipe" });
    try {
      execSync("git commit --allow-empty -m 'advance branch'", { cwd: editWt, stdio: "pipe" });
    } finally {
      execSync(`git worktree remove "${editWt}" --force`, { cwd: root, stdio: "pipe" });
    }

    const taskFile = getTaskFilePath(locttDir, task.frontmatter.id);
    const before = await readFile(taskFile, "utf-8");

    wedgeWorktree(".worktree-sync");

    let caught: unknown;
    try {
      await sync(locttDir, root);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GitWorktreeMissingError);
    const e = caught as GitWorktreeMissingError;
    expect(e.worktreeDir).toContain(".worktree-sync");
    expect(e.operation).toBe("sync");
    expect(e.message).toContain(".worktree-sync");
    expect(e.message.toLowerCase()).toContain("missing");
    // Local task file untouched by the failed sync.
    expect(await readFile(taskFile, "utf-8")).toBe(before);
  });

  // @verifies GIT-36
  it("does NOT mislabel an unrelated git failure as a missing worktree", async () => {
    // Remove the repository out from under the tracker: publish then fails
    // for a genuinely different reason (no git repo at all). That must fall
    // through to the generic git error, NOT be dressed up as GIT-36 — a
    // mislabel would point the user's repair at the wrong thing.
    const state = await loadState(locttDir);
    await createTask({ locttDir, state, options: { project: taskProjectId, title: "x" } });
    await saveState(locttDir, state);
    await rm(join(root, ".git"), { recursive: true, force: true });

    let caught: unknown;
    try {
      await publish(locttDir, root);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(GitWorktreeMissingError);
  });
});

describe("GitWorktreeMissingError message (A346, K129)", () => {
  // "This is not an ordinary git failure. The worktree named above is the
  // specific thing that is wrong." was removed: cause and repair only.
  it("is exactly the cause, the no-change note and the repair steps", () => {
    const err = new GitWorktreeMissingError({ worktreeDir: "/r/.wt", operation: "sync", detail: "fatal" });
    expect(err.message).toBe(
      "Sync could not start: the temporary git worktree at '/r/.wt' is missing, "
      + "but git still has it registered (most likely it was deleted by hand while "
      + "git had it locked), so it cannot be re-created.\n\n"
      + "Your local task files were not touched: the sync never reached the point "
      + "of writing to .loctt/, so nothing was applied.\n\n"
      + "Repair with either:\n"
      + "  - Re-establish the worktree: run 'git worktree prune' (or, if git reports "
      + "it locked, 'git worktree remove --force /r/.wt' or 'git worktree unlock "
      + "/r/.wt'), then sync again. This clears git's stale bookkeeping only, "
      + "leaving your .loctt/ task files as they are.\n"
      + "  - Disable and re-enable git sync: 'loctt git disable' then 'loctt git "
      + "enable'. This rebuilds the git setup from scratch and also leaves your "
      + ".loctt/ task files exactly as they are on disk.",
    );
  });
});
