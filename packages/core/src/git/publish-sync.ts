import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ReconcileState, SyncState, Task } from "@loctt/contracts";

import { loadProjectsConfig } from "../config/projects.js";
import type { IntegrityFinding } from "../diagnostics/integrity.js";
import { blockingFindings, checkDataIntegrity } from "../diagnostics/integrity.js";
import { getLocalDir } from "../paths/index.js";
import { rebuildKeyIndex } from "../state/key-index.js";
import { appendKeyHistory } from "../state/keys.js";
import { clearReconcileState, readReconcileState, saveReconcileState } from "../state/reconcile.js";
import { loadState, saveState } from "../state/state.js";
import { loadSyncState, saveSyncState } from "../state/sync.js";
import { parseFrontmatter, splitTaskFile } from "../task/frontmatter.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";
import { rekeyCollisions } from "./reconcile.js";
import type { ResolveResult } from "./resolve-conflicts.js";
import { applyResolution, resolveConflicts } from "./resolve-conflicts.js";
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
 * Raised when a previous reconciliation left its sentinel behind — it
 * started writing and never finished.
 *
 * Unlike a prefix rename, this is not auto-resumable: the interrupted run
 * applied an unknown subset of a plan computed against a base commit
 * whose diff no longer describes the workspace. Finishing it blind could
 * overwrite local edits, so the message states what was in flight and
 * gives the user the two commands that can resolve it — re-sync after
 * checking the workspace, or clear the sentinel to abort.
 */
export class GitReconcileInterruptedError extends GitSyncError {
  readonly state: ReconcileState;
  constructor(state: ReconcileState) {
    super(
      `a previous '${state.mode}' reconciliation was interrupted `
      + `(started ${state.started_at}, syncing ${state.base_commit.slice(0, 8)} `
      + `→ ${state.remote_commit.slice(0, 8)}).\n\n`
      + "Your workspace may hold a partly-applied sync. Compare it against "
      + "the branch and make it whole, then delete "
      + ".loctt/local/reconcile.yaml to clear this record — the next "
      + "'loctt git sync' will re-plan from scratch. Sync will not run "
      + "while the record is present, because the commit it would plan "
      + "against no longer describes your files.",
    );
    this.name = "GitReconcileInterruptedError";
    this.state = state;
  }
}

/**
 * Applies a {@link SyncPlan} to the local workspace.
 *
 * Only paths the plan explicitly marks `copy` or `delete` are touched;
 * everything else is left exactly as it was. This is the safety property
 * the old blind mirror lacked.
 */
/**
 * The tasks as they will exist once this sync lands: local tasks, with
 * merged versions substituted and incoming-only tasks added.
 *
 * Built from the plan rather than by re-reading the tree after writing,
 * because nothing has been written yet — the counters have to be
 * derivable *before* anything lands, so an abort leaves no trace.
 */
async function mergedTaskSet(
  plan: SyncPlan,
  firstPass: ResolveResult,
  incomingDir: string,
  localDir: string,
): Promise<Task[]> {
  const byPath = new Map<string, Task>();

  const readAt = async (dir: string, rel: string): Promise<Task | undefined> => {
    try {
      const raw = await readFile(join(dir, rel), "utf-8");
      const { rawYaml, body } = splitTaskFile(raw);
      return { frontmatter: parseFrontmatter(rawYaml), body };
    } catch {
      return undefined;
    }
  };

  // Everything local, as the baseline.
  for (const rel of await listTaskFiles(localDir)) {
    const t = await readAt(localDir, rel);
    if (t) byPath.set(rel, t);
  }
  // Tasks the branch is bringing in.
  for (const p of plan.copies) {
    if (!/^tasks\/[^/]+\/task\.md$/.test(p.path)) continue;
    const t = await readAt(incomingDir, p.path);
    if (t) byPath.set(p.path, t);
  }
  // Merged versions win over both.
  for (const m of firstPass.merged) {
    if (!/^tasks\/[^/]+\/task\.md$/.test(m.path)) continue;
    const { rawYaml, body } = splitTaskFile(m.content);
    byPath.set(m.path, { frontmatter: parseFrontmatter(rawYaml), body });
  }
  // Tasks the branch deleted are not part of the result.
  for (const d of plan.deletes) byPath.delete(d.path);

  return [...byPath.values()];
}

