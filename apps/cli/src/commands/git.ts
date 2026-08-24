import {
  disableGit,
  enableGit,
  getGitStatus,
  preflight,
  publish,
  resolveLocttDir,
  sync,
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
// `--dry-run` runs pre-flight and stops (V4).
const ACCEPTED_FLAGS: readonly string[] = ["--dry-run"];

export async function run(args: string[], root: string): Promise<void> {
  // Accepts no flags. Without this an unknown one was dropped and the
  // command exited 0 — `loctt git publish --frce` reported success
  // while pushing nothing the user asked for.
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "enable": {
      await enableGit(locttDir, root);
      console.log("Git-backed mode enabled");
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
      const result = await publish(locttDir, root);
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
        // never left the machine (GIT-C4).
        process.exitCode = EXIT.RUNTIME;
      }
      break;
    }
    case "sync": {
      const result = await sync(locttDir, root);
      if (result.fetched === true) {
        console.log("Fetched from remote");
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
      console.error("Usage: loctt git <enable|disable|status|publish|sync>");
      process.exitCode = EXIT.USAGE;
      break;
  }
}
