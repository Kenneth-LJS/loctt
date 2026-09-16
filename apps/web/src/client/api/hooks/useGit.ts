import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Settings → Tracker → Sync, over the five `/api/git/*` routes.
 *
 * The shapes here mirror core's `GitStatusResult` and `publish`/`sync`
 * return types exactly, because the server hands them through
 * unchanged. Two of their properties drive most of the panel's logic
 * and are easy to get wrong:
 *
 *  - `localChanges` is a **count**; `remoteChanges` is a **boolean**.
 *    Core can count local drift by diffing the worktree, but the
 *    remote side is only "the branch head moved since last sync" — it
 *    does not enumerate. The panel must not render a fabricated remote
 *    count (GIT-4).
 *  - `undefined` is not zero. Both are absent when git mode is off,
 *    no branch exists yet, or this is not a repo. "Nothing to publish"
 *    and "cannot tell" are different readouts.
 *
 * `unreadable` outranks everything: when `sync.yaml` exists but could
 * not be read, every other field is a **default rather than a
 * reading**, so the panel must report unknown rather than "off".
 */

export interface GitStatus {
  readonly enabled: boolean;
  readonly branch: string;
  readonly remote: string;
  readonly autoPush: boolean;
  readonly autoFetch: boolean;
  readonly lastSyncedCommit?: string;
  readonly isGitRepo: boolean;
  /** A remote is actually configured — `remote` defaults to "origin". */
  readonly remoteConfigured: boolean;
  readonly localChanges?: number;
  readonly remoteChanges?: boolean;
  readonly branchCommit?: string;
  readonly unreadable?: { readonly path: string; readonly reason: string };
}

/**
 * Classes of remote push/fetch failure the panel must tell apart
 * (GIT-29, GIT-30). Mirrors core's `GitRemoteFailureKind`; the wire shape
 * is duplicated here because the client types are hand-mirrored, not
 * imported from core.
 */
export type GitRemoteFailureKind =
  | "auth"
  | "non_fast_forward"
  | "unreachable"
  | "other";

export interface GitRemoteFailure {
  readonly kind: GitRemoteFailureKind;
  /** Class-level summary the panel phrases the remedy around. */
  readonly summary: string;
  /** Git's specific cause (GIT-C4). */
  readonly detail: string;
  /** Alias of `detail`; the string a bare printer shows. */
  readonly message: string;
  readonly remote: string;
}

export interface PublishResult {
  readonly committed: boolean;
  readonly branch: string;
  readonly pushed?: boolean;
  readonly pushError?: string;
  /** Classified push failure (GIT-29) — present iff `pushError` is. */
  readonly pushFailure?: GitRemoteFailure;
}

export interface SyncResult {
  readonly updated: boolean;
  readonly branch?: string;
  readonly copied?: number;
  readonly deleted?: number;
  readonly kept?: number;
  readonly merged?: number;
  readonly rekeyed?: number;
  readonly reprefixed?: number;
  readonly unresolvedKeys?: readonly string[];
  readonly fetched?: boolean;
  readonly fetchError?: string;
  /** Classified fetch failure (GIT-30) — present iff `fetchError` is. */
  readonly fetchFailure?: GitRemoteFailure;
}

export function useGitStatus() {
  return useQuery({
    queryKey: ["git", "status"],
    queryFn: ({ signal }) => apiClient.get<GitStatus>("/api/git/status", { signal }),
    // GIT-4's last bullet: a stale zero must not read as a fresh one,
    // so the panel shows when it last checked and this never serves a
    // cached answer as current.
    staleTime: 0,
  });
}

/**
 * Every git write invalidates status, because all of them move the
 * things status reports (the commit, the drift counts, enablement).
 * GIT-20 — the CLI published while the panel was open — is the same
 * refetch from the other direction.
 */
