import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * File-level 3-way classification for git-backed sync.
 *
 * `mirrorDir` in publish-sync.ts is a blind last-writer-wins copy: it
 * deletes anything on the destination that isn't on the source. That is
 * correct only when the source is strictly ahead of the destination.
 * When both sides moved since the last sync it silently destroys work.
 *
 * This module supplies the missing third input — the **base**, i.e. the
 * tree at `last_synced_commit` — so a path can be classified as
 * "the remote deleted it" (propagate) versus "I created it locally"
 * (keep), which a two-way comparison cannot distinguish.
 *
 * This is deliberately *file*-level, not field-level. Per-field merging
 * of task frontmatter (the `relationships` / `key_history` union rules in
 * docs/user/common/git-sync.md) is a separate layer that builds on this
 * one; the helpers for it already exist in `reconcile.ts`.
 */

/** Paths that must never be mirrored between workspace and branch. */
export const NEVER_MIRROR: ReadonlySet<string> = new Set([
  "local", // machine-local: sync.yaml, worktrees, reconcile state
  ".git",
]);

/**
 * Paths whose *content* is owned by the local workspace and must never be
 * overwritten by a sync.
 *
 * `.schema-version` gates every command through the schema guard. Mirroring
 * it from the branch lets a clone running a newer LocTT brick an older one
 * with no recovery path — `git disable` is itself blocked by the guard.
 * Schema changes travel through `loctt migrate`, never through sync.
 */
export const LOCAL_OWNED: ReadonlySet<string> = new Set([".schema-version"]);

export type Disposition =
  | "copy" // take the incoming version
  | "keep" // retain the local version
  | "delete" // remote deleted it since base; propagate
  | "conflict"; // both sides changed it differently since base

export interface PathPlan {
  readonly path: string;
  readonly disposition: Disposition;
  readonly reason: string;
}

export interface SyncPlan {
  readonly copies: readonly PathPlan[];
  readonly keeps: readonly PathPlan[];
  readonly deletes: readonly PathPlan[];
  readonly conflicts: readonly PathPlan[];
}

function git(args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/**
 * Lists blob paths in a commit's tree, relative to the tree root.
 * Returns `undefined` when the commit is unknown (e.g. a first-ever sync,
 * or history rewritten underneath us) — callers must treat that as
 * "no base available" rather than "base is empty", since an empty base
 * would classify every local file as a new creation.
 */
export function listTreePaths(root: string, commit: string): Set<string> | undefined {
  const verify = git(["rev-parse", "--verify", `${commit}^{commit}`], root);
  if (!verify.ok) return undefined;
  const r = git(["ls-tree", "-r", "--name-only", commit], root);
  if (!r.ok) return undefined;
  return new Set(r.out.split(/\r?\n/).filter(Boolean));
}

/** Reads a blob's contents at a commit, or undefined when absent. */
export function readTreeFile(
  root: string,
  commit: string,
  path: string,
): string | undefined {
  const r = git(["show", `${commit}:${path}`], root);
  return r.ok ? r.out : undefined;
}

/** Recursively lists files under dir, as paths relative to dir, POSIX-separated. */
export async function listFiles(
  dir: string,
  exclude: ReadonlySet<string>,
): Promise<Set<string>> {
  const out = new Set<string>();

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const rel = relative(dir, abs).split(sep).join("/");
      const top = rel.split("/")[0] as string;
      if (exclude.has(top)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.add(rel);
      }
    }
  }

  const exists = await stat(dir).then(() => true).catch(() => false);
  if (exists) await walk(dir);
  return out;
}

async function readLocal(dir: string, path: string): Promise<string | undefined> {
  return readFile(join(dir, path), "utf-8").catch(() => undefined);
}

export interface PlanInput {
  /** Repo root (for git plumbing). */
  readonly root: string;
  /** The incoming tree, checked out (a worktree of the branch). */
  readonly incomingDir: string;
  /** The local .loctt workspace. */
  readonly localDir: string;
  /** Commit of the last successful sync, or undefined on first sync. */
  readonly baseCommit: string | undefined;
  /** Prefix that branch paths carry relative to the tree root. */
  readonly basePrefix?: string;
}

