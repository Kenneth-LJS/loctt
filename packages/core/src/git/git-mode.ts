import { spawnSync } from "node:child_process";
import { saveSyncState, loadSyncState } from "../state/sync.js";
import { getSyncStatePath, getLocalDir } from "../paths/index.js";
import { mkdir, access } from "node:fs/promises";
import type { SyncState } from "@loctt/contracts";

export interface GitStatusResult {
  readonly enabled: boolean;
  readonly branch: string;
  readonly lastSyncedCommit?: string;
  readonly isGitRepo: boolean;
}

function isGitRepo(root: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "pipe" });
  return result.status === 0;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enables Git-backed mode by creating sync.yaml in .loctt/local/.
 * Throws if not inside a Git repository.
 */
export async function enableGit(locttDir: string, root: string): Promise<void> {
  if (!isGitRepo(root)) {
    throw new Error("not inside a Git repository — cannot enable Git-backed mode");
  }

  const syncPath = getSyncStatePath(locttDir);
  if (await fileExists(syncPath)) {
    const state = await loadSyncState(locttDir);
    if (state.git.enabled) {
      throw new Error("Git-backed mode is already enabled");
    }
  }

  const localDir = getLocalDir(locttDir);
  await mkdir(localDir, { recursive: true });

  const state: SyncState = {
    git: {
      enabled: true,
      branch: ".loctt",
    },
  };

  await saveSyncState(locttDir, state);
}

/**
 * Disables Git-backed mode by updating sync.yaml.
 */
export async function disableGit(locttDir: string): Promise<void> {
  const syncPath = getSyncStatePath(locttDir);
  if (!(await fileExists(syncPath))) {
    throw new Error("Git-backed mode is not enabled");
  }

  const current = await loadSyncState(locttDir);
  if (!current.git.enabled) {
    throw new Error("Git-backed mode is already disabled");
  }

  const state: SyncState = {
    git: {
      enabled: false,
      branch: current.git.branch,
      ...(current.git.last_synced_commit ? { last_synced_commit: current.git.last_synced_commit } : {}),
    },
  };

  await saveSyncState(locttDir, state);
}

/**
 * Gets the current Git-backed mode status.
 */
export async function getGitStatus(locttDir: string, root: string): Promise<GitStatusResult> {
  const gitRepo = isGitRepo(root);

  const syncPath = getSyncStatePath(locttDir);
  if (!(await fileExists(syncPath))) {
    return {
      enabled: false,
      branch: ".loctt",
      isGitRepo: gitRepo,
    };
  }

  try {
    const state = await loadSyncState(locttDir);
    return {
      enabled: state.git.enabled,
      branch: state.git.branch,
      lastSyncedCommit: state.git.last_synced_commit,
      isGitRepo: gitRepo,
    };
  } catch {
    return {
      enabled: false,
      branch: ".loctt",
      isGitRepo: gitRepo,
    };
  }
}