/** Relative paths of every `tasks/<id>/task.md` under a tracker dir. */
async function listTaskFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(join(dir, "tasks"));
  } catch {
    return out;
  }
  for (const id of entries) out.push(`tasks/${id}/task.md`);
  return out;
}

/**
 * Restores the two invariants a merge can break: one prefix per
 * project, one key per task.
 *
 * Ordered deliberately. Prefixes are fixed first, because rekeying a
 * task allocates from its project's prefix — doing it the other way
 * round hands out keys from a prefix that is about to change. Both
 * passes are derived from what is on disk, so two clones running this
 * on the same merged tree reach the same answer.
 */
async function normaliseAfterMerge(
  locttDir: string,
): Promise<{ rekeyed: number; reprefixed: number; unresolvedKeys: readonly string[] }> {
  // projects.yaml already carries unique prefixes — the resolver assigns
  // provisional ones before writing, because the schema rejects a
  // duplicate on read and an invalid file cannot be loaded to fix.
  // What is left is the tasks, whose keys still carry the *old* prefix.
  const config = await loadProjectsConfig(locttDir);
  const state = await loadState(locttDir);
  const tasks = await loadAllTasks(locttDir);

  let rekeyed = 0;
  let reprefixed = 0;

  for (const p of config.projects) {
    // A task whose key does not start with its project's prefix is one
    // the resolver re-prefixed underneath it.
    const stale = tasks.filter(
      t => t.frontmatter.project === p.id && !t.frontmatter.key.startsWith(p.prefix),
    );
    if (stale.length === 0) continue;
    reprefixed += 1;

    for (const t of stale) {
      // Keep the number, replace the prefix — the same rule set-prefix
      // follows, so a reference like "the third one" survives.
      const suffix = /(\d+)$/.exec(t.frontmatter.key)?.[1] ?? "";
      if (suffix === "") continue;
      await writeTask(locttDir, t.frontmatter.id, {
        ...t,
        frontmatter: {
          ...t.frontmatter,
          key: `${p.prefix}${suffix}`,
          key_history: [...appendKeyHistory(t.frontmatter.key_history, t.frontmatter.key)],
        },
      });
      rekeyed += 1;
    }

    const entry = state.keys[p.id];
    if (entry) {
      state.keys[p.id] = { prefix: p.prefix, next_number: entry.next_number };
    }
  }

  // Any key collisions left (two tasks in the *same* project sharing a
  // key) are the rekey pass's job.
  const after = await loadAllTasks(locttDir);
  const outcome = rekeyCollisions(after, state);
  for (const r of outcome.rekeyed) {
    const t = after.find(x => x.frontmatter.id === r.taskId);
    if (!t) continue;
    await writeTask(locttDir, r.taskId, {
      ...t,
      frontmatter: { ...t.frontmatter, key: r.newKey, key_history: [...r.keyHistory] },
    });
    rekeyed += 1;
  }

  // A skipped collision leaves two tasks sharing a key — the exact state
  // this pass exists to remove. RekeyOutcome's contract says a skip is
  // "never silently dropped", and the only caller was dropping it, so a
  // duplicate key looked like a successful merge.
  if (outcome.skipped.length > 0) {
    const detail = outcome.skipped
      .map(s => `${s.key} (${s.taskId}): ${s.reason}`)
      .join("; ");
    process.stderr.write(
      `warning: ${String(outcome.skipped.length)} key collision(s) could not be resolved `
      + `— ${detail}. Run 'loctt doctor' for detail.\n`,
    );
  }

  await saveState(locttDir, state);
  await rebuildKeyIndex(locttDir);

  return { rekeyed, reprefixed, unresolvedKeys: outcome.skipped.map(s => s.key) };
}

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
 * deleted path. Stops at the first non-empty parent, and never removes
 * a structural directory.
 *
 * `KEEP` is the floor the docstring always claimed and the code never
 * had: syncing away the last task would otherwise delete
 * `.loctt/tasks/` itself, leaving a tracker whose shape no longer
 * matches what `init` creates. An empty `tasks/` is a tracker with no
 * tasks; a missing one is a tracker that looks broken.
 */
const PRUNE_FLOOR: ReadonlySet<string> = new Set([
  "tasks", "config", "users", "docs", "local",
]);

