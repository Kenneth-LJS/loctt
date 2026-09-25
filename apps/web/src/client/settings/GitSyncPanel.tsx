import type { ErrorResponse } from "@loctt/contracts";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  type GitRemoteFailure,
  type GitStatus,
  type SyncProgress,
  useGitDisable,
  useGitEnable,
  useGitPublish,
  useGitStatus,
  useGitSync,
  useReconcileSession,
} from "../api/hooks/useGit.ts";
import { Button } from "../ui/Button.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { dataStateOf, InlineFailureNotice } from "../ui/InlineFailureNotice.tsx";
import { ReconcilePanel } from "./ReconcilePanel.tsx";

/**
 * The `history_rewritten` refusal payload (GIT-21, K93), read off the
 * error envelope. Present only when the branch was force-pushed past the
 * last-synced base; `undefined` for every other error, so the caller
 * falls back to the generic `ErrorState`.
 */
export function historyRewritten(error: unknown):
  | NonNullable<ErrorResponse["history_rewritten"]>
  | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code !== "history_rewritten") return undefined;
  return error.envelope?.history_rewritten;
}

/**
 * The force-push / history-rewrite refusal (GIT-21, K93). NOT an ordinary
 * conflict and NOT retryable in LocTT: the panel states the branch history
 * was rewritten, names the remote and the commit that can no longer be
 * found, affirms local state is untouched, and gives the two concrete next
 * actions — both things the user does *in git*, never a LocTT button that
 * rewrites state. K93 forbids any automated rebase/base-reset, so this
 * offers no action controls at all.
 */
function HistoryRewrittenRefusal({
  info,
  testId,
}: {
  readonly info: NonNullable<ErrorResponse["history_rewritten"]>;
  readonly testId: string;
}) {
  const where = info.remote !== null ? `${info.remote}/${info.branch}` : `the ${info.branch} branch`;
  return (
    <div
      role="alert"
      data-testid={testId}
      data-git-refusal="history-rewritten"
      data-missing-commit={info.missing_commit}
      data-remote={info.remote ?? "none"}
      className="mb-3 rounded-md border border-danger-fg p-3 text-[0.9286rem] text-danger-fg"
    >
      <p className="font-semibold">
        The history of {where} was rewritten. The commit LocTT last synced
        (<code className="text-[0.8571rem]">{info.missing_commit.slice(0, 8)}</code>) is gone.
        Nothing was changed locally.
      </p>
      <p className="mt-2 text-text-secondary">To recover in git:</p>
      <ul className="mt-1 ml-4 list-disc text-text-secondary">
        <li data-testid={`${testId}-inspect`}>
          Compare <code className="font-mono text-[0.8571rem]">git log {info.branch}</code>{" "}
          with your local <code className="text-[0.8571rem]">.loctt/</code> folder.
        </li>
        <li data-testid={`${testId}-rebase`}>
          After merging by hand, run{" "}
          <code className="font-mono text-[0.8571rem]">git branch -f {info.branch} &lt;commit&gt;</code>,
          then sync again.
        </li>
      </ul>
    </div>
  );
}

/**
 * The `schema_remote_newer` refusal payload (GIT-35, K94), read off the
 * error envelope. Present only when the branch was written by a newer
 * LocTT than this build understands; `undefined` for every other error.
 */
export function schemaRemoteNewer(error: unknown):
  | NonNullable<ErrorResponse["schema_remote_newer"]>
  | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code !== "schema_remote_newer") return undefined;
  return error.envelope?.schema_remote_newer;
}

/**
 * The newer-remote-schema refusal (GIT-35, K94). NOT a conflict and NOT
 * retryable in LocTT: the branch was written by a newer LocTT, so applying
 * it could corrupt data. The panel names both schema versions, affirms
 * nothing was written, and says the fix is to UPGRADE LocTT — not migrate,
 * not retry. Offers no action controls. A malformed remote version arrives
 * as `remote_version: null` (unknown ⇒ treated as ahead), phrased as "a
 * newer version".
 */
function SchemaRemoteNewerRefusal({
  info,
  testId,
}: {
  readonly info: NonNullable<ErrorResponse["schema_remote_newer"]>;
  readonly testId: string;
}) {
  const remote = info.remote_version !== null
    ? `schema v${info.remote_version}`
    : "a newer schema";
  return (
    <div
      role="alert"
      data-testid={testId}
      data-git-refusal="schema-remote-newer"
      data-remote-version={info.remote_version ?? "unknown"}
      data-local-version={info.local_version}
      className="mb-3 rounded-md border border-danger-fg p-3 text-[0.9286rem] text-danger-fg"
    >
      <p className="font-semibold">
        The {info.branch} branch was written by a newer LocTT ({remote}). This
        version supports up to <code className="text-[0.8571rem]">schema v{info.local_version}</code>.
        Nothing was changed. Update LocTT, then sync again.
      </p>
    </div>
  );
}

/**
 * The `git_worktree_missing` refusal payload (GIT-36), read off the error
 * envelope. Present only when LocTT's temporary publish/sync worktree is
 * registered by git but its directory is gone; `undefined` otherwise, so
 * the caller falls back to the generic `ErrorState`.
 */
