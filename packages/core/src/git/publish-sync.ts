import { spawnSync } from "node:child_process";
import { cp, readdir,rm } from "node:fs/promises";
import { join } from "node:path";

import type { SyncState } from "@loctt/contracts";

import { getLocalDir } from "../paths/index.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";

async function mirrorDir(
  srcDir: string,
  destDir: string,
  exclude: ReadonlySet<string>,
): Promise<void> {
  const srcEntries = new Set(await readdir(srcDir));
  const destEntries = await readdir(destDir).catch(() => [] as string[]);
  for (const entry of destEntries) {
    if (exclude.has(entry)) continue;
    if (!srcEntries.has(entry)) {
      await rm(join(destDir, entry), { recursive: true, force: true });
    }
  }

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
    const emptyTree = git(["hash-object", "-t", "tree", "/dev/null"], root);
    const commit = git(
      ["commit-tree", emptyTree, "-m", "Initialize loctt branch"],
      root,
    );
    git(["update-ref", `refs/heads/${branch}`, commit], root);
  }
}

function remoteExists(root: string, remote: string): boolean {
  const out = gitSafe(["remote"], root);
  if (!out) return false;
  return out.split(/\r?\n/).map(s => s.trim()).includes(remote);
}

export interface PushResult {
  readonly pushed: boolean;
  readonly skipped?: "no-remote" | "disabled" | "no-remote-configured";
  readonly error?: string;
}

export interface FetchResult {
  readonly fetched: boolean;
  readonly skipped?: "no-remote" | "disabled" | "no-remote-configured";
  readonly error?: string;
}

/**
 * Maps git stderr patterns to friendlier auth-error messages.
 * Returns `undefined` when the stderr doesn't match a known auth pattern,
 * letting callers fall through to the raw stderr tail.
 *
 * Exported for direct testing; not re-exported from the package's top-level
 * index — treat as internal-flavored.
 */
export function classifyAuthError(stderr: string): string | undefined {
  if (/Permission denied \(publickey\)/i.test(stderr)) {
    return "SSH key not accepted by remote (publickey)";
  }
  if (/could not read Username/i.test(stderr)) {
    return "no credentials available (interactive prompts disabled)";
  }
  if (/Authentication failed/i.test(stderr)) {
    return "authentication failed";
  }
  return undefined;
}

/**
 * Commits the current .loctt state to the configured loctt branch (filesystem only).
 * No remote interaction. Returns whether a commit was created.
 */
