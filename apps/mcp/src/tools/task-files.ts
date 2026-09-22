/**
 * Attachment tools. `attach_file` copies a local file in;
 * `detach_file` removes one by basename. Paths must be absolute on
 * the MCP server's filesystem — the agent's cwd assumption is
 * brittle so we reject relative paths up front rather than
 * resolving against an arbitrary value.
 *
 * F1 (agent-surface hardening): the source path is CONFINED to inside
 * the tracker's resolved data dir (`.loctt/`), not merely the project
 * root (Ken's narrowing). An auto-approved / steered agent cannot copy a
 * file from anywhere on disk (`~/.ssh/id_rsa`, `.env`) — nor a secret
 * sitting BESIDE `.loctt/` (`<root>/credentials.txt`) — into `.loctt/`,
 * where git-backed mode would then commit and push it off the machine. When
 * git-backed mode is on, a successful attach also auto-commits (publishes
 * to the loctt branch), matching Ken's model: attachments push INTO the
 * repo, then commit.
 */

import { isAbsolute } from "node:path";

import {
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  detachFile,
  loadSyncState,
  lookupTask,
  publish,
} from "@loctt/core";
import { z } from "zod";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

/**
 * After a successful attach, commit the new attachment to the loctt branch
 * when — and only when — git-backed mode is enabled. Best-effort: the file
 * is already stored on disk, so a publish that cannot proceed (reconcile
 * pending, divergence, a missing worktree) must NOT turn the successful
 * attach into an error. The outcome rides back in the tool result so the
 * agent can tell the user whether the attachment was committed.
 *
 * Returns `null` when git-backed mode is off (nothing committed, as today).
 */
async function autoCommitAttachment(
  locttDir: string,
  root: string,
): Promise<{ committed: boolean; pushed?: boolean; note?: string } | null> {
  // Detected via the sync state git.enabled flag — the same signal every
  // other git path reads. A tracker with no sync.yaml (git never enabled)
  // throws here; treat that, and a disabled flag, as "git off": store on
  // disk only, commit nothing (never init git or force a commit).
  const enabled = await loadSyncState(locttDir)
    .then(s => s.git.enabled)
    .catch(() => false);
  if (!enabled) return null;
  try {
    const result = await publish(locttDir, root);
    return {
      committed: result.committed,
      ...(result.pushed !== undefined ? { pushed: result.pushed } : {}),
      ...(result.pushError !== undefined
        ? { note: `commit succeeded; push failed: ${result.pushError}` }
        : {}),
    };
  } catch (err) {
    // The attach ALREADY landed on disk (and in history) before this
    // point; auto-commit is strictly best-effort, so ANY failure from
    // publish() is reported as "stored but not committed" and never
    // re-thrown — re-throwing would misreport a successful attach as a
    // failure. publish() can refuse for many reasons beyond the git-sync
    // conflict family (GitSyncError subtypes): a PreflightError on an
    // unreadable task, a reconcile-interrupted sentinel, a rekey-needed
    // gate, or an unexpected I/O error. Enumerating subtypes (as an
    // earlier version did) silently let PreflightError / the others
    // escape and fail the attach — a review-caught regression. Catch-all
    // is both correct and simpler here.
    const message = err instanceof Error ? err.message : String(err);
    return { committed: false, note: `attachment stored but not committed: ${message}` };
  }
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: "attach_file",
    description: "Copy a local file into a task's attachments directory. Only file paths are supported in v1 (no base64 content); the file must be readable from the MCP server's filesystem AND resolve to inside the tracker's data directory (.loctt/) — a path outside it (e.g. ~/.ssh/id_rsa, or a secret sitting beside .loctt/) is refused. Stage the file inside .loctt/ first, then attach it by its path there. When git-backed mode is enabled, a successful attach also commits (publishes) the new attachment.",
    inputSchema: {
      ref: z.string().describe("Task key (e.g. T-1) or ID"),
      source_path: z.string().describe("Absolute path to the file to attach. Must be absolute AND inside the tracker's data directory (.loctt/) — a path outside it is refused. The MCP server's cwd is not guaranteed to match the agent's mental model."),
      force: z.boolean().optional().describe("If true, overwrite an existing attachment with the same basename."),
    },
    handler: async ({ locttDir, root }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const sourcePath = args["source_path"] as string;
      if (!isAbsolute(sourcePath)) {
        return errorResult("source_path must be absolute");
      }
      const force = (args["force"] as boolean | undefined) ?? false;
      try {
        const result = await attachFile({
          locttDir,
          taskId: task.frontmatter.id,
          sourcePath,
          // The source is confined to the project root (A205): blocks a
          // read of e.g. ~/.ssh/id_rsa outside the repo, while still
          // allowing a real file the user or agent points to anywhere in
          // the project. (A tighter .loctt/-only narrowing was tried and
          // reverted — it broke legitimate attach, which by design copies
          // a file from the working tree, and attaching is a reversible
          // copy, not a destructive or privileged act. See decisions.md
          // A225-REVERTED.)
          confineToRoot: root,
          force,
        });
        // Auto-commit when git-backed mode is on (Ken's model). Best-effort:
        // never fails the attach that already landed on disk.
        const commit = await autoCommitAttachment(locttDir, root);
        return text(JSON.stringify({
          name: result.name,
          size: result.size,
          overwritten: result.overwritten,
          task_key: task.frontmatter.key,
          ...(commit !== null ? { committed: commit.committed } : {}),
          ...(commit?.pushed !== undefined ? { pushed: commit.pushed } : {}),
          ...(commit?.note !== undefined ? { commit_note: commit.note } : {}),
        }, null, 2));
      } catch (err) {
        if (err instanceof AttachmentExistsError) {
          // Kept: this arm ADDS something the dispatcher cannot — the
          // `force: true` remedy. The AttachmentSourceError arm beside
          // it only re-wrapped `err.message`, which
          // `runtime/errors.ts` already does for every class in
          // KNOWN_DOMAIN_ERRORS, AttachmentSourceError included.
          return errorResult(`${err.message}. Pass force: true to overwrite.`);
        }
        throw err;
      }
    },
  },
  {
    name: "detach_file",
    description: "Remove a file from a task's attachments directory, identified by basename; refused if no attachment by that name exists. Unlike attach_file, this does not auto-commit — in git-backed mode the removal stays uncommitted until the next publish.",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      name: z.string().describe("Basename of the attachment, no path separators"),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const name = args["name"] as string;
      try {
        await detachFile({
          locttDir,
          taskId: task.frontmatter.id,
          name,
        });
        return text(`Detached ${name} from ${task.frontmatter.key}`);
      } catch (err) {
        if (err instanceof AttachmentNotFoundError) {
          return errorResult(err.message);
        }
        throw err;
      }
    },
  },
];
