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

export interface PublishResult {
  readonly committed: boolean;
  readonly branch: string;
  readonly pushed?: boolean;
  readonly pushError?: string;
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
