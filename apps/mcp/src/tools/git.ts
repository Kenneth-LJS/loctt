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
  abandonReconcile,
  applyReconcileDecisions,
  confirmRekey,
  disableGit,
  enableGit,
  getGitStatus,
  GitBranchAdoptNeededError,
  GitHistoryRewrittenError,
  GitReconcileInterruptedError,
  GitReconcileNeededError,
  GitRemoteSchemaNewerError,
  GitSyncFirstError,
  GitWorktreeMissingError,
  loadReconcileSession,
  publish,
  sync,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

/**
 * One decision `resolve_reconcile` accepts. This is the exact shape the
 * CLI's `--decisions <file.json>` and the web's apply body take — core's
 * `ReconcileDecision` (@loctt/contracts): identity is `taskId` + `field`,
 * `choice` is local | remote | value, and `value` carries the typed third
 * value only for `choice: "value"`. Kept camelCase (not the MCP surface's
 * snake_case) so the array is byte-for-byte the CLI decisions file — no
 * re-mapping layer to drift from core, exactly as the CLI passes it
 * straight through. `taskId` is the task's ULID; get_reconcile_status now
 * reports it as `task_id` on every conflict/delete-vs-edit row so an agent
 * can build these decisions without guessing.
 */
const decisionSchema = z.object({
  taskId: z.string().min(1).describe("The task's ULID (its `id`, not the `key`). Read it from get_reconcile_status, which reports `task_id` on each conflict / delete-vs-edit row."),
  field: z.string().min(1).describe("The conflicting frontmatter field, or the reserved `__delete_vs_edit__` for a whole-task keep-deletion / keep-task decision."),
  choice: z.enum(["local", "remote", "value"]).describe("Which side to keep: `local`, `remote`, or `value` (a typed third value carried in `value`). For a delete-vs-edit row, `choice` is the side to keep — the editing side keeps the task, the deleting side keeps the deletion."),
  value: z.unknown().optional().describe("Present only for `choice: \"value\"` — the picked/typed value (raw form)."),
}).strict();