export async function commitToLocttBranch(
  locttDir: string,
  root: string,
): Promise<{ committed: boolean; commit?: string; branch: string; syncState: SyncState }> {
  const syncState = await loadSyncState(locttDir);
  if (!syncState.git.enabled) {
    throw new GitSyncError("Git-backed mode is not enabled");
  }

  const branch = syncState.git.branch;
  ensureBranch(root, branch);

  const worktreeDir = join(getLocalDir(locttDir), ".worktree-publish");
  await rm(worktreeDir, { recursive: true, force: true });

  try {
    git(["worktree", "add", worktreeDir, branch], root);

    await mirrorDir(locttDir, worktreeDir, new Set(["local", ".git"]));

    git(["add", "-A"], worktreeDir);

    const status = git(["status", "--porcelain"], worktreeDir);
    if (!status) {
      return { committed: false, branch, syncState };
    }

    git(["commit", "-m", "loctt publish"], worktreeDir);
    const commitHash = git(["rev-parse", "HEAD"], worktreeDir);

    const updated: SyncState = {
      git: {
        ...syncState.git,
        last_synced_commit: commitHash,
      },
    };
    await saveSyncState(locttDir, updated);

    return { committed: true, commit: commitHash, branch, syncState: updated };
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
 * Pushes the loctt branch to the configured remote.
 * Never throws — returns a result describing what happened.
 */
export function pushLocttBranch(
  root: string,
  opts: { remote: string; branch: string },
): PushResult {
  const { remote, branch } = opts;
  if (!remoteExists(root, remote)) {
    return { pushed: false, skipped: "no-remote" };
  }
  const result = spawnSync(
    "git",
    ["push", remote, `${branch}:${branch}`],
    {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  if (result.status === 0) {
    return { pushed: true };
  }
  const stderr = (result.stderr ?? "").toString();
  const auth = classifyAuthError(stderr);
  const reason = auth ?? (stderr.trim().split(/\r?\n/).pop() ?? "git push failed");
  return { pushed: false, error: reason };
}

/**
 * Fetches the loctt branch from the configured remote into the local branch ref.
 */
export function fetchLocttBranch(
  root: string,
  opts: { remote: string; branch: string },
): FetchResult {
  const { remote, branch } = opts;
  if (!remoteExists(root, remote)) {
    return { fetched: false, skipped: "no-remote" };
  }
  const result = spawnSync(
    "git",
    ["fetch", remote, `${branch}:${branch}`],
    {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  if (result.status === 0) {
    return { fetched: true };
  }
  const stderr = (result.stderr ?? "").toString();
  const auth = classifyAuthError(stderr);
  const reason = auth ?? (stderr.trim().split(/\r?\n/).pop() ?? "git fetch failed");
  return { fetched: false, error: reason };
}

/**
 * Publishes local .loctt state to the canonical loctt branch, then optionally
 * pushes to the configured remote. Local commit is durable even if the push fails.
 */
export async function publish(
  locttDir: string,
  root: string,
): Promise<{ committed: boolean; pushed?: boolean; pushError?: string }> {
  const commitResult = await commitToLocttBranch(locttDir, root);
  const syncState = commitResult.syncState;

  if (!syncState.git.auto_push) {
    return { committed: commitResult.committed };
  }
  if (!syncState.git.remote) {
    return { committed: commitResult.committed };
  }
  if (!remoteExists(root, syncState.git.remote)) {
    return { committed: commitResult.committed };
  }

  const pushResult = pushLocttBranch(root, {
    remote: syncState.git.remote,
    branch: syncState.git.branch,
  });

  if (pushResult.pushed) {
    return { committed: commitResult.committed, pushed: true };
  }

  if (pushResult.error) {
    const remote = syncState.git.remote;
    const branch = syncState.git.branch;
    process.stderr.write(
      `warning: push to ${remote} failed: ${pushResult.error}. local commit succeeded; run 'git push ${remote} ${branch}' to retry.\n`,
    );
  }
  return { committed: commitResult.committed, pushed: false, pushError: pushResult.error };
}

/**
 * Mirrors the loctt branch state into the local .loctt workspace.
 */
export async function pullFromLocttBranch(
  locttDir: string,
  root: string,
  preloadedState?: SyncState,
): Promise<{ updated: boolean }> {
  const syncState = preloadedState ?? await loadSyncState(locttDir);
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

  const worktreeDir = join(getLocalDir(locttDir), ".worktree-sync");
  await rm(worktreeDir, { recursive: true, force: true });

  try {
    git(["worktree", "add", worktreeDir, branch], root);

    await mirrorDir(worktreeDir, locttDir, new Set(["local", ".git"]));

    const updated: SyncState = {
      git: {
        ...syncState.git,
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

/**
 * Syncs canonical loctt branch state into the local workspace.
 * Optionally fetches from remote first.
 */
export async function sync(
  locttDir: string,
  root: string,
): Promise<{ updated: boolean; fetched?: boolean; fetchError?: string }> {
  const syncState = await loadSyncState(locttDir);
  if (!syncState.git.enabled) {
    throw new GitSyncError("Git-backed mode is not enabled");
  }

  let fetched: boolean | undefined;
  let fetchError: string | undefined;

  if (syncState.git.auto_fetch && syncState.git.remote && remoteExists(root, syncState.git.remote)) {
    const r = fetchLocttBranch(root, {
      remote: syncState.git.remote,
      branch: syncState.git.branch,
    });
    if (r.fetched) {
      fetched = true;
    } else if (r.error) {
      fetched = false;
      fetchError = r.error;
      const remote = syncState.git.remote;
      const branch = syncState.git.branch;
      process.stderr.write(
        `warning: fetch from ${remote} failed: ${r.error}. continuing with local branch state; run 'git fetch ${remote} ${branch}' to retry.\n`,
      );
    }
  }

  const result = await pullFromLocttBranch(locttDir, root, syncState);
  return { updated: result.updated, ...(fetched !== undefined ? { fetched } : {}), ...(fetchError ? { fetchError } : {}) };
}