async function pruneEmptyDirs(
  deletedPaths: readonly string[],
  rootDir: string,
): Promise<void> {
  const candidates = new Set<string>();
  for (const p of deletedPaths) {
    let dir = dirname(p);
    while (dir && dir !== "." && dir !== "/") {
      // Stop *at* the floor rather than adding it: its own parent is
      // the .loctt root, which must never be a candidate either.
      if (PRUNE_FLOOR.has(dir)) break;
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
export function branchHasForeignContent(root: string, branch: string): string[] {
  const { ok, stdout: listed } = gitStatusSafe(["ls-tree", "--name-only", branch], root);
  // A failed listing is not an empty branch. Returning [] here would
  // report "safe to adopt" for a branch we could not read, and the
  // caller's next move is to mirror over it.
  if (!ok) {
    throw new GitSyncError(
      `could not read branch '${branch}' to check for existing content. `
      + `Refusing to continue: publishing would mirror over whatever is `
      + `there. Check that the branch exists and the repository is readable.`,
    );
  }
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

/**
 * Runs git and returns stdout, or `""` when the command fails.
 *
 * Callers must treat `""` as "no answer", never as a meaningful empty
 * result. That distinction matters most in `branchHasForeignContent`,
 * where an empty listing means "the branch is safe to adopt" — a
 * transient `ls-tree` failure read as exactly that would disable the
 * guard which stops a publish deleting someone else's branch. That
 * caller now checks the status itself via `gitStatusSafe`.
 */
function gitSafe(args: string[], cwd: string): string {
  return gitStatusSafe(args, cwd).stdout;
}

/**
 * As {@link gitSafe}, but reports whether git actually succeeded, so a
 * caller can tell "empty output" from "the command failed".
 */
function gitStatusSafe(
  args: string[],
  cwd: string,
): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  return { ok: result.status === 0, stdout: result.stdout?.trim() ?? "" };
}

/**
 * Counts files under `.loctt/` whose content differs from what is on
 * `branch` — the work a publish would send.
 *
 * Compares blob hashes directly rather than going through git's index.
 * The index route looks tidier but is wrong here: a publish mirrors
 * `.loctt/` to the *branch root*, so the branch's paths are not the
 * working tree's paths, and every index-based comparison either reports
 * the whole tree as changed or silently ignores files git does not
 * track. Hashing both sides sidesteps the path mismatch entirely.
 *
 * Counts modified, added, and removed paths alike — all three are work a
 * publish would carry. Returns `undefined` when the comparison cannot be
 * made (no such branch, git unavailable), which callers must keep
 * distinct from zero.
 */
export function countLocalChanges(
  root: string,
  locttDir: string,
  branch: string,
): number | undefined {
  if (!branchExists(root, branch)) return undefined;

  const listed = gitSafe(["ls-tree", "-r", "--format=%(objectname) %(path)", branch], root);
  if (!listed) return undefined;

  const onBranch = new Map<string, string>();
  for (const line of listed.split(/\r?\n/)) {
    const sep = line.indexOf(" ");
    if (sep > 0) onBranch.set(line.slice(sep + 1), line.slice(0, sep));
  }

  let changed = 0;
  const seen = new Set<string>();
  for (const relative of listLocalPublishablePaths(locttDir)) {
    seen.add(relative);
    const local = gitSafe(["hash-object", join(locttDir, relative)], root);
    const remote = onBranch.get(relative);
    // Absent on the branch counts as changed: it is a file a publish
    // would add.
    if (local === "" || remote === undefined || local !== remote) changed += 1;
  }
  // Paths the branch has and the workspace no longer does — a publish
  // would delete them, which is just as much a pending change.
  for (const relative of onBranch.keys()) {
    if (!seen.has(relative)) changed += 1;
  }
  return changed;
}

/**
 * Lists `.loctt/` paths a publish would mirror, relative to `.loctt/`.
 *
 * Three things are excluded, and each would otherwise show as drift that
 * no publish could ever clear:
 *  - `NEVER_MIRROR` / `LOCAL_OWNED`, the same sets `mirrorDir` uses, so
 *    this cannot disagree with what publish actually copies;
 *  - anything `.loctt/.gitignore` excludes (`.current-user`, per-user
 *    settings), because publish stages with `git add -A` and git drops
 *    them. Asked of git rather than hardcoded — the ignore file ships in
 *    `.loctt/` and a user may extend it.
 */
function listLocalPublishablePaths(locttDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (prefix === "" && (NEVER_MIRROR.has(entry.name) || LOCAL_OWNED.has(entry.name))) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        out.push(relative);
      }
    }
  };
  walk(locttDir, "");
  if (out.length === 0) return out;

  // `check-ignore` exits 1 when nothing matched, which is not an error.
  const checked = spawnSync(
    "git",
    ["-C", locttDir, "check-ignore", "--no-index", "--stdin"],
    { input: out.join("\n"), encoding: "utf-8", stdio: "pipe" },
  );
  const ignored = new Set(
    (checked.stdout ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean),
  );
  return ignored.size === 0 ? out : out.filter(p => !ignored.has(p));
}

