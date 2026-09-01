import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  type GitStatus,
  useGitDisable,
  useGitEnable,
  useGitPublish,
  useGitStatus,
  useGitSync,
} from "../api/hooks/useGit.ts";
import { ErrorState } from "../ui/ErrorState.tsx";

/**
 * Settings → Tracker → Sync (GIT-1..GIT-4, GIT-10, GIT-20, GIT-24,
 * GIT-27, GIT-28, GIT-30, GIT-38).
 *
 * What this panel deliberately does **not** contain: a reconciliation
 * UI. `local/reconcile.yaml` is a four-field crash sentinel — `mode`,
 * `base_commit`, `remote_commit`, `started_at`, under a `.strict()`
 * schema — with no per-task rows, no per-field decisions, and no core
 * function that applies a choice. `GitConflictError` carries a flat
 * array of file *paths*. So the conflict-resolution cases (GIT-5..9,
 * GIT-11..19, GIT-21, GIT-25, GIT-26, GIT-31..37) have no data to
 * render and no engine to drive; see decisions.md A68. What this panel
 * does do for that state is GIT-18's first duty: detect that a
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
    <div className="flex gap-3 border-b border-border-subtle py-1.5 text-[13px] last:border-0">
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
        <p className="mb-2 text-[13px] text-text-secondary">
          Git sync is off. LocTT works fully without it — it stores tasks as
          files either way.
        </p>
        <p role="alert" className="mb-2 text-[13px] text-status-danger">
          This directory is not a git repository, so git sync cannot be
          enabled here.
        </p>
        <p className="text-[13px] text-text-secondary">
          Run{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] select-all">
            git init
          </code>{" "}
          in the tracker&apos;s directory, or move the tracker into a repository
          that already exists. Nothing has been created by this check.
        </p>
        <button
          type="button"
          data-testid="git-enable"
          disabled
          className="mt-3 rounded-md border border-border-subtle px-3 py-1.5 text-[13px] opacity-50"
        >
          Enable git sync
        </button>
      </div>
    );
  }

  return (
    <div data-testid="git-disabled">
      <p className="mb-3 text-[13px] text-text-secondary">
        Git sync is off. LocTT works fully without it — it stores tasks as
        files either way.
      </p>

      {!status.remoteConfigured && (
        <p
          role="alert"
          data-testid="git-no-remote"
          data-git-warning="no-remote"
          className="mb-3 text-[13px] text-status-warn"
        >
          This repository has no remote configured. Git sync can still be
          enabled, and the panel will show it as local-only: commits land on
          the branch, but there is nowhere to push them. Add one with{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] select-all">
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
              <p className="mb-2 text-[13px] text-text-primary">Enabling git sync will:</p>
              <ul className="mb-3 ml-4 list-disc text-[13px] text-text-secondary">
                <li>
                  create a dedicated{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
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
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">local/</code>,{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">.current-user</code>{" "}
                  and{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
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
              <button
                type="button"
                data-testid="git-enable-confirm-button"
                disabled={enable.isPending}
                onClick={() => { enable.mutate(); }}
                className="rounded-md bg-accent px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
              >
                {enable.isPending ? "Enabling…" : "Enable git sync"}
              </button>
              <button
                type="button"
                onClick={() => { setConfirming(false); }}
                className="ml-2 rounded-md border border-border-subtle px-3 py-1.5 text-[13px]"
              >
                Cancel
              </button>
            </div>
          )
        : (
            <button
              type="button"
              data-testid="git-enable"
              onClick={() => { setConfirming(true); }}
              className="rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-[13px]"
            >
              Enable git sync
            </button>
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
   * GIT-18/GIT-31: a 409 from either operation carrying the
   * reconciliation sentinel means the tracker is mid-reconcile. Neither
   * operation may be presented as having succeeded, and retrying is not
   * the remedy — the file has to be dealt with first.
   */
  const reconcileBlocked = [publish.error, sync.error].some(
    e => e instanceof ApiError && /reconcil/i.test(e.message),
  );

  const localDrift = status.localChanges;
  const canPush = status.remoteConfigured;

  return (
    <div data-testid="git-enabled">
      <section className="mb-5">
        <h2 className="mb-2 text-[13px] font-semibold text-text-primary">Status</h2>
        <Row label="Branch" testId="git-branch">
          <code className="font-mono text-[12px]">{status.branch}</code>
        </Row>
        <Row label="Remote" testId="git-remote">
          {canPush
            ? <code className="font-mono text-[12px]">{status.remote}</code>
            : (
                // GIT-27: `remote` always holds a name because it
                // defaults to "origin", so the name alone would announce
                // a remote this repo does not have.
                <span data-git-remote="none" className="text-status-warn">
                  none configured — local-only
                </span>
              )}
        </Row>
        <Row label="Last synced commit" testId="git-last-synced">
          <code className="font-mono text-[12px]">{short(status.lastSyncedCommit)}</code>
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
        <div className="mt-2 flex items-center gap-2 text-[12px] text-text-tertiary">
          <span data-testid="git-checked-at">
            {checkedAt === undefined
              ? "not checked yet"
              : `Last checked ${new Date(checkedAt).toLocaleTimeString()}`}
          </span>
          <button
            type="button"
            data-testid="git-refresh"
            onClick={onRefresh}
            className="rounded border border-border-subtle px-2 py-0.5"
          >
            Refresh
          </button>
        </div>
      </section>

      {reconcileBlocked && (
        <p
          role="alert"
          data-testid="git-reconcile-blocked"
          data-git-blocked="reconcile-in-progress"
          className="mb-3 rounded-md border border-status-danger p-2 text-[13px] text-status-danger"
        >
          A reconciliation is already in progress for this tracker. Publish and
          sync are blocked until it is finished or abandoned — neither ran, and
          nothing was pushed. Resolve{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] select-all">
            .loctt/local/reconcile.yaml
          </code>{" "}
          before retrying.
        </p>
      )}

      <section className="mb-5 flex gap-2">
        <button
          type="button"
          data-testid="git-publish"
          disabled={busy}
          onClick={() => { publish.mutate(); }}
          className="rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-[13px] disabled:opacity-50"
        >
          {publish.isPending ? "Publishing…" : "Publish"}
        </button>
        <button
          type="button"
          data-testid="git-sync"
          disabled={busy}
          onClick={() => { sync.mutate(); }}
          className="rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-[13px] disabled:opacity-50"
        >
          {sync.isPending ? "Syncing…" : "Sync"}
        </button>
      </section>

      {/*
        GIT-2/GIT-24: "nothing to publish" is a distinct outcome from a
        successful push, not the same success message. `committed:false`
        is exactly that signal, and it is also what a gitignored-only
        change produces — no empty commit is created.
      */}
      {publish.isSuccess && !reconcileBlocked && (
        <p
          data-testid="git-publish-result"
          data-git-publish={publish.data.committed ? "committed" : "nothing-to-publish"}
          className="mb-3 text-[13px] text-text-secondary"
        >
          {!publish.data.committed
            ? "Nothing to publish — local state already matches the branch."
            : publish.data.pushed === true
              ? `Published to ${status.remote}/${publish.data.branch}.`
              : publish.data.pushError !== undefined
                ? `Committed to ${publish.data.branch}, but the push failed: ${publish.data.pushError}. The commit is safe locally; your work was not lost.`
                : `Committed to ${publish.data.branch}. Not pushed — no remote is configured.`}
        </p>
      )}

      {/*
        GIT-3: core reports file counts, not created-vs-updated task
        keys — `plan.copies` is one bucket covering both. So this states
        counts of files honestly rather than claiming a distinction the
        data cannot support.
      */}
      {sync.isSuccess && !reconcileBlocked && (
        <p
          data-testid="git-sync-result"
          data-git-sync={sync.data.updated ? "updated" : "no-op"}
          className="mb-3 text-[13px] text-text-secondary"
        >
          {sync.data.updated
            ? `Synced: ${String(sync.data.copied ?? 0)} file(s) taken from the branch, `
              + `${String(sync.data.merged ?? 0)} merged, ${String(sync.data.deleted ?? 0)} removed.`
            : "Already up to date — the branch has not moved since the last sync."}
          {sync.data.fetchError !== undefined && (
            <span className="ml-1 text-status-warn">
              The remote could not be reached ({sync.data.fetchError}), so this
              compared against the local copy of the branch only.
            </span>
          )}
          {sync.data.unresolvedKeys !== undefined && sync.data.unresolvedKeys.length > 0 && (
            <span className="ml-1 text-status-warn">
              Unresolved keys: {sync.data.unresolvedKeys.join(", ")}.
            </span>
          )}
        </p>
      )}

      {publish.isError && !reconcileBlocked && (
        <div className="mb-3" data-testid="git-publish-error">
          <ErrorState
            error={publish.error}
            onRetry={() => { publish.mutate(); }}
            context="publishing to the git branch"
          />
          <p className="mt-1 text-[13px] text-text-secondary">
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
          <p className="mt-1 text-[13px] text-text-secondary">
            Your local task files were not modified by the failed sync.
          </p>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-[13px] font-semibold text-text-primary">Disable</h2>
        {confirmingDisable
          ? (
              <div data-testid="git-disable-confirm" className="rounded-md border border-border-subtle p-3">
                {/*
                  GIT-10: state what disabling does *and does not* do.
                  "Disable" next to a branch name reads like a delete
                  unless it explicitly says the branch survives.
                */}
                <p className="mb-2 text-[13px] text-text-secondary">
                  Disabling stops publishing and syncing. The{" "}
                  <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
                    {status.branch}
                  </code>{" "}
                  branch and its full history are <strong>left intact</strong> —
                  nothing is deleted, and no task file is modified. Re-enabling
                  later picks up from the commit already recorded.
                </p>
                <button
                  type="button"
                  data-testid="git-disable-confirm-button"
                  disabled={disable.isPending}
                  onClick={() => { disable.mutate(); }}
                  className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px] disabled:opacity-50"
                >
                  {disable.isPending ? "Disabling…" : "Disable git sync"}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmingDisable(false); }}
                  className="ml-2 rounded-md border border-border-subtle px-3 py-1.5 text-[13px]"
                >
                  Cancel
                </button>
              </div>
            )
          : (
              <button
                type="button"
                data-testid="git-disable"
                onClick={() => { setConfirmingDisable(true); }}
                className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px]"
              >
                Disable git sync
              </button>
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
      <p className="mb-4 text-[13px] text-text-secondary">
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
        <p className="text-[13px] text-text-tertiary">Reading git status…</p>
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
          <p className="mb-2 text-[13px] text-status-danger">
            Git sync settings could not be read, so this panel cannot report
            whether git mode is on.
          </p>
          <p className="text-[13px] text-text-secondary">
            <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px]">
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
