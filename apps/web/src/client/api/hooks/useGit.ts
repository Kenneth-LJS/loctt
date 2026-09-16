import type { ErrorResponse } from "@loctt/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient,ApiError } from "../client.ts";

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
  /**
   * GIT-22: present when the tracker is on a filesystem where POSIX
   * advisory locks are unreliable (iCloud Drive, Dropbox, OneDrive, NFS,
   * SMB). Mirrors core's `SyncFsAdvisory`; drives the enable-time
   * `data-git-warning="fstype"` advisory. Absent means either a local
   * disk or a class the probe could not determine — no false warning.
   */
  readonly fstypeAdvisory?: {
    readonly fsClass: string;
    readonly label: string;
    readonly message: string;
  };
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

/** One task renumbered to resolve a key collision (GIT-9). */
export interface AppliedRekey {
  readonly taskId: string;
  readonly oldKey: string;
  readonly newKey: string;
}

/**
 * A task the sync applied from the branch whose `task.md` will not parse
 * (GIT-34). Named by id + path + reason so the panel can point the user at
 * the file to inspect; the list still renders it as a broken-file row.
 */
export interface MalformedSyncedTask {
  readonly id: string;
  readonly path: string;
  readonly reason: string;
}

export interface SyncResult {
  readonly updated: boolean;
  readonly branch?: string;
  readonly copied?: number;
  readonly deleted?: number;
  readonly kept?: number;
  readonly merged?: number;
  readonly rekeyed?: number;
  /** Per-task old→new for each renumber (GIT-9). Present only when non-empty. */
  readonly rekeys?: readonly AppliedRekey[];
  readonly reprefixed?: number;
  readonly unresolvedKeys?: readonly string[];
  /**
   * Tasks applied whose `task.md` does not parse (GIT-34). Present only
   * when non-empty. The sync applied the rest; these name the file to fix.
   */
  readonly malformed?: readonly MalformedSyncedTask[];
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
      // A sync (or an applied reconciliation) rewrites task files, so the
      // list must not keep serving the pre-sync population (GIT-3,
      // GIT-23). The main list and board read `["tasks-feed"]`, not
      // `["tasks"]`, and the sidebar saved-view badges read
      // `["builtin-count"]` — invalidating only `["tasks"]` left both
      // stale after a sync (GIT-23 bullets 3-4). All four are invalidated
      // so the new population, its honest total, and the badge counts all
      // recompute.
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
    },
  });
}

export function useGitPublish() {
  return useGitMutation<PublishResult>("/api/git/publish");
}

/** A sync's incremental write progress (GIT-23). */
export interface SyncProgress {
  readonly applied: number;
  readonly total: number;
}

/**
 * Streams `POST /api/git/sync` (GIT-23).
 *
 * The route replies one of two ways, and this handles both so the caller
 * gets the same `SyncResult`/`ApiError` it always did:
 *
 *  - **NDJSON** (a sync that writes files): `{ progress }` lines, each
 *    forwarded to `onProgress` so the panel shows determinate progress
 *    rather than an indefinite spinner, then a terminal `{ result }` or
 *    `{ error }` line. A `{ error }` line is a mid-write failure — after
 *    a 200 header — so it is reconstructed into the identical `ApiError`
 *    (envelope + status) the plain error path would have thrown.
 *  - **JSON** (a no-op sync, or a planning-phase failure): the ordinary
 *    body via `apiClient`. A non-2xx here (a 409 conflict, a 500) is
 *    thrown by `apiClient.post` exactly as before, so the `/api/git/sync`
 *    error contract is unchanged.
 */
async function streamSync(onProgress: (p: SyncProgress) => void): Promise<SyncResult> {
  const endpoint = "/api/git/sync";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-Loctt-Client": "web", "Content-Type": "application/json" },
    body: "{}",
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson") || !res.body) {
    // Non-stream reply: a no-op sync's JSON body, or a planning-phase
    // error. Reuse the transport's own parsing + ApiError throwing.
    return apiClient.post<SyncResult>(endpoint, {});
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SyncResult | undefined;
  let streamError: { status: number; message: string } & Partial<ErrorResponse> | undefined;

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    const parsed = JSON.parse(trimmed) as
      | { progress: SyncProgress }
      | { result: SyncResult }
      | { error: { status: number; message: string } & Partial<ErrorResponse> };
    if ("progress" in parsed) { onProgress(parsed.progress); return; }
    if ("result" in parsed) { result = parsed.result; return; }
    streamError = parsed.error;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  handleLine(buffer);

  if (streamError !== undefined) {
    const { status, message, ...rest } = streamError;
    const envelope: ErrorResponse = { code: rest.code ?? "unknown", message, ...rest };
    throw new ApiError(message, { status, body: streamError, endpoint, envelope });
  }
  if (result === undefined) {
    // The stream ended without a terminal line — a truncated response
    // (killed server). Do not report a phantom success.
    throw new ApiError(`${endpoint}: the sync did not complete`, {
      status: 0,
      body: undefined,
      endpoint,
      envelope: {
        code: "unknown",
        message: "the sync did not complete, so LocTT cannot tell whether it finished",
        data_state: "unknown",
        recovery: { kind: "reload" },
      },
    });
  }
  return result;
}