export const TOOLS: readonly ToolDef[] = [
  {
    name: "enable_git",
    description: "Enables git-backed mode for this tracker: records the configuration that publish and sync use. The branch itself is created on the first publish, not here. Refuses if the configured branch already exists and holds content LocTT did not write. If the branch already exists AND was written by LocTT (from a previous setup), refuses too — reporting the branch head and asking the caller to decide — unless `adopt: true` is passed, which adopts it (sets last_synced_commit to the branch head and reports whether local state agrees with it). Only call when the user has explicitly asked to share tasks across machines or set up sync — this is one-time infrastructure setup, not a routine task operation.",
    inputSchema: {
      // GIT-25: MCP is non-interactive, so the adopt-or-stop choice is a
      // param. Default (absent/false) means "stop and report" if a
      // pre-existing LocTT branch is found; true means adopt it.
      adopt: z.boolean().optional().describe("If true, adopt a pre-existing LocTT-written branch: set last_synced_commit to its head and report whether local state agrees. Without it, enable refuses and reports the found branch + head so the user can decide (GIT-25)."),
    },
    handler: async ({ locttDir, root }, args) => {
      const adopt = args["adopt"] === true;
      let result;
      try {
        result = await enableGit(locttDir, root, undefined, { adopt });
      } catch (err) {
        // GIT-25: a pre-existing LocTT-written branch, and adopt was not
        // confirmed. Report the branch + head and the adopt-or-stop choice
        // rather than silently adopting — the message carries both.
        if (err instanceof GitBranchAdoptNeededError) return text(err.message);
        throw err;
      }
      const lines = ["Git-backed mode enabled"];
      // GIT-25: report the adopt outcome so the agent can tell the user
      // whether a sync is needed.
      if (result.adopted !== undefined) {
        lines.push(
          `Adopted existing branch ${result.adopted.branch} `
          + `(head ${result.adopted.branchHead.slice(0, 8)}) as the sync baseline.`,
        );
        if (result.adopted.inAgreement === true) {
          lines.push("Local state agrees with the branch. No sync needed.");
        } else if (result.adopted.inAgreement === false) {
          lines.push("Local state differs from the branch. Run sync_from_git to reconcile.");
        }
      }
      // GIT-22: warn — do not block. Enable succeeded; if the tracker is
      // on a filesystem where advisory locks are unreliable, name the
      // class so the agent can tell the user before they rely on sync.
      if (result.fstypeAdvisory !== undefined) {
        lines.push("", `Warning: ${result.fstypeAdvisory.message}`);
      }
      return text(lines.join("\n"));
    },
  },
  {
    name: "disable_git",
    description: "Disables git-backed mode for this tracker by clearing the enabled flag; the branch, remote, and last-sync configuration are kept so re-enabling resumes where it left off, and the loctt branch and its commits are left in place. Local task data is preserved. Refused if git-backed mode is not currently enabled.",
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
          + "Git mode status is unknown. This is not the same as git mode being disabled. "
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
          lines.push(`  ${m.id}: ${m.path}: ${m.reason}`);
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
          // task_id is the identity a resolve_reconcile decision is keyed by
          // (with `field`); reported here so an agent can build decisions.
          task_id: c.taskId,
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
          task_id: d.taskId,
          task_key: d.taskKey,
          task_title: d.taskTitle,
          deleted_side: d.deletedSide,
          edited_side: d.editedSide,
          // The reserved `field` a decision for this row must carry; the
          // `choice` is one of deleted_side / edited_side.
          decision_field: "__delete_vs_edit__",
        })),
        auto_merged: plan.autoMerged,
      }, null, 2));
    },
  },
  {
    name: "resolve_reconcile",
    description:
      "Applies decisions to the in-progress git reconciliation and completes the "
      + "originally-requested publish/sync (parity with the CLI's `git reconcile apply` "
      + "and the web UI's Apply). Read the conflicts with get_reconcile_status first; "
      + "pass one decision per conflicting field (identity is `taskId` + `field`), plus "
      + "one reserved-field decision (`field: \"__delete_vs_edit__\"`) per delete-vs-edit "
      + "row. DESTRUCTIVE — an apply that keeps one side discards the other's value, so "
      + "it requires `confirm: true`. If completing the sync then hits a key collision "
      + "that must be renumbered (a rekey), this does NOT renumber unless `confirm_rekey: "
      + "true` is also passed: without it, the tool reports the rekey preview and stops "
      + "so you can show the user which keys would move before re-calling with "
      + "`confirm_rekey: true`. A partial apply (some tasks failed) keeps the "
      + "reconciliation open with the successes journalled, so a re-call retries only the "
      + "unwritten rows.",
    inputSchema: {
      decisions: z.array(decisionSchema).min(1)
        .describe("One decision per conflicting field / delete-vs-edit row (see get_reconcile_status). Same shape as the CLI `--decisions` file."),
      confirm: z.boolean().optional().describe("Required: must be true — keeping one side discards the other, which is destructive."),
      confirm_rekey: z.boolean().optional()
        .describe("If the completing sync needs a rekey to resolve a key collision, must be true to renumber. Without it the tool reports the rekey preview and stops."),
    },
    handler: async ({ locttDir, root }, args) => {
      const blocked = requireConfirm(args, "resolve_reconcile");
      if (blocked) return blocked;
      // camelCase already — the decision schema mirrors core's ReconcileDecision
      // exactly, so the array passes straight through with no re-mapping.
      const decisions = args["decisions"] as z.infer<typeof decisionSchema>[];
      let outcome;
      try {
        outcome = await applyReconcileDecisions(locttDir, root, decisions);
      } catch (err) {
        const handled = reconcileErrorText(err);
        if (handled !== undefined) return handled;
        throw err;
      }

      const lines: string[] = [];
      for (const r of outcome.results) {
        if (!r.ok) {
          lines.push(`  ${r.taskKey}: FAILED: ${r.error ?? "unknown"}`);
          continue;
        }
        // GIT-16: a delete-vs-edit outcome names kept/deleted by key.
        const dve = r.resolved.find(f => f.field === "deletion");
        lines.push(dve !== undefined ? `  ${r.taskKey}: ${dve.value}` : `  ${r.taskKey}: applied`);
      }

      // GIT-8/K92: the field conflicts resolved, but completing the sync found
      // a key collision that needs a rekey. Unlike sync_from_git (which
      // auto-applies), a reconcile apply is already a confirmed destructive
      // action mid-flow, so the rekey gets its own gate: report the preview
      // and stop unless confirm_rekey was passed.
      if (!outcome.reconciled && outcome.rekeyPlan !== undefined) {
        if (args["confirm_rekey"] !== true) {
          const rk = outcome.rekeyPlan;
          lines.push(
            "",
            `Field conflicts resolved, but completing the sync needs a rekey: `
            + `${String(rk.losers.length)} task(s) would be renumbered to resolve key `
            + "collision(s). Nothing has been renumbered yet.",
          );
          for (const l of rk.losers) {
            lines.push(`  ${l.key} → ${l.newKey ?? "(no key available)"} (keeper decided by ${l.tiebreak})`);
          }
          for (const s of rk.skipped) {
            lines.push(`  ${s.key}: cannot rekey: ${s.reason}`);
          }
          lines.push("", "Re-call resolve_reconcile with the same decisions plus confirm_rekey: true to renumber and finish.");
          return text(lines.join("\n"));
        }
        // confirm_rekey: true — apply the renumber and finish the sync.
        let confirmed;
        try {
          confirmed = await confirmRekey(locttDir, root);
        } catch (err) {
          const handled = reconcileErrorText(err);
          if (handled !== undefined) return handled;
          throw err;
        }
        const syncOut = confirmed.syncOutcome as {
          rekeys?: readonly { oldKey: string; newKey: string }[];
          unresolvedKeys?: readonly string[];
        };
        if (syncOut.rekeys !== undefined && syncOut.rekeys.length > 0) {
          lines.push("", `Renumbered ${String(syncOut.rekeys.length)} task(s) to resolve key collisions:`);
          for (const r of syncOut.rekeys) lines.push(`  ${r.oldKey} → ${r.newKey}`);
        }
        // GIT-33: a collision the rekey could not resolve is surfaced, not
        // swallowed — two tasks still share a key until the user acts.
        if (syncOut.unresolvedKeys !== undefined && syncOut.unresolvedKeys.length > 0) {
          lines.push(
            `Warning: ${String(syncOut.unresolvedKeys.length)} key collision(s) remain unresolved: `
            + `${syncOut.unresolvedKeys.join(", ")}. Run 'loctt doctor'.`,
          );
        }
        lines.push("", "Reconciliation complete; the operation finished.");
        return text(lines.join("\n"));
      }

      if (outcome.reconciled) {
        lines.push("", "Reconciliation complete; the operation finished.");
      } else {
        // GIT-12/GIT-32: an honest partial — the sentinel is kept with the
        // successes journalled; a re-call retries only the unwritten rows.
        lines.push("", "Reconciliation incomplete. Some tasks failed. Fix them and re-call resolve_reconcile to retry the remaining rows.");
      }
      return text(lines.join("\n"));
    },
  },
  {
    name: "abandon_reconcile",
    description:
      "Abandons the in-progress git reconciliation (parity with the CLI's `git "
      + "reconcile abandon` and the web UI's Abandon). Clears the reconciliation record "
      + "and leaves local files exactly as they are — this is NOT a revert, so anything "
      + "a partial resolve_reconcile already wrote stays written. The blocked publish/sync "
      + "does not complete; re-run it to re-plan from scratch. Requires `confirm: true` "
      + "because it discards the pending decisions and the record of what must be resolved.",
    inputSchema: {
      confirm: z.boolean().optional().describe("Required: must be true to proceed."),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "abandon_reconcile");
      if (blocked) return blocked;
      await abandonReconcile(locttDir);
      return text("Reconciliation abandoned. Local files are unchanged; re-run publish/sync to re-plan.");
    },
  },
];

