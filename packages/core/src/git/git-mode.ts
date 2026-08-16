import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

import type { SyncState } from "@loctt/contracts";
import {
  DEFAULT_GIT_AUTO_FETCH,
  DEFAULT_GIT_AUTO_PUSH,
  DEFAULT_GIT_BRANCH,
  DEFAULT_GIT_REMOTE,
} from "@loctt/contracts";

import { getLocalDir,getSyncStatePath } from "../paths/index.js";
import { loadSyncState,saveSyncState } from "../state/sync.js";
import { fileExists } from "../utils/fs.js";
import { branchExists, branchHasForeignContent } from "./publish-sync.js";

export interface GitStatusResult {
  readonly enabled: boolean;
  readonly branch: string;
  readonly remote: string;
  readonly autoPush: boolean;
  readonly autoFetch: boolean;
  readonly lastSyncedCommit?: string;
  readonly isGitRepo: boolean;
}

function isGitRepo(root: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "pipe" });
  return result.status === 0;
}

/**
 * Enables Git-backed mode by creating sync.yaml in .loctt/local/.
 * Throws if not inside a Git repository.
 */
export async function enableGit(locttDir: string, root: string): Promise<void> {
  if (!isGitRepo(root)) {
    throw new Error("not inside a Git repository — cannot enable Git-backed mode");
  }

  // Publish refuses to adopt a branch holding content LocTT did not
  // write — mirroring would delete it. Checking only there meant the
  // user learned about the conflict after configuring git-backed mode,
  // when a later publish failed. Surface the same choice up front
  // (GIT-C7).
  //
  // Reads the *configured* branch rather than the literal "loctt", so a
  // reconfigured branch is checked instead (GIT-C10).
  const branch = (await loadSyncState(locttDir).catch(() => undefined))?.git.branch
    ?? DEFAULT_GIT_BRANCH;
  if (branchExists(root, branch)) {
    const foreign = branchHasForeignContent(root, branch);
    if (foreign.length > 0) {
      throw new Error(
        `branch '${branch}' already exists and holds content LocTT did not write `
        + `(${foreign.slice(0, 5).join(", ")}${foreign.length > 5 ? ", …" : ""}). `
        + `Publishing would delete it. Choose a different branch with `
        + `'loctt config set git.branch <name>' before enabling, or delete `
        + `'${branch}' if it is no longer needed.`,
      );
    }
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
      branch: DEFAULT_GIT_BRANCH,
      remote: DEFAULT_GIT_REMOTE,
      auto_push: DEFAULT_GIT_AUTO_PUSH,
      auto_fetch: DEFAULT_GIT_AUTO_FETCH,
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
      remote: current.git.remote,
      auto_push: current.git.auto_push,
      auto_fetch: current.git.auto_fetch,
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

  // Publish refuses to adopt a branch holding content LocTT did not
  // write — mirroring would delete it. Checking only there meant the
  // user learned about the conflict after configuring git-backed mode,
  // when a later publish failed. Surface the same choice up front
  // (GIT-C7).
  //
  // Reads the *configured* branch rather than the literal "loctt", so a
  // reconfigured branch is checked instead (GIT-C10).
  const branch = (await loadSyncState(locttDir).catch(() => undefined))?.git.branch
    ?? DEFAULT_GIT_BRANCH;
  if (branchExists(root, branch)) {
    const foreign = branchHasForeignContent(root, branch);
    if (foreign.length > 0) {
      throw new Error(
        `branch '${branch}' already exists and holds content LocTT did not write `
        + `(${foreign.slice(0, 5).join(", ")}${foreign.length > 5 ? ", …" : ""}). `
        + `Publishing would delete it. Choose a different branch with `
        + `'loctt config set git.branch <name>' before enabling, or delete `
        + `'${branch}' if it is no longer needed.`,
      );
    }
  }

  const syncPath = getSyncStatePath(locttDir);
  if (!(await fileExists(syncPath))) {
    return {
      enabled: false,
      branch: DEFAULT_GIT_BRANCH,
      remote: DEFAULT_GIT_REMOTE,
      autoPush: DEFAULT_GIT_AUTO_PUSH,
      autoFetch: DEFAULT_GIT_AUTO_FETCH,
      isGitRepo: gitRepo,
    };
  }

  try {
    const state = await loadSyncState(locttDir);
    return {
      enabled: state.git.enabled,
      branch: state.git.branch,
      remote: state.git.remote,
      autoPush: state.git.auto_push,
      autoFetch: state.git.auto_fetch,
      ...(state.git.last_synced_commit !== undefined
        ? { lastSyncedCommit: state.git.last_synced_commit }
        : {}),
      isGitRepo: gitRepo,
    };
  } catch {
    return {
      enabled: false,
      branch: DEFAULT_GIT_BRANCH,
      remote: DEFAULT_GIT_REMOTE,
      autoPush: DEFAULT_GIT_AUTO_PUSH,
      autoFetch: DEFAULT_GIT_AUTO_FETCH,
      isGitRepo: gitRepo,
    };
  }
}
