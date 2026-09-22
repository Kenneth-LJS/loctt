import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  ReconcileDecision,
  ReconcilePlan,
  ReconcileState,
  RekeyPlan,
} from "@loctt/contracts";

import { loadWorkflowConfig } from "../config/workflow.js";
import { getLocalDir } from "../paths/index.js";
import {
  clearReconcileState,
  readReconcileState,
  saveReconcileState,
} from "../state/reconcile.js";
import { loadState } from "../state/state.js";
import { loadAllTasks } from "../task/load-all.js";
import { GitRekeyNeededError } from "./publish-sync.js";
import { previewRekey } from "./reconcile.js";
import type { ApplyReconcileResult } from "./reconcile-apply.js";
import { applyReconcile } from "./reconcile-apply.js";
import { computeReconcilePlan } from "./reconcile-plan.js";

/**
 * The live reconciliation session (GIT-7, GIT-12, GIT-18, GIT-26,
 * GIT-32, GIT-37).
 *
 * The sentinel `reconcile.yaml` holds the mode and the two commits, plus
 * the user's decisions-so-far and the task ids already written. The
 * *plan* — the per-field conflicts — is recomputed from those two commits
 * on demand rather than stored, so:
 *
 * - a reload, a navigation, or a browser restart always sees the same
 *   plan (GIT-26): it is derived from git, not from a cached blob;
 * - the plan cannot drift from what is actually on the branch.
 *
 * Recompute needs the branch tree checked out. This spins a throwaway
 * worktree at `remote_commit` exactly the way `pullFromLocttBranch` does,
 * and removes it in `finally`.
 */