function useGitMutation<TResult, TVars = void>(
  path: string,
) {
  const qc = useQueryClient();
  return useMutation<TResult, Error, TVars>({
    mutationFn: (vars: TVars) => apiClient.post<TResult>(path, vars ?? {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["git"] });
      // A sync rewrites task files, so the list must not keep serving
      // the pre-sync population (GIT-3, GIT-23).
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useGitPublish() {
  return useGitMutation<PublishResult>("/api/git/publish");
}

export function useGitSync() {
  return useGitMutation<SyncResult>("/api/git/sync");
}

export function useGitEnable() {
  return useGitMutation<{ enabled: boolean }>("/api/git/enable");
}

export function useGitDisable() {
  return useGitMutation<{ enabled: boolean }>("/api/git/disable");
}

/**
 * The per-field reconciliation model (GIT-6, GIT-11, GIT-13, GIT-14).
 * Mirrors core's `ReconcilePlan` / `ReconcileState` exactly.
 */
export interface ReconcileConflictValue {
  readonly raw: unknown;
  readonly display: string;
  readonly drift?: { readonly reason: string };
  /**
   * Phase-7B: set when this side's value for the field is corrupt — the
   * side's task carries a `health` finding on it, so `display` is the
   * degraded stand-in. The panel marks the side ⚠ so a corrupt value is
   * not merged as if it were merely empty. `rawText` is the stored bytes.
   */
  readonly corrupt?: { readonly rawText: string; readonly error: string };
}
export interface ReconcileConflict {
  readonly taskId: string;
  readonly taskKey: string;
  readonly taskTitle: string;
  readonly field: string;
  readonly fieldLabel: string;
  readonly kind: "scalar" | "enum" | "relationship_parent";
  readonly local: ReconcileConflictValue;
  readonly remote: ReconcileConflictValue;
  readonly options?: readonly { readonly key: string; readonly label: string }[];
}
export interface ReconcileAutoMerged {
  readonly taskKey: string;
  readonly fields: readonly string[];
  readonly kind: "union" | "converged";
}
export interface ReconcilePlan {
  readonly mode: "publish" | "sync";
  readonly base_commit: string;
  readonly remote_commit: string;
  readonly conflicts: readonly ReconcileConflict[];
  readonly autoMerged: readonly ReconcileAutoMerged[];
}
export interface ReconcileSentinel {
  readonly mode: "publish" | "sync";
  readonly base_commit: string;
  readonly remote_commit: string;
  readonly started_at: string;
  readonly decisions?: readonly ReconcileDecision[];
  readonly applied?: readonly string[];
}
export interface ReconcileDecision {
  readonly taskId: string;
  readonly field: string;
  readonly choice: "local" | "remote" | "value";
  readonly value?: unknown;
}
export interface ReconcileSessionResponse {
  readonly reconcile: { readonly state: ReconcileSentinel; readonly plan: ReconcilePlan } | null;
}
export interface ApplyReconcileResponse {
  readonly reconciled: boolean;
  readonly complete: boolean;
  readonly results: readonly {
    readonly taskId: string; readonly taskKey: string; readonly ok: boolean;
    readonly error?: string;
    readonly resolved: readonly { readonly field: string; readonly value: string }[];
  }[];
  readonly appliedTaskIds: readonly string[];
}

/**
 * The in-progress reconciliation, recomputed from the sentinel on the
 * server (GIT-18, GIT-26). Polled on the same `["git"]` key so any git
 * write refreshes it. `null` reconcile means none in progress.
 */
export function useReconcileSession() {
  return useQuery({
    queryKey: ["git", "reconcile"],
    queryFn: ({ signal }) =>
      apiClient.get<ReconcileSessionResponse>("/api/git/reconcile", { signal }),
    staleTime: 0,
  });
}

/** Persists the decisions-so-far without applying (GIT-26). */
export function useSaveReconcileDecisions() {
  const qc = useQueryClient();
  return useMutation<{ saved: boolean }, Error, readonly ReconcileDecision[]>({
    mutationFn: decisions => apiClient.post("/api/git/reconcile/decisions", { decisions }),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["git", "reconcile"] }); },
  });
}

/** Applies the decisions and completes the operation (GIT-7, GIT-12, GIT-32). */
export function useApplyReconcile() {
  const qc = useQueryClient();
  return useMutation<ApplyReconcileResponse, Error, readonly ReconcileDecision[]>({
    mutationFn: decisions => apiClient.post("/api/git/reconcile/apply", { decisions }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["git"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/** Abandons the in-progress reconciliation (GIT-18). */
export function useAbandonReconcile() {
  const qc = useQueryClient();
  return useMutation<{ abandoned: boolean }, Error, void>({
    mutationFn: () => apiClient.post("/api/git/reconcile/abandon", {}),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["git"] }); },
  });
}
