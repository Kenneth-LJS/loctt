import { execSync } from "node:child_process";
import { cp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadSyncState, saveSyncState } from "../state/sync.js";
import { getLocalDir } from "../paths/index.js";
import type { SyncState } from "@loctt/contracts";

export class GitSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitSyncError";
  }
}

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

function branchExists(root: string, branch: string): boolean {
  try {
    git(`rev-parse --verify ${branch}`, root);
    return true;
  } catch {
    return false;
  }
}

function ensureBranch(root: string, branch: string): void {
  if (!branchExists(root, branch)) {
    // Create orphan branch with empty commit
    git(`checkout --orphan ${branch}`, root);
    git("rm -rf . 2>/dev/null || true", root);
    git('commit --allow-empty -m "Initialize .loctt branch"', root);
    // Switch back
    git("checkout -", root);
  }
}

/**
 * Publishes local .loctt state to the canonical .loctt branch.
 * Creates the branch if it doesn't exist.
 */
export async function publish(locttDir: string, root: string): Promise<{ committed: boolean }> {
  const syncState = await loadSyncState(locttDir);
  if (!syncState.git.enabled) {
    throw new GitSyncError("Git-backed mode is not enabled");
  }

  const branch = syncState.git.branch;
  ensureBranch(root, branch);

  // Create a temporary worktree
  const worktreeDir = join(getLocalDir(locttDir), ".worktree-publish");
  await rm(worktreeDir, { recursive: true, force: true });

  try {
    git(`worktree add "${worktreeDir}" ${branch}`, root);

    // Copy local .loctt contents to worktree (excluding local/)
    const entries = await readdir(locttDir);
    for (const entry of entries) {
      if (entry === "local") continue;
      const src = join(locttDir, entry);
      const dest = join(worktreeDir, entry);
      await cp(src, dest, { recursive: true, force: true });
    }

    // Stage and commit in worktree
    git("add -A", worktreeDir);

    const status = git("status --porcelain", worktreeDir);
    if (!status) {
      return { committed: false };
    }

    git('commit -m "loctt publish"', worktreeDir);
    const commitHash = git("rev-parse HEAD", worktreeDir);

    // Update sync state
    const updated: SyncState = {
      git: {
        enabled: true,
        branch,
        last_synced_commit: commitHash,
      },
    };
    await saveSyncState(locttDir, updated);

    return { committed: true };
  } finally {
    git(`worktree remove "${worktreeDir}" --force 2>/dev/null || true`, root);
    await rm(worktreeDir, { recursive: true, force: true });
  }
}

/**
 * Syncs canonical .loctt branch state into the local workspace.
 * No-ops if remote hasn't changed since last sync.
 */
export async function sync(locttDir: string, root: string): Promise<{ updated: boolean }> {
  const syncState = await loadSyncState(locttDir);
  if (!syncState.git.enabled) {
    throw new GitSyncError("Git-backed mode is not enabled");
  }

  const branch = syncState.git.branch;
  if (!branchExists(root, branch)) {
    return { updated: false };
  }

  const remoteHead = git(`rev-parse ${branch}`, root);
  if (syncState.git.last_synced_commit === remoteHead) {
    return { updated: false };
  }

  // Create temporary worktree to read remote state
  const worktreeDir = join(getLocalDir(locttDir), ".worktree-sync");
  await rm(worktreeDir, { recursive: true, force: true });

  try {
    git(`worktree add "${worktreeDir}" ${branch}`, root);

    // Copy remote state to local .loctt (excluding local/)
    const entries = await readdir(worktreeDir);
    for (const entry of entries) {
      if (entry === ".git" || entry === "local") continue;
      const src = join(worktreeDir, entry);
      const dest = join(locttDir, entry);
      await cp(src, dest, { recursive: true, force: true });
    }

    // Update sync state
    const updated: SyncState = {
      git: {
        enabled: true,
        branch,
        last_synced_commit: remoteHead,
      },
    };
    await saveSyncState(locttDir, updated);

    return { updated: true };
  } finally {
    git(`worktree remove "${worktreeDir}" --force 2>/dev/null || true`, root);
    await rm(worktreeDir, { recursive: true, force: true });
  }
}
