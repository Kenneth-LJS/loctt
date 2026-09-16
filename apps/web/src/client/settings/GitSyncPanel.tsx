import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  type GitRemoteFailure,
  type GitStatus,
  useGitDisable,
  useGitEnable,
  useGitPublish,
  useGitStatus,
  useGitSync,
  useReconcileSession,
} from "../api/hooks/useGit.ts";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { ReconcilePanel } from "./ReconcilePanel.tsx";

/**
 * The sentence a failed push shows (GIT-29). Every branch states the
 * local commit is safe — the push failed, not the commit — and names the
 * remote; the non-fast-forward branch recommends Sync, the auth branch
 * points at credentials, distinguishing the two causes.
 */
export function publishFailureLine(branch: string, failure: GitRemoteFailure): string {
  const safe = "The commit is safe locally; your work was not lost.";
  switch (failure.kind) {
    case "non_fast_forward":
      return (
        `Committed to ${branch}, but the push was rejected: the remote "${failure.remote}" `
        + `has moved on since your last sync. ${safe} Sync first to bring in the remote work, then publish again.`
      );
    case "auth":
      return (
        `Committed to ${branch}, but the push failed authenticating to "${failure.remote}" `
        + `(${failure.detail}). ${safe} Check your git credentials, then retry.`
      );
    case "unreachable":
      return (
        `Committed to ${branch}, but the remote "${failure.remote}" could not be reached `
        + `(${failure.detail}). ${safe} Retry once the remote is reachable.`
      );
    default:
      return `Committed to ${branch}, but the push failed: ${failure.detail}. ${safe}`;
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
 * error state. The residual conflict-resolution cases still unbuilt are
 * GIT-8/16/19/21/22/23/25/33/34/35/36; the rest of the GIT-* range is
 * built and tested.
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
function DisabledState({ status }: { readonly status: GitStatus }) {
  const enable = useGitEnable();
  const [confirming, setConfirming] = useState(false);

  if (!status.isGitRepo) {
    return (
      <div data-testid="git-not-a-repo" data-git-blocked="not-a-repo">
        <p className="mb-2 text-[0.9286rem] text-text-secondary">
          Git sync is off. LocTT works fully without it — it stores tasks as
          files either way.
        </p>
        <p role="alert" className="mb-2 text-[0.9286rem] text-danger-fg">
          This directory is not a git repository, so git sync cannot be
          enabled here.
        </p>
        <p className="text-[0.9286rem] text-text-secondary">
          Run{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem] select-all">
            git init
          </code>{" "}
          in the tracker&apos;s directory, or move the tracker into a repository
          that already exists. Nothing has been created by this check.
        </p>
        <Button
          type="button"
          variant="secondary"
          testId="git-enable"
          disabled
          className="mt-3"
        >
          Enable git sync
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="git-disabled">
      <p className="mb-3 text-[0.9286rem] text-text-secondary">
        Git sync is off. LocTT works fully without it — it stores tasks as
        files either way.
      </p>

      {!status.remoteConfigured && (
        <p
          role="alert"
          data-testid="git-no-remote"
          data-git-warning="no-remote"
          className="mb-3 text-[0.9286rem] text-warn-fg"
        >
          This repository has no remote configured. Git sync can still be
          enabled, and the panel will show it as local-only: commits land on
          the branch, but there is nowhere to push them. Add one with{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem] select-all">
            git remote add origin &lt;url&gt;
          </code>{" "}
          to publish.
        </p>
      )}

      {/*
        GIT-1: Enable states what it will do *before* running, and the
        gitignore guarantee is part of that statement — a user needs to
        know their theme and current-user file are not about to be
        published to a shared branch.
      */}
      {confirming
        ? (
            <div data-testid="git-enable-confirm" className="rounded-md border border-border-subtle p-3">
              <p className="mb-2 text-[0.9286rem] text-text-primary">Enabling git sync will:</p>
              <ul className="mb-3 ml-4 list-disc text-[0.9286rem] text-text-secondary">
                <li>
                  create a dedicated{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">
                    {status.branch}
                  </code>{" "}
                  branch, published through a temporary worktree so your
                  working tree and current branch are never switched;
                </li>
                <li>
                  publish the tracker&apos;s task and config files to that branch;
                </li>
                <li>
                  leave{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">local/</code>,{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">.current-user</code>{" "}
                  and{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">
                    users/&lt;id&gt;/settings.yaml
                  </code>{" "}
                  gitignored — they are never published.
                </li>
              </ul>
              {enable.isError && (
                <div className="mb-2">
                  <ErrorState error={enable.error} context="enabling git sync" />
                </div>
              )}
              <Button
                type="button"
                variant="primary"
                testId="git-enable-confirm-button"
                disabled={enable.isPending}
                onClick={() => { enable.mutate(); }}
              >
                {enable.isPending ? "Enabling…" : "Enable git sync"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="ml-2"
                onClick={() => { setConfirming(false); }}
              >
                Cancel
              </Button>
            </div>
          )
        : (
            <Button
              type="button"
              variant="secondary"
              testId="git-enable"
              onClick={() => { setConfirming(true); }}
            >
              Enable git sync
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
  const sync = useGitSync();
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
  const reconcileBlocked = reconcileInProgress || [publish.error, sync.error].some(
    e => e instanceof ApiError && /reconcil/i.test(e.message),
  );

  const localDrift = status.localChanges;
  const canPush = status.remoteConfigured;

  return (
    <div data-testid="git-enabled">
      <section className="mb-5">
        <h2 className="mb-2 text-[0.9286rem] font-semibold text-text-primary">Status</h2>
        <Row label="Branch" testId="git-branch">
          <code className="font-mono text-[0.8571rem]">{status.branch}</code>
        </Row>
        <Row label="Remote" testId="git-remote">
          {canPush
            ? <code className="font-mono text-[0.8571rem]">{status.remote}</code>
            : (
                // GIT-27: `remote` always holds a name because it
                // defaults to "origin", so the name alone would announce
                // a remote this repo does not have.
                <span data-git-remote="none" className="text-warn-fg">
                  none configured — local-only
                </span>
              )}
        </Row>
        <Row label="Last synced commit" testId="git-last-synced">
          <code className="font-mono text-[0.8571rem]">{short(status.lastSyncedCommit)}</code>
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
                ? "none — nothing to publish"
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
                : "none — up to date with the branch"}
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
          A reconciliation is already in progress for this tracker. Publish and
          sync are blocked until it is finished or abandoned — neither ran, and
          nothing was pushed. Resolve it below, or abandon it, before retrying.
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
          onClick={() => { publish.mutate(); }}
        >
          {publish.isPending ? "Publishing…" : "Publish"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          testId="git-sync"
          disabled={busy || reconcileInProgress}
          onClick={() => { sync.mutate(); }}
        >
          {sync.isPending ? "Syncing…" : "Sync"}
        </Button>
      </section>

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
              ? "Nothing to publish — local state already matches the branch."
              : publish.data.pushed === true
                ? `Published to ${status.remote}/${publish.data.branch}.`
                : publish.data.pushFailure !== undefined
                  ? publishFailureLine(publish.data.branch, publish.data.pushFailure)
                  : publish.data.pushError !== undefined
                    ? `Committed to ${publish.data.branch}, but the push failed: ${publish.data.pushError}. The commit is safe locally; your work was not lost.`
                    : `Committed to ${publish.data.branch}. Not pushed — no remote is configured.`}
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
              : "Already up to date — the branch has not moved since the last sync."}
            {/* GIT-30: name the remote and say it could not be reached,
                distinguishing this from "nothing to sync", and state
                explicitly that local state is untouched. */}
            {sync.data.fetchError !== undefined && (
              <span className="ml-1 text-warn-fg" data-testid="git-sync-fetch-warning">
                {sync.data.fetchFailure !== undefined
                  ? `The remote "${sync.data.fetchFailure.remote}" ${fetchFailureClause(sync.data.fetchFailure)}, `
                  : `The remote could not be reached (${sync.data.fetchError}), `}
                so this compared against the local copy of the branch only. Your
                local task files were not modified.
              </span>
            )}
            {sync.data.unresolvedKeys !== undefined && sync.data.unresolvedKeys.length > 0 && (
              <span className="ml-1 text-warn-fg">
                Unresolved keys: {sync.data.unresolvedKeys.join(", ")}.
              </span>
            )}
          </p>
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
      )}

      {sync.isError && !reconcileBlocked && (
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
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">
                    {status.branch}
                  </code>{" "}
                  branch and its full history are <strong>left intact</strong> —
                  nothing is deleted, and no task file is modified. Re-enabling
                  later picks up from the commit already recorded.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  testId="git-disable-confirm-button"
                  disabled={disable.isPending}
                  onClick={() => { disable.mutate(); }}
                >
                  {disable.isPending ? "Disabling…" : "Disable git sync"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="ml-2"
                  onClick={() => { setConfirmingDisable(false); }}
                >
                  Cancel
                </Button>
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

  return (
    <div className="p-8" data-testid="git-panel">
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        Sync
      </h1>
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        Git-backed mode publishes this tracker&apos;s files to a dedicated
        branch so other clones can sync them.
      </p>

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
            Git sync settings could not be read, so this panel cannot report
            whether git mode is on.
          </p>
          <p className="text-[0.9286rem] text-text-secondary">
            <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">
              {status.data.unreadable.path}
            </code>{" "}
            — {status.data.unreadable.reason}. Fix or restore that file and
            refresh. Do not re-enable git sync: that would overwrite it.
          </p>
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
          : <DisabledState status={status.data} />
      )}
    </div>
  );
}
