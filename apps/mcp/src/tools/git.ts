/**
 * Git-backed-mode lifecycle and sync tools. Five tools cover the
 * one-time setup pair (enable_git / disable_git), status read, and
 * the two sync directions (publish_to_git / sync_from_git).
 *
 * `publish_to_git` and `sync_from_git` mix outcomes — local commit
 * vs. remote push, fetch success vs. fetch error — so we assemble
 * the human-readable lines here rather than dumping the structured
 * result; this matches the legacy in-file handler exactly.
 */

import {
  disableGit,
  enableGit,
  getGitStatus,
  GitHistoryRewrittenError,
  GitReconcileNeededError,
  GitRemoteSchemaNewerError,
  GitSyncFirstError,
  GitWorktreeMissingError,
  loadReconcileSession,
  publish,
  sync,
} from "@loctt/core";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "enable_git",
    description: "Enables git-backed mode for this tracker: records the configuration that publish and sync use. The branch itself is created on the first publish, not here. Refuses if the configured branch already exists and holds content LocTT did not write. Only call when the user has explicitly asked to share tasks across machines or set up sync — this is one-time infrastructure setup, not a routine task operation.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      const result = await enableGit(locttDir, root);
      // GIT-22: warn — do not block. Enable succeeded; if the tracker is
      // on a filesystem where advisory locks are unreliable, name the
      // class so the agent can tell the user before they rely on sync.
      if (result.fstypeAdvisory !== undefined) {
        return text(`Git-backed mode enabled\n\nWarning: ${result.fstypeAdvisory.message}`);
      }
      return text("Git-backed mode enabled");
    },
  },
  {
    name: "disable_git",
    description: "Disables git-backed mode for this tracker. Local task data is preserved.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      await disableGit(locttDir);
      return text("Git-backed mode disabled");
    },
  },
  {
    name: "get_git_status",
    description: "Returns structured JSON describing git-backed mode state (enabled, branch, remote, remote_configured, auto_push, auto_fetch, in_git_repo, last_synced_commit) plus drift in both directions: local_changes (files not yet published) and remote_changes (whether the branch moved since the last sync). Both drift fields are null when they could not be determined, which is not the same as zero. Also carries fstype_advisory: non-null (with fs_class and message) when the tracker sits on a filesystem where POSIX advisory locks are unreliable (iCloud Drive, Dropbox, OneDrive, NFS, SMB), null otherwise — informational, never blocking.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      const status = await getGitStatus(locttDir, root);
      // Every field below is a default rather than a reading when
      // sync.yaml could not be read. `enabled: false` is a plausible
      // answer, so an agent acts on it — re-enabling git mode, or
      // skipping a publish — over state nobody checked.
      if (status.unreadable) {
        return errorResult(
          `${status.unreadable.reason}\n\n`
          + "Git mode status is unknown — this is not the same as git mode being disabled. "
          + "Do not enable git mode or publish until this file can be read.",
        );
      }
      const result = {
        enabled: status.enabled,
        branch: status.branch,
        remote: status.remote,
        // `remote` always holds a name (it defaults to `origin`), so an
        // agent reading only that would report a remote on a repo with
        // none, and suggest a push that cannot work (GIT-C6).
        remote_configured: status.remoteConfigured,
        auto_push: status.autoPush,
        auto_fetch: status.autoFetch,
        in_git_repo: status.isGitRepo,
        last_synced_commit: status.lastSyncedCommit ?? null,
        // null, not 0: "nothing pending" and "could not check" must not
        // read alike to an agent deciding whether to publish.
        local_changes: status.localChanges ?? null,
        remote_changes: status.remoteChanges ?? null,
        branch_commit: status.branchCommit ?? null,
        // GIT-22: advisory-lock hazard by filesystem class, or null when
        // the tracker is on a normal local disk (or the class could not
        // be determined). Never blocks — informational only.
        fstype_advisory: status.fstypeAdvisory
          ? { fs_class: status.fstypeAdvisory.fsClass, message: status.fstypeAdvisory.message }
          : null,
      };
      return text(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "publish_to_git",
    description: "Commits the current task state to the configured loctt branch (name is user-configurable via git.branch) and (if remote+auto_push are set) pushes to remote. Call when the user has indicated they want to share or sync tasks — not speculatively after routine task edits.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      let result;
      try {
        result = await publish(locttDir, root);
      } catch (err) {
        if (err instanceof GitReconcileNeededError) return reconcileNeededResult(err);
        // G1: the branch has remote-only work a blind publish would
        // clobber. Surface the actionable "run sync first" message rather
        // than letting it fall through as a framework fault.
        if (err instanceof GitSyncFirstError) return text(err.message);
        // GIT-21 (K93): force-push / history rewrite — refuse and explain,
        // naming the missing commit + remote. The message already tells the
        // agent (and user) to recover in git; LocTT offers no automated
        // rebase, so surface it rather than throwing a framework fault.
        if (err instanceof GitHistoryRewrittenError) return text(err.message);
        // GIT-35 (K94): the branch was written by a newer LocTT — refuse and
        // explain, naming both schema versions. The message tells the agent
        // to upgrade LocTT; LocTT will not apply a newer schema via sync.
        if (err instanceof GitRemoteSchemaNewerError) return text(err.message);
        // GIT-36: the temporary worktree is missing/corrupt — surface the
        // named error (worktree + repair path) rather than a framework
        // fault. Local files were not touched; the message says so.
        if (err instanceof GitWorktreeMissingError) return text(err.message);
        throw err;
      }
      const lines: string[] = [];
      if (result.committed) {
        lines.push(`Published local state to ${result.branch} branch`);
      } else {
        lines.push("No changes to publish");
      }
      if (result.pushed === true) {
        lines.push("Pushed to remote");
      } else if (result.pushError) {
        // GIT-29: distinguish the cause so an agent knows the next
        // action. The local commit succeeded in every case.
        if (result.pushFailure?.kind === "non_fast_forward") {
          lines.push(
            `Published locally; push rejected because ${result.pushFailure.remote} has moved on `
            + `since the last sync (${result.pushFailure.detail}). Local commit is safe. `
            + "Recommended: sync_from_git, then publish again.",
          );
        } else if (result.pushFailure?.kind === "auth") {
          lines.push(
            `Published locally; push failed authenticating to ${result.pushFailure.remote}: `
            + `${result.pushFailure.detail}. Local commit is safe. Fix git credentials, then retry.`,
          );
        } else if (result.pushFailure?.kind === "unreachable") {
          lines.push(
            `Published locally; ${result.pushFailure.remote} could not be reached `
            + `(${result.pushFailure.detail}). Local commit is safe. Retry once the remote is reachable.`,
          );
        } else {
          lines.push(`Published locally; remote push failed: ${result.pushError}`);
        }
      }
      return text(lines.join("\n"));
    },
  },
  {
    name: "sync_from_git",
    description: "Pulls the configured loctt branch (name is user-configurable via git.branch) state into the local workspace. If a remote is configured and auto_fetch is set, fetches first. Call when the user wants to bring in changes from another machine.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      let result;
      try {
        // GIT-8/K92: MCP auto-applies a rekey (it is request/response and
        // cannot pause for a confirm) and reports the old→new below.
        result = await sync(locttDir, root, undefined, { rekeyConfirmed: true });
      } catch (err) {
        if (err instanceof GitReconcileNeededError) return reconcileNeededResult(err);
        // GIT-21 (K93): force-push / history rewrite — refuse and explain,
        // naming the missing commit + remote. Recovery is the user's in git.
        if (err instanceof GitHistoryRewrittenError) return text(err.message);
        // GIT-35 (K94): the branch was written by a newer LocTT — refuse and
        // explain, naming both schema versions. Recovery is to upgrade LocTT.
        if (err instanceof GitRemoteSchemaNewerError) return text(err.message);
        // GIT-36: the temporary worktree is missing/corrupt — surface the
        // named error (worktree + repair path). Local files untouched.
        if (err instanceof GitWorktreeMissingError) return text(err.message);
        throw err;
      }
      const lines: string[] = [];
      if (result.fetched === true) {
        lines.push("Fetched from remote");
      } else if (result.fetchError) {
        // GIT-30: name the remote and say it could not be reached; local
        // state is untouched and the sync continued against the local
        // branch copy.
        lines.push(
          result.fetchFailure !== undefined
            ? `Remote ${result.fetchFailure.remote} ${result.fetchFailure.summary} `
              + `(${result.fetchFailure.detail}); local state untouched, synced against the `
              + "local copy of the branch only."
            : `Remote fetch failed: ${result.fetchError}`,
        );
      }
      if (result.updated) {
        // Report the shape of the change, not just that one happened —
        // an agent needs to know whether files were removed.
        const parts: string[] = [];
        if (result.copied) parts.push(`${result.copied} file(s) updated`);
        if (result.deleted) parts.push(`${result.deleted} file(s) removed`);
        lines.push(
          parts.length > 0
            ? `Synced ${result.branch ?? "loctt"} branch into local workspace: ${parts.join(", ")}`
            : `Synced ${result.branch ?? "loctt"} branch into local workspace`,
        );
      } else {
        lines.push("Already up to date");
      }
      // GIT-8/GIT-9: name each task renumbered to resolve a key collision,
      // old key → new key. Key-safe (old key kept in key_history) and
      // auto-applied on MCP (K92); an agent needs to know which key moved.
      if (result.rekeys !== undefined && result.rekeys.length > 0) {
        lines.push(
          `Renumbered ${String(result.rekeys.length)} task(s) to resolve key collisions:`,
        );
        for (const r of result.rekeys) lines.push(`  ${r.oldKey} → ${r.newKey}`);
      }
      // GIT-33: a collision the rekey could not resolve is surfaced, not
      // swallowed — two tasks still share a key and `show <key>` is
      // ambiguous until the user acts.
      if (result.unresolvedKeys !== undefined && result.unresolvedKeys.length > 0) {
        lines.push(
          `Warning: ${String(result.unresolvedKeys.length)} key collision(s) remain `
          + `unresolved: ${result.unresolvedKeys.join(", ")}. Run 'loctt doctor'.`,
        );
      }
      // GIT-34: the branch published a task whose task.md will not parse.
      // The rest of the sync applied (the counts above report it); name each
      // bad task by id + path so the agent (and user) knows which file to
      // inspect. Kept, not silently absorbed — it reads as a broken task.
      if (result.malformed !== undefined && result.malformed.length > 0) {
        lines.push(
          `Warning: ${String(result.malformed.length)} synced task(s) could not be parsed `
          + "(the rest of the sync was applied). Inspect:",
        );
        for (const m of result.malformed) {
          lines.push(`  ${m.id}: ${m.path} — ${m.reason}`);
        }
      }
      return text(lines.join("\n"));
    },
  },
  {
    name: "get_reconcile_status",
    description: "Returns structured JSON for an in-progress git reconciliation, or {\"in_progress\": false} when none. Reconciliation is opened by publish_to_git / sync_from_git when both sides changed the same task fields; it is resolved in the web UI (Settings → Sync). Each conflict names the task, the field, and both values, with drift flagged when a value references config missing locally. Use this to explain to the user what must be resolved before publish/sync can complete.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      const session = await loadReconcileSession(locttDir, root);
      if (session === undefined) {
        return text(JSON.stringify({ in_progress: false }, null, 2));
      }
      const { state, plan } = session;
      return text(JSON.stringify({
        in_progress: true,
        mode: state.mode,
        base_commit: state.base_commit,
        remote_commit: state.remote_commit,
        started_at: state.started_at,
        conflicts: plan.conflicts.map(c => ({
          task_key: c.taskKey,
          field: c.field,
          field_label: c.fieldLabel,
          kind: c.kind,
          local: c.local.display,
          remote: c.remote.display,
          remote_drift: c.remote.drift?.reason ?? null,
          local_drift: c.local.drift?.reason ?? null,
        })),
        // GIT-16: tasks deleted one side and edited the other — a whole-task
        // keep-deletion / keep-task decision, reported by key.
        delete_vs_edit: plan.deleteVsEdit.map(d => ({
          task_key: d.taskKey,
          task_title: d.taskTitle,
          deleted_side: d.deletedSide,
          edited_side: d.editedSide,
        })),
        auto_merged: plan.autoMerged,
      }, null, 2));
    },
  },
];