/**
 * Maps the git domain errors an apply/confirm-rekey can surface to a clean
 * text result, matching the publish/sync handlers (parity). Returns undefined
 * for anything unrecognised so the handler rethrows it as a real fault.
 *
 * `applyReconcileDecisions` throws a plain Error("no reconciliation is in
 * progress") when no sentinel is present (core, not a domain class); it is
 * handled by message here so an agent that calls resolve out of order gets a
 * clear sentence instead of an opaque server fault.
 */
function reconcileErrorText(err: unknown) {
  if (err instanceof GitReconcileNeededError) return reconcileNeededResult(err);
  if (err instanceof GitReconcileInterruptedError) return text(err.message);
  if (err instanceof GitHistoryRewrittenError) return text(err.message);
  if (err instanceof GitRemoteSchemaNewerError) return text(err.message);
  if (err instanceof GitWorktreeMissingError) return text(err.message);
  if (err instanceof GitSyncFirstError) return text(err.message);
  if (err instanceof Error && err.message === "no reconciliation is in progress") {
    return errorResult("no reconciliation is in progress");
  }
  if (err instanceof Error && err.message === "no rekey is awaiting confirmation") {
    return errorResult("no rekey is awaiting confirmation");
  }
  return undefined;
}

/**
 * The reconcile-needed outcome for publish/sync (parity with the panel).
 * Reports the conflicts the agent must tell the user to resolve in the
 * web UI; nothing was written.
 */
function reconcileNeededResult(err: GitReconcileNeededError) {
  const dve = err.plan.deleteVsEdit;
  const lines = [
    `Reconciliation needed before ${err.plan.mode} can complete. `
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
      `  ${d.taskKey}: deleted on ${d.deletedSide}, edited on ${d.editedSide}. `
      + "Keep-deletion or keep-task",
    );
  }
  lines.push("", "Resolve these in the web UI (Settings → Sync); the operation completes after Apply.");
  return text(lines.join("\n"));
}