export function worktreeMissing(error: unknown):
  | NonNullable<ErrorResponse["worktree_missing"]>
  | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code !== "git_worktree_missing") return undefined;
  return error.envelope?.worktree_missing;
}

/**
 * The `branch_adopt_needed` payload (GIT-25), read off the error envelope.
 * Present only when enable found a pre-existing LocTT-written branch and
 * adoption was not confirmed; `undefined` for every other error, so the
 * caller falls back to the generic `ErrorState`. Carries the branch and
 * its head so the panel states what was found and shows the head before
 * offering adopt-or-stop, without a second fetch.
 */
export function branchAdoptNeeded(error: unknown):
  | NonNullable<ErrorResponse["branch_adopt_needed"]>
  | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code !== "branch_adopt_needed") return undefined;
  return error.envelope?.branch_adopt_needed;
}

/**
 * The missing/corrupt-worktree refusal (GIT-36). NOT a retryable error —
 * the same broken worktree would fail again — so this offers no Retry
 * control. It names the exact worktree that is missing, affirms local task
 * files were not modified, and gives two concrete repair paths, each
 * stating what it does to local task files: re-establish the worktree in
 * git (bookkeeping only), or disable + re-enable git sync (rebuilds
 * LocTT's git setup, leaves task files as they are).
 */
function WorktreeMissingRefusal({
  info,
  testId,
}: {
  readonly info: NonNullable<ErrorResponse["worktree_missing"]>;
  readonly testId: string;
}) {
  const op = info.operation === "publish" ? "Publish" : "Sync";
  return (
    <div
      role="alert"
      data-testid={testId}
      data-git-refusal="worktree-missing"
      data-worktree={info.worktree}
      data-operation={info.operation}
      className="mb-3 rounded-md border border-danger-fg p-3 text-[0.9286rem] text-danger-fg"
    >
      <p className="font-semibold">
        {op} could not start because LocTT&rsquo;s git worktree at{" "}
        <code className="text-[0.8571rem]">{info.worktree}</code> is missing.
        Nothing was changed.
      </p>
      <p className="mt-2 text-text-secondary">
        To fix it, run{" "}
        <code className="font-mono text-[0.8571rem]">git worktree prune</code>,
        then {info.operation} again. If git says it&rsquo;s locked, run{" "}
        <code className="font-mono text-[0.8571rem]">git worktree unlock {info.worktree}</code>{" "}
        first.
      </p>
    </div>
  );
}

/**
 * A328 (B6): the Disable confirm box's copy, verbatim from the decision.
 * `data_state: "unknown"` (a K115 timeout) reads differently from an
 * ordinary rejection — the first cannot say the toggle failed, only that
 * it could not be confirmed.
 */
export function disableFailureMessage(error: unknown): string {
  return dataStateOf(error) === "unknown"
    ? "Couldn't confirm git sync was turned off. Refresh to check."
    : "Git sync wasn't turned off. Try again.";
}

/**
 * The sentence a failed push shows (GIT-29). Every branch states the
 * local commit is safe — the push failed, not the commit — and names the
 * remote; the non-fast-forward branch recommends Sync, the auth branch
 * points at credentials, distinguishing the two causes.
 */
export function publishFailureLine(branch: string, failure: GitRemoteFailure): string {
  switch (failure.kind) {
    case "non_fast_forward":
      return `Committed to ${branch} locally, but "${failure.remote}" has newer changes. Sync, then publish again.`;
    case "auth":
      return `Committed to ${branch} locally, but signing in to "${failure.remote}" failed (${failure.detail}). Check your git credentials and try again.`;
    case "unreachable":
      return `Committed to ${branch} locally, but "${failure.remote}" couldn't be reached (${failure.detail}). Try again when it's reachable.`;
    default:
      return `Committed to ${branch} locally, but the push failed: ${failure.detail}.`;
  }
}

/**
 * The clause a failed fetch shows after the remote name (GIT-30). A
 * network/DNS failure reads "could not be reached"; other classes (auth
 * on a private remote) carry their own cause verbatim so the user is not
 * told the wrong remedy.
 */
export function fetchFailureClause(failure: GitRemoteFailure): string {
  switch (failure.kind) {
    case "unreachable":
      return `could not be reached (${failure.detail})`;
    case "auth":
      return `rejected authentication (${failure.detail})`;
    default:
      return `could not be fetched (${failure.detail})`;
  }
}

