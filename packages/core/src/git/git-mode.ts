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
import { branchExists, branchHasForeignContent, branchHeadCommit, countLocalChanges, remoteExists } from "./publish-sync.js";

export interface GitStatusResult {
  readonly enabled: boolean;
  readonly branch: string;
  readonly remote: string;
  readonly autoPush: boolean;
  readonly autoFetch: boolean;
  readonly lastSyncedCommit?: string;
  readonly isGitRepo: boolean;
  /**
   * Whether a remote is configured at all, as distinct from its name
   * (GIT-C6). `remote` always holds a name because it defaults to
   * `origin` — so a UI reading only the name would announce a remote on
   * a repo that has none, and offer a push that cannot work.
   */
  readonly remoteConfigured: boolean;
  /**
   * Local files that differ from the branch — work this machine has that
   * a publish would send. Undefined when it cannot be determined (git
   * mode off, no branch yet, or not a repo), which is distinct from
   * zero: "nothing to publish" and "cannot tell" must not render alike.
   */
  readonly localChanges?: number;
  /**
   * Whether the branch has moved since the last sync — work a sync would
   * bring in. Undefined when undeterminable, as above.
   */
  readonly remoteChanges?: boolean;
  /** Branch head, so a caller can show what a sync would move to. */
  readonly branchCommit?: string;
  /**
   * Set when `sync.yaml` exists and could not be read, in which case
   * every config-derived field above is a **default, not a reading**.
   *
   * The bug this replaces: a bare catch returned a fully-populated
   * object with `enabled: false`, so `loctt git status` reported git
   * mode off for a tracker where it was on. That answer is plausible —
   * "off" is a normal thing to see — so nothing signals it should be
   * distrusted, and the natural response is to re-enable, which writes
   * over the state being recovered.
   *
   * A caller MUST check this before reporting any field below it. The
   * absent-file case is handled separately and does not set this: no
   * sync.yaml genuinely means git mode is off.
   */
  readonly unreadable?: {
    readonly path: string;
    readonly reason: string;
  };
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

  // Created only once every guard above has passed. A failed enable
  // that leaves local/ behind is a tracker holding the shape of
  // git-backed mode without the state to perform it (GIT-C9).
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
      // Git mode is off, so nothing is configured and no drift is
      // computable. Both drift fields stay absent rather than 0 — the
      // caller must be able to tell "nothing pending" from "cannot say".
      remoteConfigured: false,
    };
  }

  try {
    const state = await loadSyncState(locttDir);

    // Drift, in both directions (GIT-C6). Without these a caller has a
    // config echo and cannot render "N local changes, M remote changes"
    // without re-deriving everything itself.
    //
    // Only computed when git mode is on and we are in a repo: outside
    // that, "0 changes" would be a claim we have not checked.
    let localChanges: number | undefined;
    let remoteChanges: boolean | undefined;
    let branchCommit: string | undefined;
    if (state.git.enabled && gitRepo && branchExists(root, state.git.branch)) {
      localChanges = countLocalChanges(root, locttDir, state.git.branch);
      branchCommit = branchHeadCommit(root, state.git.branch);
      // The branch moved since we last reconciled with it. Undefined
      // rather than false when either side is unknown — a never-synced
      // tracker has no baseline to compare against.
      remoteChanges = branchCommit === undefined
        ? undefined
        : branchCommit !== state.git.last_synced_commit;
    }

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
      // `remote` always carries a name because it defaults to `origin`,
      // so a UI reading only the name would announce a remote on a repo
      // that has none — and offer a push that cannot work.
      remoteConfigured: gitRepo && remoteExists(root, state.git.remote),
      ...(localChanges !== undefined ? { localChanges } : {}),
      ...(remoteChanges !== undefined ? { remoteChanges } : {}),
      ...(branchCommit !== undefined ? { branchCommit } : {}),
    };
  } catch (err) {
    // sync.yaml exists — `fileExists` above already ruled out absence —
    // so this is a file the user has and we could not read. Reporting
    // `enabled: false` here states a fact about it that nobody checked.
    return {
      enabled: false,
      branch: DEFAULT_GIT_BRANCH,
      remote: DEFAULT_GIT_REMOTE,
      autoPush: DEFAULT_GIT_AUTO_PUSH,
      autoFetch: DEFAULT_GIT_AUTO_FETCH,
      isGitRepo: gitRepo,
      remoteConfigured: false,
      unreadable: {
        path: syncPath,
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