function git(args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/**
 * Recomputes the per-field plan for the in-progress reconciliation, or
 * returns undefined when no sentinel is present.
 *
 * The decisions already recorded (GIT-26) and the tasks already applied
 * (GIT-32) travel on the returned state so the panel can pre-fill and
 * hide resolved rows.
 */
export async function loadReconcileSession(
  locttDir: string,
  root: string,
): Promise<{ state: ReconcileState; plan: ReconcilePlan; rekeyPlan?: RekeyPlan } | undefined> {
  const state = await readReconcileState(locttDir);
  if (state === undefined) return undefined;

  // GIT-8/K92: the reconciliation has advanced past its field conflicts and
  // is waiting on a rekey confirm. The field conflicts are resolved (their
  // values are on disk), so the panel should now show the rekey preview,
  // not recompute the — already-settled — conflict plan. The preview is
  // derived from disk (the merge/copy writes are applied), so a reload
  // recomputes the same losers (GIT-26): the plan is never stored.
  if (state.rekey_pending === true) {
    const st = await loadState(locttDir);
    const tasks = await loadAllTasks(locttDir);
    const rekeyPlan = previewRekey(tasks, st);
    return { state, plan: emptyPlan(state), rekeyPlan };
  }

  // A unique path per call: the reconcile GET is polled (staleTime 0)
  // while an Apply runs, and a shared worktree path made two concurrent
  // `git worktree add`s collide — one got a corrupt/empty plan, which an
  // Apply then mistook for "no conflicts" and completed over unresolved
  // files (the reconcile-needed 409 on Apply).
  const worktreeDir = join(getLocalDir(locttDir), `.worktree-reconcile-${randomBytes(4).toString("hex")}`);
  await rm(worktreeDir, { recursive: true, force: true });
  git(["worktree", "prune"], root);
  try {
    const added = git(["worktree", "add", "--detach", worktreeDir, state.remote_commit], root);
    if (!added.ok) {
      // The remote commit is no longer reachable (history rewritten, or
      // the branch pruned). Surface the sentinel with an empty plan so
      // the panel can still offer Abandon rather than wedging.
      return { state, plan: emptyPlan(state) };
    }
    const config = await loadWorkflowConfig(locttDir).catch(() => undefined);
    // Recompute against the SAME base the reconciliation opened against,
    // so the classification does not shift under the user.
    const { planSync } = await import("./three-way.js");
    const syncPlan = await planSync({
      root,
      incomingDir: worktreeDir,
      localDir: locttDir,
      baseCommit: state.base_commit,
    });
    const plan = await computeReconcilePlan({
      localDir: locttDir,
      incomingDir: worktreeDir,
      conflicts: syncPlan.conflicts,
      // GIT-16: the delete-vs-edit rows live in the file-level deletes/copies,
      // so the recomputed session plan needs them too — otherwise the panel
      // (and Apply) would never see the delete-vs-edit rows.
      deletes: syncPlan.deletes,
      copies: syncPlan.copies,
      config,
      mode: state.mode,
      baseCommit: state.base_commit,
      remoteCommit: state.remote_commit,
      root,
    });
    return { state, plan };
  } finally {
    try {
      git(["worktree", "remove", worktreeDir, "--force"], root);
    } catch { /* cleanup best-effort */ }
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
  }
}

function emptyPlan(state: ReconcileState): ReconcilePlan {
  return {
    mode: state.mode,
    base_commit: state.base_commit,
    remote_commit: state.remote_commit,
    conflicts: [],
    deleteVsEdit: [],
    autoMerged: [],
  };
}

/**
 * Records the user's decisions-so-far without applying them (GIT-26).
 *
 * Called as the panel is edited so a reload restores the choices. Merges
 * over any existing decisions rather than replacing, keyed by
 * task+field.
 */
export async function saveReconcileDecisions(
  locttDir: string,
  decisions: readonly ReconcileDecision[],
): Promise<void> {
  const state = await readReconcileState(locttDir);
  if (state === undefined) return;
  await saveReconcileState(locttDir, { ...state, decisions: [...decisions] });
}

export interface ApplyReconcileOutcome extends ApplyReconcileResult {
  /** True when the sentinel was cleared and the originating op may proceed. */
  readonly reconciled: boolean;
  /** The completing sync's outcome (GIT-7), present when mode was `sync`. */
  readonly syncOutcome?: unknown;
  /** The completing publish's outcome (GIT-15), present when mode was `publish`. */
  readonly publishOutcome?: unknown;
  /**
   * GIT-8/K92: set when the field conflicts resolved but the completing sync
   * then found a key collision that must be renumbered. The rekey waits for
   * an explicit confirm, so the operation is NOT yet complete: `reconciled`
   * is false, nothing has been renumbered, and the panel shows this preview
   * and calls `confirmRekey`.
   */
  readonly rekeyPlan?: RekeyPlan;
}

/** The outcome of confirming a pending rekey (GIT-8/GIT-9/GIT-33). */
export interface ConfirmRekeyOutcome {
  /** True once the rekey applied and the originating sync completed. */
  readonly reconciled: boolean;
  /** The completing sync's outcome, carrying `rekeys` (old→new per task). */
  readonly syncOutcome: unknown;
}

/**
 * Applies the decisions, writing the chosen values (GIT-7).
 *
 * Honest partial results (GIT-12/GIT-32/GIT-37): a failed task is
 * reported failed; on any failure the sentinel is kept with the applied
 * ids journalled, so a reopen offers only the unwritten rows and a retry
 * re-applies only those. On full success the sentinel is cleared and the
 * caller completes the original publish/sync.
 */
export async function applyReconcileDecisions(
  locttDir: string,
  root: string,
  decisions: readonly ReconcileDecision[],
): Promise<ApplyReconcileOutcome> {
  const session = await loadReconcileSession(locttDir, root);
  if (session === undefined) {
    throw new Error("no reconciliation is in progress");
  }
  const { state, plan } = session;
  const config = await loadWorkflowConfig(locttDir).catch(() => undefined);

  const result = await applyReconcile(
    locttDir,
    plan.conflicts,
    decisions,
    config,
    state.applied ?? [],
    plan.deleteVsEdit,
  );

  if (result.complete) {
    // Complete the originally-requested operation (GIT-7). For a sync,
    // finish the pull now that the conflicts are resolved: copy
    // incoming-only tasks, keep local for the resolved ones, and advance
    // `last_synced_commit`. This clears the sentinel as its last write.
    // For a publish, the reconciled local state is committed and pushed.
    const { pullFromLocttBranch, publish } = await import("./publish-sync.js");
    if (state.mode === "sync") {
      // The completing sync runs the merge/copy and then normalises keys.
      // If that leaves a key collision, the rekey waits for a confirm
      // (GIT-8/K92): normalise marks the sentinel `rekey_pending` and throws
      // GitRekeyNeededError with the preview. Catch it and report the rekey
      // phase rather than a failure — the field conflicts DID resolve, and
      // the sentinel is intact for the confirm to complete.
      try {
        const outcome = await pullFromLocttBranch(locttDir, root, undefined, {
          resolvedTaskIds: result.appliedTaskIds,
          // GIT-16: every delete-vs-edit task the user decided (both the
          // filtered ones and the keep-task-copy that must still be copied in)
          // is suppressed from re-detection on the completion pass.
          deleteVsEditResolvedTaskIds: [
            ...result.appliedTaskIds,
            ...result.copyThroughTaskIds,
          ],
        });
        return { ...result, reconciled: true, syncOutcome: outcome };
      } catch (err) {
        if (err instanceof GitRekeyNeededError) {
          return { ...result, reconciled: false, rekeyPlan: err.plan };
        }
        throw err;
      }
    }
    // publish: the sentinel was written by the divergence check; clear it
    // so publish's own commit path is unblocked, then push the resolved
    // state.
    await clearReconcileState(locttDir);
    const pub = await publish(locttDir, root, { afterReconcile: true });
    return { ...result, reconciled: true, publishOutcome: pub };
  }

  // Partial: keep the sentinel, journal what landed and the decisions so
  // the reopen is faithful (GIT-32).
  await saveReconcileState(locttDir, {
    ...state,
    decisions: [...decisions],
    applied: [...result.appliedTaskIds],
  });
  return { ...result, reconciled: false };
}

/**
 * Confirms a pending rekey (GIT-8/K92) and completes the originating sync.
 *
 * Re-runs the completion sync with `rekeyConfirmed`, so the key collision
 * is renumbered this time — the loser takes its project's next key, its old
 * key goes to `key_history` (P-7), and `last_synced_commit` advances. The
 * `resolvedTaskIds` from the sentinel are carried so any field conflicts
 * resolved in the earlier phase stay resolved. On success the sentinel is
 * cleared as the sync's last write. A partial rekey failure (GIT-33) is
 * surfaced via `syncOutcome.unresolvedKeys` and does not report complete.
 */
export async function confirmRekey(
  locttDir: string,
  root: string,
): Promise<ConfirmRekeyOutcome> {
  const state = await readReconcileState(locttDir);
  if (state === undefined || state.rekey_pending !== true) {
    throw new Error("no rekey is awaiting confirmation");
  }
  const { pullFromLocttBranch } = await import("./publish-sync.js");
  const outcome = await pullFromLocttBranch(locttDir, root, undefined, {
    resolvedTaskIds: state.applied ?? [],
    rekeyConfirmed: true,
  });
  return { reconciled: true, syncOutcome: outcome };
}

/**
 * Abandons the reconciliation (GIT-18): clears the sentinel and leaves
 * local files exactly as they are. Not a revert — nothing the user
 * already applied is undone.
 */
export async function abandonReconcile(locttDir: string): Promise<void> {
  await clearReconcileState(locttDir);
}
