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
import { detectSyncFsAdvisory, type FsProbe, type SyncFsAdvisory } from "./fstype.js";
import { branchExists, branchHasForeignContent, branchHeadCommit, countLocalChanges, GitBranchAdoptNeededError, remoteExists } from "./publish-sync.js";

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
  /**
   * GIT-22: set when the tracker sits on a filesystem where POSIX
   * advisory locks are unreliable (iCloud Drive, Dropbox, OneDrive, NFS,
   * SMB). Surfaced *proactively* — before the user relies on git sync —
   * so the class is named at enable time rather than only after a lock
   * failure. Absent when the probe cannot determine the class: an
   * unknown filesystem produces no warning rather than a false one. The
   * warning never blocks — enable still proceeds.
   */
  readonly fstypeAdvisory?: SyncFsAdvisory;
}

function isGitRepo(root: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "pipe" });
  return result.status === 0;
}

/**
 * The result of enabling Git-backed mode. Enable never fails on the
 * filesystem-class check (GIT-22) — it warns and proceeds — so the
 * advisory rides back on success for the surface to report.
 */
export interface EnableGitResult {
  /**
   * GIT-22: present when the tracker is on iCloud/Dropbox/OneDrive/NFS/SMB.
   * Enable still succeeded; the caller surfaces this as an advisory.
   */
  readonly fstypeAdvisory?: SyncFsAdvisory;
  /**
   * GIT-25: present when enable *adopted* a pre-existing LocTT-written
   * branch (the caller passed `adopt: true` and such a branch existed).
   * Carries the adopted branch, its head commit — which `last_synced_commit`
   * was set to — and whether local state already agrees with that branch,
   * so the surface can tell the user whether a sync is needed rather than
   * leave them guessing. Absent on a fresh enable (no pre-existing branch).
   */
  readonly adopted?: {
    readonly branch: string;
    readonly branchHead: string;
    /**
     * True when local publishable state matches the adopted branch (no
     * sync needed); false when it differs (a sync/publish would move
     * work); undefined when it could not be determined (drift uncountable).
     */
    readonly inAgreement: boolean | undefined;
  };
}

/** Options for {@link enableGit}. */
export interface EnableGitOptions {
  /**
   * GIT-25: confirm adopting a pre-existing LocTT-written branch. Without
   * it, enable throws {@link GitBranchAdoptNeededError} (naming the branch
   * + head, writing nothing) so a non-interactive surface reports the
   * choice rather than silently adopting. With it, enable adopts — sets
   * `last_synced_commit` to the branch head and reports agreement. Has no
   * effect when no such branch exists.
   */
  readonly adopt?: boolean;
}

/**
 * Enables Git-backed mode by creating sync.yaml in .loctt/local/.
 * Throws if not inside a Git repository.
 *
 * `probe` is the filesystem probe used for the GIT-22 advisory; the
 * default reads the real mount, and tests inject a fake so only the
 * external OS call is mocked. The advisory is computed *after* the
 * enable succeeds and never blocks it.
 */
export async function enableGit(
  locttDir: string,
  root: string,
  probe?: FsProbe,
  options?: EnableGitOptions,
): Promise<EnableGitResult> {
  if (!isGitRepo(root)) {
    throw new Error("Not inside a Git repository. Cannot enable Git-backed mode.");
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
  // GIT-25: a pre-existing branch that LocTT wrote is safe to adopt but
  // must not be adopted silently — resolved after the enabled-guard
  // below so we do not report an adopt decision on a tracker that is
  // already enabled (that stays the "already enabled" error).
  let adoptDecision: EnableGitResult["adopted"];
  if (branchExists(root, branch)) {
    const foreign = branchHasForeignContent(root, branch);
    if (foreign.length > 0) {
      throw new Error(
        `Branch '${branch}' already exists and holds content this tracker did not write `
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

  // GIT-25: the branch is LocTT-written (the foreign guard above passed)
  // and already exists. Adopting it is a knowing choice — without an
  // explicit confirmation, refuse-and-report (naming the branch + head,
  // writing nothing), exactly as the foreign-content case refuses up
  // front (GIT-C7). With confirmation, adopt below.
  const existingHead = branchExists(root, branch) ? branchHeadCommit(root, branch) : undefined;
  if (existingHead !== undefined) {
    if (options?.adopt !== true) {
      throw new GitBranchAdoptNeededError({ branch, branchHead: existingHead });
    }
    // Adopt: record the branch head as the baseline and report whether
    // local already agrees with it. countLocalChanges compares local
    // publishable files against the branch; 0 means in agreement, >0
    // means a sync/publish would move work, undefined means uncountable.
    const localChanges = countLocalChanges(root, locttDir, branch);
    adoptDecision = {
      branch,
      branchHead: existingHead,
      inAgreement: localChanges === undefined ? undefined : localChanges === 0,
    };
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
      // GIT-25: adopting an existing branch sets the sync baseline to its
      // head — the one legitimate `last_synced_commit` write at enable
      // time. A fresh enable (no existing branch) leaves it unset.
      ...(adoptDecision !== undefined ? { last_synced_commit: adoptDecision.branchHead } : {}),
    },
  };

  await saveSyncState(locttDir, state);

  // GIT-22: warn — do not block. The advisory is best-effort and never
  // throws (detectSyncFsAdvisory swallows a misbehaving probe), so an
  // enable on a hazardous filesystem still succeeds and simply carries
  // the warning back.
  const fstypeAdvisory = detectSyncFsAdvisory(root, probe);
  return {
    ...(fstypeAdvisory !== undefined ? { fstypeAdvisory } : {}),
    ...(adoptDecision !== undefined ? { adopted: adoptDecision } : {}),
  };
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
 *
 * `probe` is the filesystem probe for the GIT-22 advisory (tests inject
 * a fake); the default reads the real mount. The advisory is computed
 * whenever the directory is a git repo so the disabled panel can warn
 * *before* enabling, mirroring the no-remote advisory (GIT-27).
 */
export async function getGitStatus(
  locttDir: string,
  root: string,
  probe?: FsProbe,
): Promise<GitStatusResult> {
  const gitRepo = isGitRepo(root);
  // Best-effort and never-throwing (see detectSyncFsAdvisory). Only
  // meaningful inside a repo — outside one, git sync cannot be enabled
  // at all, so there is nothing to warn about.
  const fstypeAdvisory = gitRepo ? detectSyncFsAdvisory(root, probe) : undefined;

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
        `Branch '${branch}' already exists and holds content this tracker did not write `
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
      // GIT-22: the panel warns *before* enabling, so this is present on
      // the disabled path too when the tracker is on a hazardous fs.
      ...(fstypeAdvisory !== undefined ? { fstypeAdvisory } : {}),
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
      ...(fstypeAdvisory !== undefined ? { fstypeAdvisory } : {}),
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
