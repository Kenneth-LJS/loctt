import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir,rm } from "node:fs/promises";
import { dirname,join } from "node:path";

import type { SyncState } from "@loctt/contracts";

import { getLocalDir } from "../paths/index.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";
import type { SyncPlan } from "./three-way.js";
import { LOCAL_OWNED,NEVER_MIRROR, planSync } from "./three-way.js";

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

/**
 * Raised when local and branch state both changed the same file since the
 * last sync. Carries the offending paths so callers can name them.
 */
export class GitConflictError extends GitSyncError {
  readonly paths: readonly string[];
  constructor(paths: readonly string[]) {
    const list = paths.slice(0, 10).map(p => `  - ${p}`).join("\n");
    const more = paths.length > 10 ? `\n  …and ${paths.length - 10} more` : "";
    super(
      `sync aborted: ${paths.length} file(s) changed both locally and on the branch since the last sync:\n${list}${more}\n\n` +
        "Nothing was written — your local files are untouched. Resolve by making one side match the other " +
        "(edit locally, or check out the branch and edit there), then re-run 'loctt git sync'.",
    );
    this.name = "GitConflictError";
    this.paths = paths;
  }
}

/**
 * Applies a {@link SyncPlan} to the local workspace.
 *
 * Only paths the plan explicitly marks `copy` or `delete` are touched;
 * everything else is left exactly as it was. This is the safety property
 * the old blind mirror lacked.
 */
async function applyPlan(
  plan: SyncPlan,
  incomingDir: string,
  localDir: string,
): Promise<void> {
  for (const { path } of plan.deletes) {
    await rm(join(localDir, path), { recursive: true, force: true });
  }
  for (const { path } of plan.copies) {
    const dest = join(localDir, path);
    await mkdir(dirname(dest), { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await cp(join(incomingDir, path), dest, { recursive: true, force: true });
  }
  // Deleting files can strand their directories. A task whose files are all
  // gone must leave no directory behind, or it still shows up in listings
  // (and reads as a corrupt task rather than an absent one).
  await pruneEmptyDirs(plan.deletes.map(d => d.path), localDir);
}

/**
 * Removes directories left empty by deletions, walking upward from each
 * deleted path. Stops at `rootDir` and at the first non-empty parent.
 */
async function pruneEmptyDirs(
  deletedPaths: readonly string[],
  rootDir: string,
): Promise<void> {
  const candidates = new Set<string>();
  for (const p of deletedPaths) {
    let dir = dirname(p);
    while (dir && dir !== "." && dir !== "/") {
      candidates.add(dir);
      dir = dirname(dir);
    }
  }
  // Deepest first, so a parent is only considered after its children.
  const ordered = [...candidates].sort((a, b) => b.split("/").length - a.split("/").length);
  for (const rel of ordered) {
    const abs = join(rootDir, rel);
    const entries = await readdir(abs).catch(() => undefined);
    if (entries !== undefined && entries.length === 0) {
      await rm(abs, { recursive: true, force: true });
    }
  }
}

/**
 * True when `branch` holds content that did not come from a LocTT publish.
 *
 * A publish mirrors `.loctt/` to the branch root, so a LocTT-owned branch
 * has a recognisable shape. Adopting an unrelated branch would delete
 * whatever was there, so callers refuse rather than guess.
 */
function branchHasForeignContent(root: string, branch: string): string[] {
  const listed = gitSafe(["ls-tree", "--name-only", branch], root);
  if (!listed) return [];
  const entries = listed.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (entries.length === 0) return [];
  const locttShaped = new Set([
    "config", "tasks", "users", "state.yaml", "docs",
    ".gitignore", ".schema-version",
  ]);
  return entries.filter(e => !locttShaped.has(e));
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
 * What a sync actually did. The counts let callers report the change
 * rather than a bare "Synced" — a success message that names nothing is
 * indistinguishable from a sync that quietly destroyed work.
 */
export interface SyncOutcome {
  readonly updated: boolean;
  /** Files taken from the branch. */
  readonly copied?: number;
  /** Files removed locally because the branch deleted them. */
  readonly deleted?: number;
  /** Files left alone (identical, local-only, or locally-owned). */
  readonly kept?: number;
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

  // Adopting a branch that already holds unrelated content would delete it:
  // the mirror below removes every branch entry not present in .loctt/.
  // Only refuse on first publish — once we have published, the branch is ours.
  if (syncState.git.last_synced_commit === undefined && branchExists(root, branch)) {
    const foreign = branchHasForeignContent(root, branch);
    if (foreign.length > 0) {
      throw new GitSyncError(
        `refusing to publish: branch '${branch}' already exists and holds content LocTT did not write ` +
          `(${foreign.slice(0, 5).join(", ")}${foreign.length > 5 ? ", …" : ""}). ` +
          `Publishing would delete it. Choose a different branch with ` +
          `'loctt config set git.branch <name>', or delete '${branch}' if it is no longer needed.`,
      );
    }
  }

  ensureBranch(root, branch);

  const worktreeDir = join(getLocalDir(locttDir), ".worktree-publish");
  await rm(worktreeDir, { recursive: true, force: true });

  try {
    git(["worktree", "add", worktreeDir, branch], root);

    // Publish is intentionally a one-way mirror: local is canonical for the
    // branch. Local-owned files are withheld so they never reach the branch
    // and so cannot be mirrored back onto another clone (see LOCAL_OWNED).
    await mirrorDir(locttDir, worktreeDir, new Set([...NEVER_MIRROR, ...LOCAL_OWNED]));

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
  return {
    committed: commitResult.committed,
    pushed: false,
    ...(pushResult.error !== undefined ? { pushError: pushResult.error } : {}),
  };
}

/**
 * Mirrors the loctt branch state into the local .loctt workspace.
 */
export async function pullFromLocttBranch(
  locttDir: string,
  root: string,
  preloadedState?: SyncState,
): Promise<SyncOutcome> {
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

    // 3-way, not a blind mirror. `last_synced_commit` is the base: without
    // it we cannot tell "the branch deleted this" from "I created this
    // locally", so planSync keeps anything it cannot prove is a deletion.
    const plan = await planSync({
      root,
      incomingDir: worktreeDir,
      localDir: locttDir,
      baseCommit: syncState.git.last_synced_commit,
    });

    if (plan.conflicts.length > 0) {
      // Abort before writing anything — a partially-applied sync is worse
      // than none, and the user still has both versions intact.
      throw new GitConflictError(plan.conflicts.map(c => c.path));
    }

    await applyPlan(plan, worktreeDir, locttDir);

    const updated: SyncState = {
      git: {
        ...syncState.git,
        last_synced_commit: remoteHead,
      },
    };
    await saveSyncState(locttDir, updated);

    return {
      updated: plan.copies.length > 0 || plan.deletes.length > 0,
      copied: plan.copies.length,
      deleted: plan.deletes.length,
      kept: plan.keeps.length,
    };
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
): Promise<SyncOutcome & { fetched?: boolean; fetchError?: string }> {
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
  return {
    ...result,
    ...(fetched !== undefined ? { fetched } : {}),
    ...(fetchError ? { fetchError } : {}),
  };
}
