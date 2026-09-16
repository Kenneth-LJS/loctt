import {
  abandonReconcile,
  applyReconcileDecisions,
  confirmRekey,
  DELETE_VS_EDIT_FIELD,
  disableGit,
  enableGit,
  getGitStatus,
  GitBranchAdoptNeededError,
  GitHistoryRewrittenError,
  GitReconcileNeededError,
  GitRemoteSchemaNewerError,
  GitWorktreeMissingError,
  loadReconcileSession,
  preflight,
  publish,
  resolveLocttDir,
  sync,
  type SyncProgress,
} from "@loctt/core";

import { rejectUnknownFlags } from "../runtime/args.js";
import { EXIT } from "../runtime/errors.js";

/**
 * `loctt git <subcommand>` — enable/disable git-backed mode and
 * publish/sync against the canonical `loctt` branch.
 *
 * Reconciliation runs automatically inside `publish` and `sync`
 * when both sides diverged; this surface doesn't expose a separate
 * reconcile command (see docs/user/common/git-sync.md).
 */
// `--dry-run` runs pre-flight and stops (V4). `--adopt` confirms adopting
// a pre-existing LocTT-written branch on enable (GIT-25).
const ACCEPTED_FLAGS: readonly string[] = ["--dry-run", "--adopt"];