/**
 * Sync, with an optional progress sink (GIT-23). Passing `onProgress`
 * lets the panel render "N of M files" during a large sync; omitting it
 * keeps the plain mutation for callers that do not show progress.
 *
 * Invalidation matches every other git write plus the two keys the list
 * population actually reads (see `useGitMutation`).
 */
export function useGitSync(onProgress?: (p: SyncProgress) => void) {
  const qc = useQueryClient();
  return useMutation<SyncResult, Error, void>({
    mutationFn: () => streamSync(onProgress ?? (() => {})),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["git"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
    },
  });
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
/**
 * A task deleted on one side and edited on the other (GIT-16) — a whole-task
 * keep-deletion / keep-task decision, distinct from a per-field conflict.
 * Mirrors core's `DeleteVsEditConflict`.
 */
export interface ReconcileDeleteVsEdit {
  readonly taskId: string;
  readonly taskKey: string;
  readonly taskTitle: string;
  readonly deletedSide: "local" | "remote";
  readonly editedSide: "local" | "remote";
}
/** The reserved `field` a delete-vs-edit decision carries (GIT-16). */
export const DELETE_VS_EDIT_FIELD = "__delete_vs_edit__";
export interface ReconcilePlan {
  readonly mode: "publish" | "sync";
  readonly base_commit: string;
  readonly remote_commit: string;
  readonly conflicts: readonly ReconcileConflict[];
  readonly deleteVsEdit: readonly ReconcileDeleteVsEdit[];
  readonly autoMerged: readonly ReconcileAutoMerged[];
}
export interface ReconcileSentinel {
  readonly mode: "publish" | "sync";
  readonly base_commit: string;
  readonly remote_commit: string;
  readonly started_at: string;
  readonly decisions?: readonly ReconcileDecision[];
  readonly applied?: readonly string[];
  readonly rekey_pending?: boolean;
}
/**
 * One task the merge will renumber, paired against the keeper of its key
 * (GIT-8/GIT-9). Mirrors core's `RekeyLoser`. `newKey` absent = the loser's
 * project has no counter and it appears in `skipped` instead.
 */
export interface RekeyLoser {
  readonly key: string;
  readonly loserId: string;
  readonly loserCreatedAt: string | null;
  readonly keeperId: string;
  readonly keeperCreatedAt: string | null;
  readonly tiebreak: "created_at" | "ulid";
  readonly newKey?: string;
}
export interface RekeySkip {
  readonly taskId: string;
  readonly key: string;
  readonly reason: string;
}
/** The rekey preview the panel confirms (GIT-8). Mirrors core's `RekeyPlan`. */
export interface RekeyPlan {
  readonly losers: readonly RekeyLoser[];
  readonly skipped: readonly RekeySkip[];
}
export interface ReconcileDecision {
  readonly taskId: string;
  readonly field: string;
  readonly choice: "local" | "remote" | "value";
  readonly value?: unknown;
}
export interface ReconcileSessionResponse {
  readonly reconcile: {
    readonly state: ReconcileSentinel;
    readonly plan: ReconcilePlan;
    /** Present once field conflicts resolved and a rekey is pending (GIT-8). */
    readonly rekeyPlan?: RekeyPlan;
  } | null;
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
  /** Present when the completing sync now needs a rekey confirm (GIT-8). */
  readonly rekeyPlan?: RekeyPlan;
}
export interface ConfirmRekeyResponse {
  readonly reconciled: boolean;
  readonly syncOutcome: SyncResult;
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
      // Applying a reconciliation writes task files (GIT-7), so the list
      // (`["tasks-feed"]`) and saved-view badges (`["builtin-count"]`)
      // must recompute, not just `["tasks"]`.
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
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

/**
 * Confirms a pending rekey and completes the originating sync (GIT-8, K92).
 * The preview was shown from the reconcile session; this applies it. On
 * success the task list, saved-view badges, and git status all change, so
 * invalidate the same keys `useApplyReconcile` does.
 */
export function useConfirmRekey() {
  const qc = useQueryClient();
  return useMutation<ConfirmRekeyResponse, Error, void>({
    mutationFn: () => apiClient.post("/api/git/reconcile/confirm-rekey", {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["git"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["tasks-feed"] });
      void qc.invalidateQueries({ queryKey: ["builtin-count"] });
    },
  });
}
