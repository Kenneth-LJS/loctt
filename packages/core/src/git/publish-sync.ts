import { spawnSync } from "node:child_process";
import { cp, readdir,rm } from "node:fs/promises";
import { join } from "node:path";

import type { SyncState } from "@loctt/contracts";

import { getLocalDir } from "../paths/index.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";

/**
 * Mirrors srcDir into destDir: removes entries in dest that don't exist in src,
 * then copies all src entries into dest. Entries in `exclude` are never touched.
 */
async function mirrorDir(
  srcDir: string,
  destDir: string,
  exclude: ReadonlySet<string>,
): Promise<void> {
  // Remove destination entries that no longer exist in source
  const srcEntries = new Set(await readdir(srcDir));
  const destEntries = await readdir(destDir).catch(() => [] as string[]);
  for (const entry of destEntries) {
    if (exclude.has(entry)) continue;
    if (!srcEntries.has(entry)) {
      await rm(join(destDir, entry), { recursive: true, force: true });
    }
  }

  // Copy all source entries to destination (remove dest first to ensure clean mirror)
  for (const entry of srcEntries) {
    if (exclude.has(entry)) continue;
    const dest = join(destDir, entry);
    await rm(dest, { recursive: true, force: true });
    await cp(join(srcDir, entry), dest, { recursive: true, force: true });
  }
}

export class GitSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitSyncError";
  }
}

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

function gitSafe(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  return result.stdout?.trim() ?? "";
}

function branchExists(root: string, branch: string): boolean {
  try {
    git(["rev-parse", "--verify", branch], root);
    return true;
  } catch {
    return false;
  }
}

function ensureBranch(root: string, branch: string): void {
  if (!branchExists(root, branch)) {
    // Create orphan branch with an empty commit using plumbing commands.
    // This never touches the user's working tree or index.
    const emptyTree = git(["hash-object", "-t", "tree", "/dev/null"], root);
    const commit = git(
      ["commit-tree", emptyTree, "-m", "Initialize loctt branch"],
      root,
    );
    git(["update-ref", `refs/heads/${branch}`, commit], root);
  }
}

/**
 * Publishes local .loctt state to the canonical loctt branch.
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
    git(["worktree", "add", worktreeDir, branch], root);

    // Mirror local .loctt into worktree (excluding local/ and .git)
    await mirrorDir(locttDir, worktreeDir, new Set(["local", ".git"]));

    // Stage and commit in worktree
    git(["add", "-A"], worktreeDir);

    const status = git(["status", "--porcelain"], worktreeDir);
    if (!status) {
      return { committed: false };
    }

    git(["commit", "-m", "loctt publish"], worktreeDir);
    const commitHash = git(["rev-parse", "HEAD"], worktreeDir);

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
    try {
      gitSafe(["worktree", "remove", worktreeDir, "--force"], root);
    } catch {
      // cleanup failed — don't mask the original error
    }
    try {
      await rm(worktreeDir, { recursive: true, force: true });
    } catch {
      // same
    }
  }
}

/**
 * Syncs canonical loctt branch state into the local workspace.
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

  const remoteHead = git(["rev-parse", branch], root);
  if (syncState.git.last_synced_commit === remoteHead) {
    return { updated: false };
  }

  // Create temporary worktree to read remote state
  const worktreeDir = join(getLocalDir(locttDir), ".worktree-sync");
  await rm(worktreeDir, { recursive: true, force: true });

  try {
    git(["worktree", "add", worktreeDir, branch], root);

    // Mirror remote state into local .loctt (excluding local/ and .git)
    await mirrorDir(worktreeDir, locttDir, new Set(["local", ".git"]));

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
    try {
      gitSafe(["worktree", "remove", worktreeDir, "--force"], root);
    } catch {
      // cleanup failed — don't mask the original error
    }
    try {
      await rm(worktreeDir, { recursive: true, force: true });
    } catch {
      // same
    }
  }
}
