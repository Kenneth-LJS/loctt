import {
  disableGit,
  enableGit,
  getGitStatus,
  publish,
  resolveLocttDir,
  sync,
} from "@loctt/core";

import { EXIT } from "../runtime/errors.js";

/**
 * `loctt git <subcommand>` — enable/disable git-backed mode and
 * publish/sync against the canonical `loctt` branch.
 *
 * Reconciliation runs automatically inside `publish` and `sync`
 * when both sides diverged; this surface doesn't expose a separate
 * reconcile command (see docs/user/common/git-sync.md).
 */
export async function run(args: string[], root: string): Promise<void> {
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
      console.log(`Enabled: ${status.enabled}`);
      console.log(`Branch: ${status.branch}`);
      console.log(`Remote: ${status.remote}`);
      console.log(`Auto-push: ${status.autoPush}`);
      console.log(`Auto-fetch: ${status.autoFetch}`);
      console.log(`Inside git repo: ${status.isGitRepo}`);
      if (status.lastSyncedCommit) {
        console.log(`Last synced commit: ${status.lastSyncedCommit}`);
      }
      break;
    }
    case "publish": {
      const result = await publish(locttDir, root);
      if (result.committed) {
        console.log("Published local state to loctt branch");
      } else {
        console.log("No changes to publish");
      }
      if (result.pushed === true) {
        console.log("Pushed to remote");
      }
      break;
    }
    case "sync": {
      const result = await sync(locttDir, root);
      if (result.fetched === true) {
        console.log("Fetched from remote");
      }
      if (result.updated) {
        // Name what changed: a bare "Synced" is indistinguishable from a
        // sync that quietly removed local work.
        const parts: string[] = [];
        if (result.copied) parts.push(`${result.copied} updated`);
        if (result.deleted) parts.push(`${result.deleted} removed`);
        const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        console.log(`Synced loctt branch into local workspace${detail}`);
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
