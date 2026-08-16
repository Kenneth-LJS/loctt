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
  publish,
  sync,
} from "@loctt/core";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "enable_git",
    description: "Enables git-backed mode for this tracker: records the configuration that publish and sync use. The branch itself is created on the first publish, not here. Refuses if the configured branch already exists and holds content LocTT did not write. Only call when the user has explicitly asked to share tasks across machines or set up sync — this is one-time infrastructure setup, not a routine task operation.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      await enableGit(locttDir, root);
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
    description: "Returns structured JSON describing git-backed mode state (enabled, branch, remote, remote_configured, auto_push, auto_fetch, in_git_repo, last_synced_commit) plus drift in both directions: local_changes (files not yet published) and remote_changes (whether the branch moved since the last sync). Both drift fields are null when they could not be determined, which is not the same as zero.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      const status = await getGitStatus(locttDir, root);
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
      };
      return text(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "publish_to_git",
    description: "Commits the current task state to the configured loctt branch (name is user-configurable via git.branch) and (if remote+auto_push are set) pushes to remote. Call when the user has indicated they want to share or sync tasks — not speculatively after routine task edits.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      const result = await publish(locttDir, root);
      const lines: string[] = [];
      if (result.committed) {
        lines.push(`Published local state to ${result.branch} branch`);
      } else {
        lines.push("No changes to publish");
      }
      if (result.pushed === true) {
        lines.push("Pushed to remote");
      } else if (result.pushError) {
        lines.push(`Published locally; remote push failed: ${result.pushError}`);
      }
      return text(lines.join("\n"));
    },
  },
  {
    name: "sync_from_git",
    description: "Pulls the configured loctt branch (name is user-configurable via git.branch) state into the local workspace. If a remote is configured and auto_fetch is set, fetches first. Call when the user wants to bring in changes from another machine.",
    inputSchema: {},
    handler: async ({ locttDir, root }) => {
      const result = await sync(locttDir, root);
      const lines: string[] = [];
      if (result.fetched === true) {
        lines.push("Fetched from remote");
      } else if (result.fetchError) {
        lines.push(`Remote fetch failed: ${result.fetchError}`);
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
      return text(lines.join("\n"));
    },
  },
];