/**
 * The reconcile-needed outcome for publish/sync (parity with the panel).
 * Reports the conflicts the agent must tell the user to resolve in the
 * web UI; nothing was written.
 */
function reconcileNeededResult(err: GitReconcileNeededError) {
  const dve = err.plan.deleteVsEdit;
  const lines = [
    `Reconciliation needed before ${err.plan.mode} can complete — `
    + `${String(err.plan.conflicts.length)} field conflict(s)`
    + `${dve.length > 0 ? ` + ${String(dve.length)} delete-vs-edit` : ""} changed on both sides. `
    + "Nothing was written.",
    "",
  ];
  for (const c of err.plan.conflicts) {
    const drift = c.remote.drift ? " (remote value not in local config)" : "";
    lines.push(`  ${c.taskKey} · ${c.fieldLabel}: local="${c.local.display}" remote="${c.remote.display}"${drift}`);
  }
  // GIT-16: a task deleted one side and edited the other — name which is which.
  for (const d of dve) {
    lines.push(
      `  ${d.taskKey}: deleted on ${d.deletedSide}, edited on ${d.editedSide} `
      + "— keep-deletion or keep-task",
    );
  }
  lines.push("", "Resolve these in the web UI (Settings → Sync); the operation completes after Apply.");
  return text(lines.join("\n"));
}