/**
 * Settings → Tracker → Sync (GIT-1..GIT-4, GIT-10, GIT-20, GIT-24,
 * GIT-27, GIT-28, GIT-30, GIT-38).
 *
 * Reconciliation UI lives in the child `<ReconcilePanel/>` (rendered
 * below). An earlier version of this comment claimed there was no
 * reconcile UI or engine and cited decisions.md A68 ("ship the panel,
 * report the rest") — that was **superseded by A121** (commit e99bfec,
 * 2026-09-04): the per-field reconciliation engine
 * (`computeReconcilePlan`/`applyReconcile`, wired at
 * `publish-sync.ts:968,1213`) now exists, and `ReconcilePanel` drives
 * it. See decisions.md A188 for the up-to-date audit of what is built.
 * GIT-29 (push rejected: auth vs non-fast-forward) and GIT-30 (fetch
 * against an unreachable remote) are now built here: the push/fetch
 * failure is classified in core (`classifyRemoteFailure`), rides in the
 * success body as `pushFailure`/`fetchFailure`, and this panel names the
 * remote, states the local state was untouched, and offers Retry (plus
 * Sync-first for a non-fast-forward push) without entering a permanent
 * error state. GIT-23 (a 500-task sync reports progress + honest counts)
 * is now built here too: the sync mutation streams `{applied,total}`
 * ticks that drive a determinate progress bar during a large sync, and
 * the result summarises with counts plus an expand-for-full-breakdown
 * affordance rather than enumerating every key inline. GIT-21 (a
 * force-pushed / rewritten branch) is now built here too: core refuses
 * with a distinct `GitHistoryRewrittenError` and this panel renders a
 * dedicated refusal (`HistoryRewrittenRefusal`) naming the remote and the
 * missing commit, stating local state is untouched, and pointing at git
 * for recovery — no LocTT rebase/base-reset control, per K93. The residual
 * conflict-resolution cases still unbuilt are GIT-8/16/19/25/33/34/35/36;
 * the rest of the GIT-* range is built and tested.
 *
 * This panel also carries GIT-18's first duty: detect that a
 * reconciliation is in progress and refuse to start another operation
 * over it.
 *
 * Two shapes of core's status drive most of the rendering:
 *
 *  - `unreadable` outranks every other field. When `sync.yaml` exists
 *    and will not parse, everything else in the object is a *default*,
 *    so reporting "git sync is off" would be a fabrication — and the
 *    natural response to it (re-enable) overwrites the state being
 *    recovered.
 *  - `localChanges` is a count, `remoteChanges` is a boolean, and
 *    `undefined` on either means "could not determine", not zero.
 */

/** Commit hashes arrive full-length; GIT-4 asks for the short form. */
function short(commit: string | undefined): string {
  return commit === undefined ? "—" : commit.slice(0, 8);
}

function Row({ label, children, testId }: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="flex gap-3 border-b border-border-subtle py-1.5 text-[0.9286rem] last:border-0">
      <span className="w-40 shrink-0 text-text-secondary">{label}</span>
      <span className="min-w-0 flex-1 text-text-primary" data-testid={testId}>{children}</span>
    </div>
  );
}

/**
 * GIT-1's before-the-fact disclosure and GIT-27/GIT-28's refusals.
 *
 * The three preconditions are distinct and must not collapse into one
 * "cannot enable": not a repo (GIT-28) is unfixable from here and names
 * `git init`; no remote (GIT-27) still allows a local-only enable, so
 * it warns rather than blocks and says the panel will label it.
 */