/**
 * Builds a per-path plan for pulling `incomingDir` into `localDir`.
 *
 * Rules, in order:
 *  - never-mirror paths are skipped entirely
 *  - local-owned paths are always kept
 *  - identical content is a no-op (recorded as a keep)
 *  - present locally but not incoming:
 *      · absent from base  -> keep   (created locally since base)
 *      · present in base   -> delete (remote deleted it since base)
 *      · no base available -> keep   (cannot prove intent; never guess)
 *  - present incoming but not locally:
 *      · absent from base  -> copy   (created remotely since base)
 *      · present in base   -> copy   (deleted locally; remote is canonical
 *                                     for now — field-level merge will
 *                                     refine this)
 *  - present on both, differing:
 *      · local matches base    -> copy     (only remote moved)
 *      · incoming matches base -> keep     (only local moved)
 *      · neither matches base  -> conflict (both moved differently)
 *      · no base available     -> conflict (cannot prove either way)
 */
export async function planSync(input: PlanInput): Promise<SyncPlan> {
  const { root, incomingDir, localDir, baseCommit, basePrefix = "" } = input;

  const incoming = await listFiles(incomingDir, NEVER_MIRROR);
  const local = await listFiles(localDir, NEVER_MIRROR);
  const basePaths = baseCommit ? listTreePaths(root, baseCommit) : undefined;

  const inBase = (p: string): boolean | undefined => {
    if (!basePaths) return undefined;
    return basePaths.has(basePrefix ? `${basePrefix}${p}` : p);
  };
  const baseContent = (p: string): string | undefined =>
    baseCommit
      ? readTreeFile(root, baseCommit, basePrefix ? `${basePrefix}${p}` : p)
      : undefined;

  const copies: PathPlan[] = [];
  const keeps: PathPlan[] = [];
  const deletes: PathPlan[] = [];
  const conflicts: PathPlan[] = [];

  for (const path of new Set([...incoming, ...local])) {
    const top = path.split("/")[0] as string;
    if (LOCAL_OWNED.has(path) || LOCAL_OWNED.has(top)) {
      keeps.push({ path, disposition: "keep", reason: "local-owned; never mirrored" });
      continue;
    }

    const onIncoming = incoming.has(path);
    const onLocal = local.has(path);

    if (onLocal && !onIncoming) {
      const known = inBase(path);
      if (known === true) {
        deletes.push({ path, disposition: "delete", reason: "deleted on branch since last sync" });
      } else if (known === false) {
        keeps.push({ path, disposition: "keep", reason: "created locally since last sync" });
      } else {
        keeps.push({ path, disposition: "keep", reason: "no base commit; refusing to delete unproven local file" });
      }
      continue;
    }

    if (onIncoming && !onLocal) {
      copies.push({ path, disposition: "copy", reason: "present on branch, absent locally" });
      continue;
    }

    const [incomingText, localText] = await Promise.all([
      readLocal(incomingDir, path),
      readLocal(localDir, path),
    ]);

    if (incomingText === localText) {
      keeps.push({ path, disposition: "keep", reason: "identical" });
      continue;
    }

    const base = baseContent(path);
    const baseKnown = inBase(path) === true && base !== undefined;
    const localMatchesBase = baseKnown && localText?.trim() === base?.trim();
    const incomingMatchesBase = baseKnown && incomingText?.trim() === base?.trim();

    if (localMatchesBase && !incomingMatchesBase) {
      copies.push({ path, disposition: "copy", reason: "changed on branch only" });
    } else if (incomingMatchesBase && !localMatchesBase) {
      keeps.push({ path, disposition: "keep", reason: "changed locally only" });
    } else if (!baseKnown) {
      conflicts.push({ path, disposition: "conflict", reason: "differs and no base to compare against" });
    } else {
      conflicts.push({ path, disposition: "conflict", reason: "changed differently on both sides since last sync" });
    }
  }

  return { copies, keeps, deletes, conflicts };
}