export async function run(args: string[], root: string): Promise<void> {
  // Accepts no flags. Without this an unknown one was dropped and the
  // command exited 0 — `loctt git publish --frce` reported success
  // while pushing nothing the user asked for.
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "enable": {
      // GIT-25: `--adopt` confirms adopting a pre-existing LocTT-written
      // branch. Without it, enable throws GitBranchAdoptNeededError so the
      // non-interactive CLI reports the found branch + head and exits
      // non-zero rather than silently adopting — mirroring GIT-C7's
      // foreign-content refusal shape, but recoverable by re-running
      // with --adopt.
      const adopt = args.includes("--adopt");
      let result;
      try {
        result = await enableGit(locttDir, root, undefined, { adopt });
      } catch (err) {
        if (err instanceof GitBranchAdoptNeededError) {
          console.error(err.message);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        throw err;
      }
      console.log("Git-backed mode enabled");
      // GIT-25: report the adopt outcome — the branch head became the sync
      // baseline, and whether local already agrees so the user knows if a
      // sync is needed.
      if (result.adopted !== undefined) {
        console.log(
          `Adopted existing branch ${result.adopted.branch} `
          + `(head ${result.adopted.branchHead.slice(0, 8)}) as the sync baseline.`,
        );
        if (result.adopted.inAgreement === true) {
          console.log("Local state agrees with the branch — no sync needed.");
        } else if (result.adopted.inAgreement === false) {
          console.log("Local state differs from the branch — run 'loctt git sync' to reconcile.");
        }
      }
      // GIT-22: warn — do not block. The enable already succeeded; the
      // advisory names the filesystem class on stderr (a diagnostic, not
      // the command's output) so a scripted enable still sees success.
      if (result.fstypeAdvisory !== undefined) {
        console.error(`Warning: ${result.fstypeAdvisory.message}`);
      }
      break;
    }
    case "disable": {
      await disableGit(locttDir);
      console.log("Git-backed mode disabled");
      break;
    }
    case "status": {
      const status = await getGitStatus(locttDir, root);
      // A sync.yaml we could not read makes every field below a
      // default rather than a reading. Printing `Enabled: false` here
      // reports git mode as off for a tracker where it may be on, and
      // the natural fix — re-enabling — overwrites the state being
      // recovered.
      if (status.unreadable) {
        console.error(`Error: ${status.unreadable.reason}`);
        console.error(
          "Git mode status is unknown — this is not the same as git mode being disabled.",
        );
        console.log("Enabled: unknown");
        console.log("Branch: unknown");
        console.log("Remote: unknown");
        console.log("Auto-push: unknown");
        console.log("Auto-fetch: unknown");
        // Computed from the filesystem, not from the file we could not
        // read, so it stays a real answer.
        console.log(`Inside git repo: ${status.isGitRepo}`);
        process.exitCode = EXIT.RUNTIME;
        break;
      }
      console.log(`Enabled: ${status.enabled}`);
      console.log(`Branch: ${status.branch}`);
      console.log(
        `Remote: ${status.remoteConfigured ? status.remote : `${status.remote} (not configured)`}`,
      );
      console.log(`Auto-push: ${status.autoPush}`);
      console.log(`Auto-fetch: ${status.autoFetch}`);
      console.log(`Inside git repo: ${status.isGitRepo}`);
      if (status.lastSyncedCommit) {
        console.log(`Last synced commit: ${status.lastSyncedCommit}`);
      }
      // Drift, both directions (GIT-C6). Printed only when it could be
      // determined: "0 local changes" on a tracker we never checked
      // would be a claim, not a reading.
      if (status.localChanges !== undefined) {
        console.log(
          `Local changes: ${status.localChanges} `
          + `(${status.localChanges === 0 ? "nothing to publish" : "not yet published"})`,
        );
      }
      if (status.remoteChanges !== undefined) {
        console.log(
          `Remote changes: ${status.remoteChanges ? "yes — run 'loctt git sync'" : "none"}`,
        );
      }
      // GIT-22: the filesystem-class advisory, printed to stderr so it
      // does not pollute the machine-readable status lines above.
      if (status.fstypeAdvisory !== undefined) {
        console.error(`Warning: ${status.fstypeAdvisory.message}`);
      }
      break;
    }
    case "publish": {
      // V4: the same pre-flight backs `--dry-run` and the real publish,
      // so a dry run that passes and a publish that then refuses cannot
      // happen. Reports both severities; only the blocking ones stop a
      // real publish.
      if (args.includes("--dry-run")) {
        const report = await preflight(locttDir);
        if (report.findings.length === 0) {
          console.log("Pre-flight found no problems. A publish would proceed.");
          break;
        }
        for (const f of report.findings) {
          // ✗ blocks; ⚠ is reported and the publish proceeds.
          const mark = f.severity === "unreadable" ? "✗" : "⚠";
          console.log(`${mark} ${f.path}: ${f.message}`);
        }
        if (report.wouldBlock) {
          console.log("\nA publish would be refused until these are fixed.");
          process.exitCode = EXIT.RUNTIME;
        } else {
          // A malformed entry is kept and merged, so publishing it is
          // safe. Blocking here would make one hand-edit typo render
          // the tracker unpublishable.
          console.log("\nA publish would proceed; the entries above are preserved as-is.");
        }
        break;
      }
      let result;
      try {
        result = await publish(locttDir, root);
      } catch (err) {
        if (err instanceof GitReconcileNeededError) {
          reportReconcileNeeded(err);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        // GIT-21 (K93): the branch history was rewritten. Refuse, name the
        // missing commit + remote, and point at git — no LocTT recovery.
        if (err instanceof GitHistoryRewrittenError) {
          reportHistoryRewritten(err);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        // GIT-35 (K94): the branch was written by a newer LocTT. Refuse,
        // name both schema versions, and point at upgrading LocTT.
        if (err instanceof GitRemoteSchemaNewerError) {
          console.error(err.message);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        // GIT-36: the temporary worktree is missing/corrupt. Name the
        // worktree and the repair path (the message carries both); local
        // files were not touched. Not retryable — a runtime error.
        if (err instanceof GitWorktreeMissingError) {
          console.error(err.message);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        throw err;
      }
      if (result.committed) {
        // Name the configured branch, not the literal "loctt": the
        // branch is user-configurable, and this line used to report a
        // branch that did not exist (GIT-C10).
        console.log(`Published local state to ${result.branch} branch`);
      } else {
        console.log("No changes to publish");
      }
      if (result.pushed === true) {
        console.log("Pushed to remote");
      } else if (result.pushError !== undefined) {
        // Core already warned with the cause and the retry command, and
        // the local commit is durable. What was missing is the exit
        // code: reporting success meant a script saw 0 while the work
        // never left the machine (GIT-C4). GIT-29: name the class so a
        // non-fast-forward rejection tells the user to Sync first,
        // distinct from an auth failure pointing at credentials.
        if (result.pushFailure?.kind === "non_fast_forward") {
          console.error(
            `Push rejected: ${result.pushFailure.remote} has moved on since your last sync `
            + `(${result.pushFailure.detail}). The local commit succeeded and is safe. `
            + "Run 'loctt git sync' to reconcile, then publish again.",
          );
        } else if (result.pushFailure?.kind === "auth") {
          console.error(
            `Push failed authenticating to ${result.pushFailure.remote}: ${result.pushFailure.detail}. `
            + "The local commit succeeded and is safe. Fix your git credentials, then retry.",
          );
        } else if (result.pushFailure?.kind === "unreachable") {
          console.error(
            `Push failed: ${result.pushFailure.remote} could not be reached (${result.pushFailure.detail}). `
            + "The local commit succeeded and is safe. Retry once the remote is reachable.",
          );
        }
        process.exitCode = EXIT.RUNTIME;
      }
      break;
    }
    case "reconcile": {
      await runReconcile(args, locttDir, root);
      break;
    }
    case "sync": {
      let result;
      try {
        // GIT-8/K92: CLI auto-applies a rekey (it must stay scriptable — no
        // interactive confirm) and reports the old→new below.
        result = await sync(locttDir, root, makeSyncProgressReporter(), { rekeyConfirmed: true });
      } catch (err) {
        if (err instanceof GitReconcileNeededError) {
          reportReconcileNeeded(err);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        // GIT-21 (K93): the branch history was rewritten. Refuse, name the
        // missing commit + remote, and point at git — no LocTT recovery.
        if (err instanceof GitHistoryRewrittenError) {
          reportHistoryRewritten(err);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        // GIT-35 (K94): the branch was written by a newer LocTT. Refuse,
        // name both schema versions, and point at upgrading LocTT.
        if (err instanceof GitRemoteSchemaNewerError) {
          console.error(err.message);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        // GIT-36: the temporary worktree is missing/corrupt. Name the
        // worktree and the repair path; local files were not touched.
        if (err instanceof GitWorktreeMissingError) {
          console.error(err.message);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        throw err;
      }
      if (result.fetched === true) {
        console.log("Fetched from remote");
      } else if (result.fetchFailure !== undefined) {
        // GIT-30: name the remote and say it could not be reached,
        // distinct from "nothing to sync". Core already wrote the warning
        // + retry command to stderr and continued against the local
        // branch copy — the local state is untouched, so this is not a
        // hard failure; the sync result below still reports.
        console.error(
          `Fetch failed: ${result.fetchFailure.remote} ${result.fetchFailure.summary} `
          + `(${result.fetchFailure.detail}). Local state is untouched; synced against the `
          + "local copy of the branch only. Retry once the remote is reachable.",
        );
      }
      // GIT-8/GIT-9: name each task that was renumbered to resolve a key
      // collision, old key → new key. The rekey is key-safe (old key kept
      // in key_history) and auto-applied on the CLI (K92); reporting it is
      // how the user learns which task moved.
      if (result.rekeys !== undefined && result.rekeys.length > 0) {
        console.log(
          `Renumbered ${String(result.rekeys.length)} task(s) to resolve key collisions:`,
        );
        for (const r of result.rekeys) {
          console.log(`  ${r.oldKey} → ${r.newKey}`);
        }
      }
      // A duplicate key makes `loctt show <key>` ambiguous, so this is
      // not a detail to leave in a warning stream the user may not read.
      if (result.unresolvedKeys !== undefined && result.unresolvedKeys.length > 0) {
        console.error(
          `Warning: ${String(result.unresolvedKeys.length)} key collision(s) remain unresolved: `
          + `${result.unresolvedKeys.join(", ")}. Run 'loctt doctor'.`,
        );
        process.exitCode = EXIT.RUNTIME;
      }
      // GIT-34: the branch published a task whose task.md will not parse.
      // The rest of the sync applied (the "Synced …" line below reports the
      // counts); name each bad task by id + path so the user knows which
      // file to inspect. It was kept, not silently absorbed — the list
      // shows it as a broken-file row.
      if (result.malformed !== undefined && result.malformed.length > 0) {
        console.error(
          `Warning: ${String(result.malformed.length)} synced task(s) could not be parsed `
          + "(the rest of the sync was applied). Inspect:",
        );
        for (const m of result.malformed) {
          console.error(`  ${m.id}: ${m.path} — ${m.reason}`);
        }
        process.exitCode = EXIT.RUNTIME;
      }
      if (result.updated) {
        // Name what changed: a bare "Synced" is indistinguishable from a
        // sync that quietly removed local work.
        const parts: string[] = [];
        if (result.copied) parts.push(`${result.copied} updated`);
        if (result.deleted) parts.push(`${result.deleted} removed`);
        const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        console.log(`Synced ${result.branch ?? "loctt"} branch into local workspace${detail}`);
      } else {
        console.log("Already up to date");
      }
      break;
    }
    default:
      console.error("Usage: loctt git <enable|disable|status|publish|sync|reconcile>");
      process.exitCode = EXIT.USAGE;
      break;
  }
}

/**
 * A progress reporter for `loctt git sync` (GIT-23). A large sync must
 * report progress rather than sitting silent; this writes an updating
 * "Applying N/M files…" line to **stderr** (progress is not the
 * command's output, and stdout stays the machine-readable result the
 * `Synced …` line below carries).
 *
 * Two guards keep it honest and quiet:
 *  - it does nothing for a small sync (`total` under a threshold), so an
 *    ordinary two-file pull is not decorated with a progress line;
 *  - it throttles to whole-percent changes, so a 500-file sync emits ~100
 *    updates rather than 500 — and it always emits the final 100% tick so
 *    the line does not stall one short of done.
 */
export function makeSyncProgressReporter(): SyncProgress {
  const MIN_TOTAL = 50;
  let lastPct = -1;
  return (applied: number, total: number) => {
    if (total < MIN_TOTAL) return;
    const pct = total === 0 ? 100 : Math.floor((applied / total) * 100);
    if (applied < total && pct === lastPct) return;
    lastPct = pct;
    // \r keeps the line in place on a TTY; a redirected stream still gets
    // each state on its own carriage-return-prefixed chunk, which `tail`
    // and logs render acceptably.
    const done = applied >= total;
    process.stderr.write(
      `\rApplying ${String(applied)}/${String(total)} files (${String(pct)}%)…${done ? "\n" : ""}`,
    );
  };
}

/**
 * Prints the per-field reconciliation the sync/publish surfaced, so a CLI
 * user sees the same conflicts the panel would (parity). The CLI does not
 * offer inline per-field pickers; it names the conflicts and points at
 * `loctt git reconcile status` / `apply` / `abandon`.
 */
function reportReconcileNeeded(err: GitReconcileNeededError): void {
  const plan = err.plan;
  const taskCount = new Set([
    ...plan.conflicts.map(c => c.taskKey),
    ...plan.deleteVsEdit.map(d => d.taskKey),
  ]).size;
  console.error(
    `Reconciliation needed: ${String(plan.conflicts.length)} field conflict(s)`
    + `${plan.deleteVsEdit.length > 0 ? ` + ${String(plan.deleteVsEdit.length)} delete-vs-edit` : ""} `
    + `across ${String(taskCount)} task(s).`,
  );
  for (const c of plan.conflicts) {
    const drift = c.remote.drift ? " (remote value not in local config)" : "";
    console.error(`  ${c.taskKey} · ${c.fieldLabel}: local="${c.local.display}" remote="${c.remote.display}"${drift}`);
  }
  // GIT-16: a task deleted one side and edited the other — name which is which.
  for (const d of plan.deleteVsEdit) {
    console.error(
      `  ${d.taskKey}: deleted on ${d.deletedSide}, edited on ${d.editedSide} `
      + "— choose keep-deletion or keep-task",
    );
  }
  console.error(
    "\nResolve in the web UI (Settings → Sync), or run "
    + "'loctt git reconcile status' to inspect and "
    + "'loctt git reconcile abandon' to discard the in-progress reconciliation.",
  );
}

/**
 * Prints the force-push / history-rewrite refusal (GIT-21, K93). Names the
 * commit that can no longer be found and the remote, states nothing was
 * written, and points the user at git for recovery — the CLI offers no
 * automated rebase/base-reset, exactly as K93 requires. The error's own
 * message already carries the full guidance; this just routes it to stderr
 * (progress/diagnostics stream, not the command's stdout output).
 */
function reportHistoryRewritten(err: GitHistoryRewrittenError): void {
  console.error(err.message);
}

/**
 * `loctt git reconcile <status|apply|abandon>` — the CLI face of an
 * in-progress reconciliation (parity with the panel; resolution is
 * UI-primary, so `apply` accepts a JSON decisions file rather than
 * prompting per field).
 */
async function runReconcile(args: string[], locttDir: string, root: string): Promise<void> {
  const action = args[2] ?? "status";
  if (action === "status") {
    const session = await loadReconcileSession(locttDir, root);
    if (session === undefined) {
      console.log("No reconciliation in progress.");
      return;
    }
    const { state, plan } = session;
    console.log(`Reconciliation in progress (${state.mode}), started ${state.started_at}.`);
    console.log(`  base ${state.base_commit.slice(0, 8)} → remote ${state.remote_commit.slice(0, 8)}`);
    console.log(`  ${String(plan.conflicts.length)} conflict(s):`);
    for (const c of plan.conflicts) {
      console.log(`    ${c.taskKey} · ${c.fieldLabel}: local="${c.local.display}" remote="${c.remote.display}"`);
    }
    // GIT-16: delete-vs-edit rows — whole-task keep-deletion / keep-task.
    if (plan.deleteVsEdit.length > 0) {
      console.log(`  ${String(plan.deleteVsEdit.length)} delete-vs-edit:`);
      for (const d of plan.deleteVsEdit) {
        console.log(
          `    ${d.taskKey}: deleted on ${d.deletedSide}, edited on ${d.editedSide} `
          + `(decide with field "${DELETE_VS_EDIT_FIELD}", choice "${d.deletedSide}"=keep-deletion / "${d.editedSide}"=keep-task)`,
        );
      }
    }
    return;
  }
  if (action === "abandon") {
    await abandonReconcile(locttDir);
    console.log("Reconciliation abandoned. Local files are unchanged.");
    return;
  }
  if (action === "apply") {
    // `--decisions <path>` names a JSON file of {taskId,field,choice,value?}.
    const idx = args.indexOf("--decisions");
    if (idx === -1 || args[idx + 1] === undefined) {
      console.error("Usage: loctt git reconcile apply --decisions <file.json>");
      process.exitCode = EXIT.USAGE;
      return;
    }
    const { readFile } = await import("node:fs/promises");
    const decisions = JSON.parse(await readFile(args[idx + 1] as string, "utf-8")) as never;
    const outcome = await applyReconcileDecisions(locttDir, root, decisions);
    for (const r of outcome.results) {
      if (!r.ok) {
        console.log(`  ${r.taskKey}: FAILED — ${r.error ?? "unknown"}`);
        continue;
      }
      // GIT-16: a delete-vs-edit outcome names kept/deleted by key.
      const dve = r.resolved.find(f => f.field === "deletion");
      console.log(dve !== undefined ? `  ${r.taskKey}: ${dve.value}` : `  ${r.taskKey}: applied`);
    }
    // GIT-8/K92: the field conflicts resolved, but completing the sync
    // found a key collision that needs a rekey. The CLI auto-applies it
    // (scriptable) and reports old→new, rather than pausing for a confirm.
    if (!outcome.reconciled && outcome.rekeyPlan !== undefined) {
      const confirmed = await confirmRekey(locttDir, root);
      const syncOut = confirmed.syncOutcome as {
        rekeys?: readonly { oldKey: string; newKey: string }[];
        unresolvedKeys?: readonly string[];
      };
      if (syncOut.rekeys !== undefined && syncOut.rekeys.length > 0) {
        console.log(
          `Renumbered ${String(syncOut.rekeys.length)} task(s) to resolve key collisions:`,
        );
        for (const r of syncOut.rekeys) console.log(`  ${r.oldKey} → ${r.newKey}`);
      }
      if (syncOut.unresolvedKeys !== undefined && syncOut.unresolvedKeys.length > 0) {
        console.error(
          `Warning: ${String(syncOut.unresolvedKeys.length)} key collision(s) remain unresolved: `
          + `${syncOut.unresolvedKeys.join(", ")}. Run 'loctt doctor'.`,
        );
        process.exitCode = EXIT.RUNTIME;
      }
      console.log("Reconciliation complete; the operation finished.");
      return;
    }
    if (outcome.reconciled) {
      console.log("Reconciliation complete; the operation finished.");
    } else {
      console.error("Reconciliation incomplete — some tasks failed; rerun after fixing them.");
      process.exitCode = EXIT.RUNTIME;
    }
    return;
  }
  console.error("Usage: loctt git reconcile <status|apply|abandon>");
  process.exitCode = EXIT.USAGE;
}