function DisabledState({ status, onAdopted }: {
  readonly status: GitStatus;
  /**
   * GIT-25: called once with the adopt outcome when enable adopted a
   * pre-existing branch, so the parent can report agreement after this
   * component unmounts (the panel flips to enabled on the status refetch).
   */
  readonly onAdopted: (report: { branch: string; inAgreement: boolean | null }) => void;
}) {
  const enable = useGitEnable();
  const [confirming, setConfirming] = useState(false);
  // GIT-25: present when enable refused because a pre-existing LocTT-written
  // branch was found and adoption was not confirmed. Drives the
  // adopt-or-stop control below instead of the generic error state.
  const adoptInfo = branchAdoptNeeded(enable.error);
  // GIT-25: when enable succeeds with an adopt outcome, hand it up so the
  // agreement report survives this component unmounting. Guarded to fire
  // once per outcome.
  const reported = useRef(false);
  useEffect(() => {
    if (enable.isSuccess && enable.data.adopted !== undefined && !reported.current) {
      reported.current = true;
      onAdopted({
        branch: enable.data.adopted.branch,
        inAgreement: enable.data.adopted.inAgreement,
      });
    }
  }, [enable.isSuccess, enable.data, onAdopted]);

  if (!status.isGitRepo) {
    return (
      <div data-testid="git-not-a-repo" data-git-blocked="not-a-repo">
        <p role="alert" className="mb-2 text-[0.9286rem] text-danger-fg">
          This folder isn&apos;t a git repository.
        </p>
        <p className="text-[0.9286rem] text-text-secondary">
          Run{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem] select-all">
            git init
          </code>{" "}
          here, or move the tracker into a repository.
        </p>
        <Button
          type="button"
          variant="secondary"
          testId="git-enable"
          disabled
          className="mt-3"
        >
          Enable git tracking
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="git-disabled">
      {!status.remoteConfigured && (
        <p
          role="alert"
          data-testid="git-no-remote"
          data-git-warning="no-remote"
          className="mb-3 text-[0.9286rem] text-warn-fg"
        >
          No git remote is set up. Git tracking stays local until you add one with{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem] select-all">
            git remote add origin &lt;url&gt;
          </code>.
        </p>
      )}

      {/*
        GIT-22: the tracker sits on a filesystem where POSIX advisory
        locks are unreliable. Surfaced *before* enabling (not only after a
        lock failure), naming the class, and — like the no-remote warning
        above — it warns rather than blocks: enable still proceeds. Absent
        `fstypeAdvisory` means a local disk or an undeterminable class, so
        no false alarm.
      */}
      {status.fstypeAdvisory !== undefined && (
        <p
          role="alert"
          data-testid="git-fstype-warning"
          data-git-warning="fstype"
          data-fs-class={status.fstypeAdvisory.fsClass}
          className="mb-3 text-[0.9286rem] text-warn-fg"
        >
          This tracker is on{" "}
          <strong>{status.fstypeAdvisory.label}</strong>, where file locking is
          unreliable. Renumbering keys during sync may fail. Move the tracker
          to a local disk to avoid this.
        </p>
      )}

      {/* GIT-1's enable-time explainer list was removed per Ken's
          always-visible-text ruling; this confirm step's container and
          controls stay — see GIT-25's adopt-or-stop decision and the
          plain confirm/cancel pair below, both still gated behind
          `confirming`. */}
      {confirming
        ? (
            <div data-testid="git-enable-confirm" className="rounded-md border border-border-subtle p-3">
              {/*
                GIT-25: a pre-existing LocTT-written branch is not an
                ordinary enable error — it is a decision. Render the
                found-branch + head and an adopt-or-stop control instead
                of the generic ErrorState, which would only show a message
                and a Retry that repeats the same refusal.
              */}
              {adoptInfo !== undefined
                ? (
                    <div
                      role="alert"
                      data-testid="git-adopt-branch"
                      data-git-decision="adopt-branch"
                      className="mb-2 rounded-md border border-warn-fg/40 bg-warn-fg/5 p-3"
                    >
                      <p className="mb-2 text-[0.9286rem] text-text-primary">
                        A{" "}
                        <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
                          {adoptInfo.branch}
                        </code>{" "}
                        branch already exists (at{" "}
                        <code
                          data-testid="git-adopt-head"
                          className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] select-all"
                        >
                          {adoptInfo.branch_head.slice(0, 12)}
                        </code>
                        ). Use it as the starting point, or choose a different
                        branch. Using it won&apos;t overwrite it.
                      </p>
                      <Button
                        type="button"
                        variant="primary"
                        testId="git-adopt-confirm-button"
                        loading={enable.isPending}
                        aria-label="Adopt existing branch"
                        onClick={() => { enable.mutate({ adopt: true }); }}
                      >
                        Adopt existing branch
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="ml-2"
                        testId="git-adopt-stop-button"
                        onClick={() => { enable.reset(); setConfirming(false); }}
                      >
                        Stop
                      </Button>
                    </div>
                  )
                : (
                    <>
                      {enable.isError && (
                        <div className="mb-2">
                          <ErrorState error={enable.error} context="enabling git sync" />
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="primary"
                        testId="git-enable-confirm-button"
                        loading={enable.isPending}
                        aria-label="Enable git tracking"
                        onClick={() => { enable.mutate(); }}
                      >
                        Enable git tracking
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="ml-2"
                        onClick={() => { setConfirming(false); }}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
            </div>
          )
        : (
            <Button
              type="button"
              variant="secondary"
              testId="git-enable"
              onClick={() => { setConfirming(true); }}
            >
              Enable git tracking
            </Button>
          )}
    </div>
  );
}

function EnabledState({ status, checkedAt, onRefresh }: {
  readonly status: GitStatus;
  readonly checkedAt: number | undefined;
  readonly onRefresh: () => void;
}) {
  const publish = useGitPublish();
  // GIT-23: the panel shows determinate progress during a large sync
  // instead of an indefinite "Syncing…". The engine streams
  // `{applied,total}` ticks; the latest one lives here and is cleared
  // when a new sync starts.
  const [syncProgress, setSyncProgress] = useState<SyncProgress | undefined>(undefined);
  const sync = useGitSync(setSyncProgress);
  const disable = useGitDisable();
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  /**
   * GIT-38: while an operation is running, both controls are disabled,
   * so a second concurrent trigger is hard to reach by misclick rather
   * than merely refused after the fact. This is per-tab state; a CLI
   * run in a terminal is invisible to it, which is why GIT-20 is
   * handled by refetching status rather than by a lock.
   */
  const busy = publish.isPending || sync.isPending;

  /**
   * GIT-18/GIT-31: the reconciliation sentinel is the source of truth for
   * whether the tracker is mid-reconcile — driven by the session query so
   * it is present on a fresh load, a reload, and a browser restart
   * (GIT-26), not only after a mutation returns 409. A 409 from either
   * operation carrying the sentinel is the same state seen from the other
   * direction; either way neither op may be presented as having
   * succeeded, and retrying is not the remedy.
   */
  const reconcileSession = useReconcileSession();
  const reconcileInProgress = reconcileSession.data?.reconcile != null;

  // GIT-21 (K93): a force-push / history-rewrite refusal is rendered as a
  // dedicated banner (not the generic ErrorState), so pull the typed payload
  // off whichever operation refused.
  const publishRewrite = historyRewritten(publish.error);
  const syncRewrite = historyRewritten(sync.error);
  const publishSchemaNewer = schemaRemoteNewer(publish.error);
  const syncSchemaNewer = schemaRemoteNewer(sync.error);
  // GIT-36: a missing/corrupt worktree is a refusal with a repair path,
  // not a retryable error — render the dedicated banner, not ErrorState.
  const publishWorktreeMissing = worktreeMissing(publish.error);
  const syncWorktreeMissing = worktreeMissing(sync.error);

  // A reconcile is "blocked" when the sentinel is present, or an op erred
  // with a reconcile code. Branch on the error CODE, not a message
  // substring: a history-rewrite refusal (GIT-21) is emphatically NOT a
  // reconcile (K93), and its message legitimately mentions merging by hand
  // — matching /reconcil/ against the text mislabelled it and hid the
  // dedicated banner (the same fragility for any future wording).
  const reconcileBlocked = reconcileInProgress || [publish.error, sync.error].some(
    e => e instanceof ApiError
      && (e.code === "reconcile_needed"
        || e.code === "reconcile_in_progress"
        // GIT-8/K92: a sync that stopped for a rekey confirm is the same
        // "resolve this before proceeding" state — the panel shows the
        // rekey preview, and publish/sync must not present as succeeded.
        || e.code === "rekey_needed"),
  );

  const localDrift = status.localChanges;
  const canPush = status.remoteConfigured;

  return (
    <div data-testid="git-enabled">
      <section className="mb-5">
        <h2 className="mb-2 text-[0.9286rem] font-semibold text-text-primary">Status</h2>
        <Row label="Branch" testId="git-branch">
          <code className="text-[0.8571rem]">{status.branch}</code>
        </Row>
        <Row label="Remote" testId="git-remote">
          {canPush
            ? <code className="text-[0.8571rem]">{status.remote}</code>
            : (
                // GIT-27: `remote` always holds a name because it
                // defaults to "origin", so the name alone would announce
                // a remote this repo does not have.
                <span data-git-remote="none" className="text-warn-fg">
                  None (local only)
                </span>
              )}
        </Row>
        <Row label="Last synced commit" testId="git-last-synced">
          <code className="text-[0.8571rem]">{short(status.lastSyncedCommit)}</code>
          {status.lastSyncedCommit === undefined && (
            <span className="ml-2 text-text-tertiary">never synced</span>
          )}
        </Row>

        {/*
          GIT-4 wants two separate drift readouts. Local drift is a real
          count. Remote drift is only a boolean in core — the branch head
          either moved or it did not — so this renders it as the boolean
          it is rather than inventing a count that would be a guess.
        */}
        <Row label="Local changes" testId="git-local-drift">
          <span data-git-local-drift={localDrift === undefined ? "unknown" : String(localDrift)}>
            {localDrift === undefined
              ? "could not determine"
              : localDrift === 0
                ? "none, nothing to publish"
                : `${String(localDrift)} file${localDrift === 1 ? "" : "s"} not yet published`}
          </span>
        </Row>
        <Row label="Remote changes" testId="git-remote-drift">
          <span
            data-git-remote-drift={
              status.remoteChanges === undefined ? "unknown" : String(status.remoteChanges)
            }
          >
            {status.remoteChanges === undefined
              ? "could not determine"
              : status.remoteChanges
                ? "the branch has moved since the last sync"
                : "none, up to date with the branch"}
          </span>
        </Row>

        {/*
          GIT-4's last bullet: a stale zero must not be mistaken for a
          fresh one, so the panel says when it last looked.
        */}
        <div className="mt-2 flex items-center gap-2 text-[0.8571rem] text-text-tertiary">
          <span data-testid="git-checked-at">
            {checkedAt === undefined
              ? "not checked yet"
              : `Last checked ${new Date(checkedAt).toLocaleTimeString()}`}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            testId="git-refresh"
            onClick={onRefresh}
          >
            Refresh
          </Button>
        </div>
      </section>

      {reconcileBlocked && (
        <p
          role="alert"
          data-testid="git-reconcile-blocked"
          data-git-blocked="reconcile-in-progress"
          className="mb-3 rounded-md border border-danger-fg p-2 text-[0.9286rem] text-danger-fg"
        >
          A reconciliation is in progress. Finish or abandon it before you
          publish or sync. Nothing was pushed.
        </p>
      )}

      {/* GIT-6, GIT-18, GIT-26: the per-field reconciliation, rendered
          whenever the sentinel is present — reachable from Settings → Sync
          without re-triggering the operation. */}
      <ReconcilePanel />

      <section className="mb-5 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          testId="git-publish"
          disabled={busy || reconcileInProgress}
          loading={publish.isPending}
          aria-label="Publish"
          onClick={() => { publish.mutate(); }}
        >
          Publish
        </Button>
        <Button
          type="button"
          variant="secondary"
          testId="git-sync"
          disabled={busy || reconcileInProgress}
          loading={sync.isPending}
          aria-label="Sync"
          onClick={() => { setSyncProgress(undefined); sync.mutate(); }}
        >
          Sync
        </Button>
      </section>

      {/*
        GIT-23 bullet 1: a large sync reports progress rather than sitting
        on an indefinite spinner. The engine streams `{applied,total}`
        ticks once it starts writing files; a small sync (or the read-only
        planning phase) emits none, so this only appears when there is
        real progress to show — an indefinite spinner is exactly what it
        replaces. `role=progressbar` with the aria value attributes makes
        it a real, announced progress control, not a decorative bar.
      */}
      {sync.isPending && syncProgress !== undefined && syncProgress.total > 0 && (
        <div className="mb-3" data-testid="git-sync-progress">
          <div
            role="progressbar"
            aria-label="Applying synced files"
            aria-valuemin={0}
            aria-valuemax={syncProgress.total}
            aria-valuenow={syncProgress.applied}
            data-git-sync-applied={String(syncProgress.applied)}
            data-git-sync-total={String(syncProgress.total)}
            className="h-2 w-full overflow-hidden rounded bg-bg-muted"
          >
            <div
              className="h-full bg-accent"
              style={{
                width: `${String(Math.round((syncProgress.applied / syncProgress.total) * 100))}%`,
              }}
            />
          </div>
          <p className="mt-1 text-[0.8571rem] text-text-secondary">
            Applying {syncProgress.applied} of {syncProgress.total} files…
          </p>
        </div>
      )}

      {/*
        GIT-2/GIT-24: "nothing to publish" is a distinct outcome from a
        successful push, not the same success message. `committed:false`
        is exactly that signal, and it is also what a gitignored-only
        change produces — no empty commit is created.
      */}
      {publish.isSuccess && !reconcileBlocked && (
        <div
          data-testid="git-publish-result"
          data-git-publish={publish.data.committed ? "committed" : "nothing-to-publish"}
          data-push-failure={publish.data.pushFailure?.kind}
          className="mb-3 text-[0.9286rem] text-text-secondary"
        >
          <p>
            {!publish.data.committed
              ? "Nothing to publish. Local state already matches the branch."
              : publish.data.pushed === true
                ? `Published to ${status.remote}/${publish.data.branch}.`
                : publish.data.pushFailure !== undefined
                  ? publishFailureLine(publish.data.branch, publish.data.pushFailure)
                  : publish.data.pushError !== undefined
                    ? `Committed to ${publish.data.branch} locally, but the push failed: ${publish.data.pushError}.`
                    : `Committed to ${publish.data.branch} locally. Not pushed: no remote is set up.`}
          </p>
          {/* GIT-29: the push failed but the local commit landed — this is
              not a permanent error state. Offer Retry, and for a
              non-fast-forward rejection recommend Sync first (which merges
              the remote work in) over a bare retry that would fail again. */}
          {publish.data.pushFailure !== undefined && (
            <div className="mt-2 flex gap-2">
              {publish.data.pushFailure.kind === "non_fast_forward" && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  testId="git-publish-sync-first"
                  disabled={busy || reconcileInProgress}
                  onClick={() => { sync.mutate(); }}
                >
                  Sync first
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                testId="git-publish-retry"
                disabled={busy || reconcileInProgress}
                onClick={() => { publish.mutate(); }}
              >
                Retry push
              </Button>
            </div>
          )}
        </div>
      )}

      {/*
        GIT-3: core reports file counts, not created-vs-updated task
        keys — `plan.copies` is one bucket covering both. So this states
        counts of files honestly rather than claiming a distinction the
        data cannot support.
      */}
      {sync.isSuccess && !reconcileBlocked && (
        <div
          data-testid="git-sync-result"
          data-git-sync={sync.data.updated ? "updated" : "no-op"}
          data-fetch-failure={sync.data.fetchFailure?.kind}
          className="mb-3 text-[0.9286rem] text-text-secondary"
        >
          <p>
            {sync.data.updated
              ? `Synced: ${String(sync.data.copied ?? 0)} file(s) taken from the branch, `
                + `${String(sync.data.merged ?? 0)} merged, ${String(sync.data.deleted ?? 0)} removed.`
              : "Already up to date. The branch has not moved since the last sync."}
            {/* GIT-30: name the remote and say it could not be reached,
                distinguishing this from "nothing to sync", and state
                explicitly that local state is untouched. */}
            {sync.data.fetchError !== undefined && (
              <span className="ml-1 text-warn-fg" data-testid="git-sync-fetch-warning">
                {sync.data.fetchFailure !== undefined
                  ? `The remote "${sync.data.fetchFailure.remote}" ${fetchFailureClause(sync.data.fetchFailure)}, `
                  : `The remote could not be reached (${sync.data.fetchError}), `}
                so only the local copy was compared. Your task files weren&apos;t
                changed.
              </span>
            )}
            {sync.data.unresolvedKeys !== undefined && sync.data.unresolvedKeys.length > 0 && (
              <span className="ml-1 text-warn-fg">
                Unresolved keys: {sync.data.unresolvedKeys.join(", ")}.
              </span>
            )}
          </p>

          {/*
            GIT-34: the branch published a task whose task.md will not parse.
            The rest of the sync was applied (the counts above say what), and
            this file was NOT silently absorbed — name each bad task by id
            and give the exact path to inspect. The list still renders it as
            a broken-file row, so the next action is to open that file.
          */}
          {sync.data.malformed !== undefined && sync.data.malformed.length > 0 && (
            <div
              role="alert"
              data-testid="git-sync-malformed"
              data-malformed-count={sync.data.malformed.length}
              className="mb-1 rounded-md border border-warn-fg p-2 text-[0.8571rem] text-warn-fg"
            >
              <p className="font-semibold">
                {sync.data.malformed.length === 1
                  ? "1 synced task couldn't be read."
                  : `${String(sync.data.malformed.length)} synced tasks couldn't be read.`}
              </p>
              <p className="mt-1 text-text-secondary">
                The rest of the sync was applied. Open each file below to fix it:
              </p>
              <ul className="mt-1 ml-4 list-disc" data-testid="git-sync-malformed-list">
                {sync.data.malformed.map(m => (
                  <li key={m.id} data-task-id={m.id}>
                    <code className="text-[0.8571rem]">{m.path}</code>
                    {": "}
                    <span className="text-text-secondary">{m.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            GIT-23 bullet 2: the summary above states counts and never
            enumerates every affected task inline — a 500-task sync must
            not print 500 keys. The full per-bucket breakdown is offered
            on expand instead. Core reports file counts, not per-task keys
            (see the GIT-3 note above), so the expandable detail is the
            honest thing the data supports: the count by category, and a
            pointer to the list view — which now reflects the new
            population (the sync invalidated its query). Collapsed by
            default via native `<details>`, keyboard-operable for free —
            now through the shared `Disclosure` primitive, which kills the
            browser's `▸` marker and draws our own caret. This summary
            used to be `text-accent`; it is now the canonical neutral
            tertiary, because accent is the link colour and an
            expand-in-place control is not a navigation.
          */}
          {sync.data.updated && (
            <Disclosure
              className="mb-1"
              data-testid="git-sync-details"
              summary="Show full breakdown"
            >
              <ul className="mt-1 ml-4 list-disc text-[0.8571rem] text-text-secondary" data-testid="git-sync-breakdown">
                <li>{sync.data.copied ?? 0} taken from the branch (created or updated)</li>
                <li>{sync.data.merged ?? 0} merged field-by-field</li>
                <li>{sync.data.deleted ?? 0} removed locally</li>
                <li>{sync.data.kept ?? 0} left unchanged</li>
                {(sync.data.rekeyed ?? 0) > 0 && (
                  <li>{sync.data.rekeyed} renumbered to resolve a key collision</li>
                )}
                {(sync.data.reprefixed ?? 0) > 0 && (
                  <li>{sync.data.reprefixed} given a provisional project prefix</li>
                )}
              </ul>
              <p className="mt-1 ml-4 text-[0.8571rem] text-text-tertiary">
                The synced tasks appear in the list, which now shows the
                updated total.
              </p>
            </Disclosure>
          )}
          {/* GIT-30: not a permanent error state — offer Retry inline so
              the user does not have to reload after the network returns. */}
          {sync.data.fetchError !== undefined && (
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                testId="git-sync-retry"
                disabled={busy || reconcileInProgress}
                onClick={() => { sync.mutate(); }}
              >
                Retry sync
              </Button>
            </div>
          )}
        </div>
      )}

      {publish.isError && !reconcileBlocked && (
        publishRewrite !== undefined
          ? (
              // GIT-21 (K93): a rewritten history is a refusal, not a
              // retryable error — render the dedicated banner, never the
              // generic ErrorState with its Retry control.
              <HistoryRewrittenRefusal info={publishRewrite} testId="git-publish-history-rewritten" />
            )
          : publishSchemaNewer !== undefined
          ? (
              // GIT-35 (K94): a newer-remote-schema branch is a refusal, not
              // a retryable error — upgrade LocTT, no Retry control.
              <SchemaRemoteNewerRefusal info={publishSchemaNewer} testId="git-publish-schema-newer" />
            )
          : publishWorktreeMissing !== undefined
          ? (
              // GIT-36: a missing/corrupt worktree names the worktree and a
              // repair path — no Retry, local files untouched.
              <WorktreeMissingRefusal info={publishWorktreeMissing} testId="git-publish-worktree-missing" />
            )
          : (
              <div className="mb-3" data-testid="git-publish-error">
                <ErrorState
                  error={publish.error}
                  onRetry={() => { publish.mutate(); }}
                  context="publishing to the git branch"
                />
                <p className="mt-1 text-[0.9286rem] text-text-secondary">
                  Your local task files were not modified by the failed publish.
                </p>
              </div>
            )
      )}

      {sync.isError && !reconcileBlocked && (
        syncRewrite !== undefined
          ? (
              <HistoryRewrittenRefusal info={syncRewrite} testId="git-sync-history-rewritten" />
            )
          : syncSchemaNewer !== undefined
          ? (
              <SchemaRemoteNewerRefusal info={syncSchemaNewer} testId="git-sync-schema-newer" />
            )
          : syncWorktreeMissing !== undefined
          ? (
              // GIT-36: a missing/corrupt worktree names the worktree and a
              // repair path — no Retry, local files untouched.
              <WorktreeMissingRefusal info={syncWorktreeMissing} testId="git-sync-worktree-missing" />
            )
          : (
              <div className="mb-3" data-testid="git-sync-error">
                <ErrorState
                  error={sync.error}
                  onRetry={() => { sync.mutate(); }}
                  context="syncing from the git branch"
                />
                <p className="mt-1 text-[0.9286rem] text-text-secondary">
                  Your local task files were not modified by the failed sync.
                </p>
              </div>
            )
      )}

      <section>
        <h2 className="mb-2 text-[0.9286rem] font-semibold text-text-primary">Disable</h2>
        {confirmingDisable
          ? (
              <div data-testid="git-disable-confirm" className="rounded-md border border-border-subtle p-3">
                {/*
                  GIT-10: state what disabling does *and does not* do.
                  "Disable" next to a branch name reads like a delete
                  unless it explicitly says the branch survives.
                */}
                <p className="mb-2 text-[0.9286rem] text-text-secondary">
                  Disabling stops publishing and syncing. The{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
                    {status.branch}
                  </code>{" "}
                  branch and its history are kept, and no task files change.
                  Re-enabling picks up where you left off.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  testId="git-disable-confirm-button"
                  loading={disable.isPending}
                  aria-label="Disable git sync"
                  onClick={() => { disable.mutate(); }}
                >
                  Disable git sync
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="ml-2"
                  onClick={() => { setConfirmingDisable(false); }}
                >
                  Cancel
                </Button>
                {/* A328 (B6): a timed-out or rejected Disable used to do
                    nothing visible — the confirm box just sat there. The
                    notice names the outcome and offers Try again; the box
                    stays open either way, since the user has not left it. */}
                {disable.isError && (
                  <InlineFailureNotice
                    testId="git-disable-error"
                    message={disableFailureMessage(disable.error)}
                    dataState={dataStateOf(disable.error)}
                    onRetry={() => { disable.mutate(); }}
                  />
                )}
              </div>
            )
          : (
              <Button
                type="button"
                variant="secondary"
                testId="git-disable"
                onClick={() => { setConfirmingDisable(true); }}
              >
                Disable git sync
              </Button>
            )}
      </section>
    </div>
  );
}

export function GitSyncPanel() {
  const status = useGitStatus();
  // GIT-25: the agreement report from a just-completed adopt. Lifted here
  // so it survives the panel flipping from disabled to enabled once status
  // refetches — the user must see whether a sync is needed after adopting,
  // and that outlives the DisabledState that triggered it.
  const [adoptReport, setAdoptReport] = useState<
    { readonly branch: string; readonly inAgreement: boolean | null } | undefined
  >(undefined);

  return (
    <div data-testid="git-panel">
      <h1 data-testid="settings-panel-title" className="mb-2 text-lg font-semibold text-text-primary">
        Sync
      </h1>

      {status.isError && (
        <ErrorState
          error={status.error}
          onRetry={() => { void status.refetch(); }}
          context="reading git status"
        />
      )}

      {!status.isError && status.isLoading && (
        <p className="text-[0.9286rem] text-text-tertiary">Reading git status…</p>
      )}

      {/*
        `unreadable` outranks everything else in the payload: when
        sync.yaml exists and will not parse, `enabled: false` is a
        default rather than a reading. Rendering the disabled state here
        would invite the user to re-enable, which overwrites the very
        state that needs recovering.
      */}
      {status.data?.unreadable !== undefined && (
        <div role="alert" data-testid="git-status-unreadable" data-git-status="unreadable">
          <p className="mb-2 text-[0.9286rem] text-danger-fg">
            Couldn&apos;t read git sync settings (
            <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
              {status.data.unreadable.path}
            </code>
            : {status.data.unreadable.reason}).
          </p>
          <p className="text-[0.9286rem] text-text-secondary">
            Fix or restore the file, then refresh. Don&apos;t re-enable git
            tracking, as that would overwrite it.
          </p>
        </div>
      )}

      {/*
        GIT-25: after adopting an existing branch, report whether local
        agrees with it so the user knows if a sync is needed. Rendered
        above the enabled/disabled body so it persists across the flip.
      */}
      {adoptReport !== undefined && (
        <div
          role="status"
          data-testid="git-adopt-report"
          data-in-agreement={adoptReport.inAgreement === null ? "unknown" : String(adoptReport.inAgreement)}
          className="mb-3 rounded-md border border-border-subtle bg-bg-muted p-3 text-[0.9286rem] text-text-secondary"
        >
          Adopted the existing{" "}
          <code className="rounded bg-bg-canvas px-1 py-0.5 text-[0.8571rem]">
            {adoptReport.branch}
          </code>{" "}
          branch as the sync baseline.{" "}
          {adoptReport.inAgreement === true
            ? "Local state agrees with it. No sync needed."
            : adoptReport.inAgreement === false
              ? "Local state differs from it. Run Sync to reconcile."
              : "Whether local state agrees could not be determined."}
        </div>
      )}

      {status.data !== undefined && status.data.unreadable === undefined && (
        status.data.enabled
          ? (
              <EnabledState
                status={status.data}
                checkedAt={status.dataUpdatedAt}
                onRefresh={() => { void status.refetch(); }}
              />
            )
          : (
              <DisabledState
                status={status.data}
                onAdopted={(report) => { setAdoptReport(report); }}
              />
            )
      )}
    </div>
  );
}