/**
 * The commit `branch` points at, or `undefined` if it does not resolve.
 */
export function branchHeadCommit(root: string, branch: string): string | undefined {
  const head = gitSafe(["rev-parse", branch], root);
  return head === "" ? undefined : head;
}

export function branchExists(root: string, branch: string): boolean {
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

/**
 * Whether `remote` is actually configured in this repository.
 *
 * Exported for status (GIT-C6): the remote *name* always has a value
 * because it defaults to `origin`, so "has a name" and "has a remote"
 * are different questions and only the second one predicts whether a
 * push can work.
 */
export function remoteExists(root: string, remote: string): boolean {
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
  /**
   * The branch that was synced. Present so callers can name it rather
   * than printing the literal "loctt": the branch is user-configurable,
   * and every message said "loctt branch" regardless of what it actually
   * was (GIT-C10). Absent on the early returns that never reached a
   * branch.
   */
  readonly branch?: string;
  /** Files taken from the branch. */
  readonly copied?: number;
  /** Files removed locally because the branch deleted them. */
  readonly deleted?: number;
  /** Files left alone (identical, local-only, or locally-owned). */
  readonly kept?: number;
  /**
   * Files both sides changed that were merged field-by-field rather
   * than aborted on (decisions M1-M4).
   */
  readonly merged?: number;
  /** Tasks renumbered because the merge left them sharing a key. */
  readonly rekeyed?: number;
  /**
   * Projects given a provisional prefix because the merge left two
   * claiming the same one. The user is expected to replace these with
   * `loctt project set-prefix`.
   */
  readonly reprefixed?: number;
  /**
   * Keys the rekey pass could not resolve, so two tasks still share
   * them. Present only when non-empty.
   *
   * Reported rather than dropped because a duplicate key makes
   * `loctt show <key>` ambiguous, and a sync that says "merged" while
   * leaving one behind has told the user it succeeded when it half did.
   */
  readonly unresolvedKeys?: readonly string[];
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
  // `rm` clears the directory; it does not clear git's registration in
  // .git/worktrees. A hard kill (SIGKILL, power loss) skips the finally
  // block that would have removed it, leaving a worktree git still
  // believes exists — and the next `add` then dies with "missing but
  // already registered worktree", which names a path the user has never
  // seen. Prune is a no-op when nothing is stale.
  //
  // invariants.md: a crash leaves either something the tracker finishes
  // or something it refuses to boot on, never something it ignores.
  gitSafe(["worktree", "prune"], root);

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
/**
 * Pulls the meaningful lines out of a git failure.
 *
 * Prefers the `fatal:`/`error:` lines, which is where git states the
 * cause; falls back to the full text. Never a single arbitrary line —
 * that is how "and the repository exists." became a user-facing reason.
 */
function extractGitFailure(stderr: string): string {
  const text = stderr.trim();
  if (text === "") return "git push failed";
  const named = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^(fatal|error|remote):/i.test(l));
  return named.length > 0 ? named.join("; ") : text.replace(/\s*\n\s*/g, " ");
}

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
  // Git's failures are multi-line and the *last* line is often the tail
  // of a sentence: "repository not found" ends with "and the repository
  // exists.", which on its own explains nothing. Keep the lines that
  // carry the cause — git prefixes those with "fatal:" or "error:" —
  // and fall back to the whole thing rather than a fragment of it.
  const reason = auth ?? extractGitFailure(stderr);
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
 * Raised when pre-flight finds data a publish must not carry.
 *
 * Only unreadable files block. A malformed *entry* is kept and merged
 * (P-11), so the data is intact and publishing it is safe — blocking on
 * one would make a hand-edit typo render the tracker unpublishable,
 * which is destruction by another route.
 */
export class PreflightError extends Error {
  readonly name = "PreflightError" as const;
  readonly findings: ReadonlyArray<IntegrityFinding>;

  constructor(findings: ReadonlyArray<IntegrityFinding>) {
    super(
      `pre-flight found ${String(findings.length)} problem(s) that must be fixed before publishing:\n`
      + findings.map(f => `  ${f.path}: ${f.message}`).join("\n"),
    );
    this.findings = findings;
  }
}

export interface PreflightReport {
  /** Everything found, blocking or not. */
  readonly findings: ReadonlyArray<IntegrityFinding>;
  /** True when a real publish would be refused. */
  readonly wouldBlock: boolean;
}

/**
 * Runs the checks a publish depends on, without publishing (V4).
 *
 * The same function backs `--dry-run` and the real thing, so the two
 * cannot drift: a dry run that passes and a publish that then refuses
 * would make the dry run worse than useless.
 */
export async function preflight(locttDir: string): Promise<PreflightReport> {
  const findings = await checkDataIntegrity(locttDir);
  return { findings, wouldBlock: blockingFindings(findings).length > 0 };
}

/**
 * Publishes local .loctt state to the canonical loctt branch, then optionally
 * pushes to the configured remote. Local commit is durable even if the push fails.
 *
 * Refuses up front on anything pre-flight considers blocking (V4). A
 * file we could not read must not be mirrored to a branch other
 * machines will sync from — that turns one machine's damage into
 * everyone's.
 */
export async function publish(
  locttDir: string,
  root: string,
): Promise<{ committed: boolean; branch: string; pushed?: boolean; pushError?: string }> {
  const report = await preflight(locttDir);
  if (report.wouldBlock) {
    throw new PreflightError(blockingFindings(report.findings));
  }
  const commitResult = await commitToLocttBranch(locttDir, root);
  const syncState = commitResult.syncState;
  // Returned on every path so callers can name the branch they actually
  // wrote to. It is user-configurable, and every success message printed
  // the literal "loctt" regardless (GIT-C10).
  const branch = commitResult.branch;

  if (!syncState.git.auto_push) {
    return { committed: commitResult.committed, branch };
  }
  if (!syncState.git.remote) {
    return { committed: commitResult.committed, branch };
  }
  if (!remoteExists(root, syncState.git.remote)) {
    return { committed: commitResult.committed, branch };
  }

  const pushResult = pushLocttBranch(root, {
    remote: syncState.git.remote,
    branch: syncState.git.branch,
  });

  if (pushResult.pushed) {
    return { committed: commitResult.committed, branch, pushed: true };
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
    branch,
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

  // A sentinel here means the previous reconciliation died between its
  // first write and its last. The workspace is in neither the old state
  // nor the new one, so the base commit this run would plan against is a
  // lie — proceeding would compute a diff from a state that no longer
  // exists on disk. Name it and stop (GIT-C3).
  const interrupted = await readReconcileState(locttDir);
  if (interrupted) {
    throw new GitReconcileInterruptedError(interrupted);
  }

  const branch = syncState.git.branch;
  if (!branchExists(root, branch)) {
    return { updated: false, branch };
  }

  const remoteHead = git(["rev-parse", branch], root);
  if (syncState.git.last_synced_commit === remoteHead) {
    return { updated: false, branch };
  }

  const worktreeDir = join(getLocalDir(locttDir), ".worktree-sync");
  await rm(worktreeDir, { recursive: true, force: true });
  // `rm` clears the directory; it does not clear git's registration in
  // .git/worktrees. A hard kill (SIGKILL, power loss) skips the finally
  // block that would have removed it, leaving a worktree git still
  // believes exists — and the next `add` then dies with "missing but
  // already registered worktree", which names a path the user has never
  // seen. Prune is a no-op when nothing is stale.
  //
  // invariants.md: a crash leaves either something the tracker finishes
  // or something it refuses to boot on, never something it ignores.
  gitSafe(["worktree", "prune"], root);

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

    // Field-level merge (decisions M1-M4). A path both sides changed is
    // no longer fatal by itself: task frontmatter merges per field,
    // history and comments union, and config lists union by id. Only
    // paths with no rule — or one side that will not parse — still
    // abort.
    // Two passes. The first merges everything except state.yaml; the
    // second derives the counters from the task set that results (M1),
    // which cannot be known until the tasks themselves have merged.
    const firstPass = await resolveConflicts(plan.conflicts, worktreeDir, locttDir);
    const resolution = firstPass.unresolved.some(c => c.path === "state.yaml")
      ? await resolveConflicts(
        plan.conflicts,
        worktreeDir,
        locttDir,
        await mergedTaskSet(plan, firstPass, worktreeDir, locttDir),
      )
      : firstPass;
    if (resolution.unresolved.length > 0) {
      // Abort before writing anything — a partially-applied sync is worse
      // than none, and the user still has both versions intact.
      throw new GitConflictError(resolution.unresolved.map(c => c.path));
    }

    // Everything above this line is read-only: planning, merging in
    // memory, and aborting on an unresolvable conflict. Everything below
    // writes to the workspace, across many files, with no single atomic
    // point. A crash in that window used to leave a partly-applied sync
    // with nothing on disk to say so — the next run would compute a
    // fresh plan against a workspace that was neither the old state nor
    // the new one (GIT-C3).
    //
    // The sentinel records what was in flight and against which commits,
    // so the next sync can name the interrupted operation instead of
    // starting over blindly. Written before the first mutation and
    // cleared after the last one.
    //
    // Sync only. `mode: "publish"` exists in the schema but publish does
    // not write one: it stages into a temporary worktree and commits
    // there, so an interrupted publish leaves the user's .loctt/
    // untouched — either the branch moved or it did not, and the next
    // publish re-derives everything. There is no half-applied workspace
    // to warn about, and a sentinel that blocked sync for a failed
    // publish would be a refusal with nothing behind it.
    await saveReconcileState(locttDir, {
      mode: "sync",
      base_commit: syncState.git.last_synced_commit ?? remoteHead,
      remote_commit: remoteHead,
      started_at: new Date().toISOString(),
    });

    await applyPlan(plan, worktreeDir, locttDir);
    // After applyPlan: the merged content must win over whatever the
    // plan copied for that path.
    await applyResolution(resolution, locttDir);

    // NORMALISE. Merging can leave two projects sharing a prefix (two
    // independently-init'ed trackers both mint `T-`), and tasks sharing
    // a key. Neither is a state the rest of the codebase tolerates:
    // `createProject` enforces prefix uniqueness, and a duplicate key
    // makes `loctt show T-1` ambiguous.
    //
    // Runs after a merge *or a copy*. The earlier comment said "a merge
    // is the only way to reach either state", which is wrong for the
    // case GIT-C2 names: two clones each creating a task offline. The
    // task exists on only one side, so it is copied rather than merged —
    // and a copied task can collide on a key just as a merged one can.
    const normalised = resolution.merged.length > 0 || plan.copies.length > 0
      ? await normaliseAfterMerge(locttDir)
      : { rekeyed: 0, reprefixed: 0, unresolvedKeys: [] as readonly string[] };

    // The key index maps key -> task id and is local, so it is never
    // synced. Any sync that added or rewrote a task file leaves it
    // stale — including one that only *copied* tasks, which never
    // reaches normaliseAfterMerge. Rebuilding here rather than there
    // covers both paths.
    if (plan.copies.length > 0 || plan.deletes.length > 0 || resolution.merged.length > 0) {
      await rebuildKeyIndex(locttDir);
    }

    const updated: SyncState = {
      git: {
        ...syncState.git,
        last_synced_commit: remoteHead,
      },
    };
    await saveSyncState(locttDir, updated);

    // Last write of the reconciliation, so the sentinel goes now. Its
    // absence is the only signal that the workspace is whole.
    await clearReconcileState(locttDir);

    return {
      branch,
      updated:
        plan.copies.length > 0 ||
        plan.deletes.length > 0 ||
        resolution.merged.length > 0,
      copied: plan.copies.length,
      deleted: plan.deletes.length,
      kept: plan.keeps.length,
      merged: resolution.merged.length,
      ...(normalised.rekeyed > 0 ? { rekeyed: normalised.rekeyed } : {}),
      ...(normalised.reprefixed > 0 ? { reprefixed: normalised.reprefixed } : {}),
      // Surfaced, not just warned about: a caller that reports "synced"
      // while two tasks share a key is telling the user the merge
      // succeeded when it half did.
      ...(normalised.unresolvedKeys.length > 0
        ? { unresolvedKeys: normalised.unresolvedKeys }
        : {}),
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
