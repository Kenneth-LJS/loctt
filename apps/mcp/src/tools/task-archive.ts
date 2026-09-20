/**
 * Task archive/unarchive — the soft-delete pair. Archived tasks
 * stay on disk and remain searchable but are hidden from default
 * list/show surfaces and are blocked from new references by the
 * archived-reference guard.
 */

import { bulkArchive } from "@loctt/core";
import { z } from "zod";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

/**
 * Format a `BulkResult` from bulkArchive into a text summary. `unchanged`
 * (tasks already in the target state) is a subset of `succeeded`; it is
 * reported apart so a mixed selection reads honestly, matching the web
 * bulk response (BLK-27).
 */
function reportArchive(
  verb: string,
  result: {
    bulk_op_id: string;
    succeeded: readonly string[];
    failed: readonly { taskId: string; error: string }[];
    unchanged?: readonly string[];
  },
): string {
  const noop = result.unchanged?.length ?? 0;
  const lines = [
    `${verb} ${String(result.succeeded.length)}, failed ${String(result.failed.length)}`
    + (noop > 0 ? ` (${String(noop)} already in that state)` : "")
    + ` (bulk_op_id ${result.bulk_op_id})`,
  ];
  for (const f of result.failed) lines.push(`  ${f.taskId}: ${f.error}`);
  return lines.join("\n");
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: "archive_task",
    description:
      "Archive one or more tasks (the reversible soft-delete; use " +
      "delete_task for the hard, irreversible variant). Archived tasks stay " +
      "on disk and remain searchable but are hidden from default list/show " +
      "surfaces and are blocked as the target of new relationships. Reverse " +
      "with unarchive_task. Pass several refs to archive them as one " +
      "operation (a single lock, a shared bulk_op_id); tasks already " +
      "archived are counted as unchanged, and a bad ref is reported without " +
      "aborting the rest.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500)
        .describe("Task keys or IDs. Capped at 500 — one bulk op holds the tracker lock for its whole run."),
    },
    handler: async ({ locttDir }, args) => {
      const refs = args["refs"] as string[];
      const result = await bulkArchive({ locttDir, taskRefs: refs, archive: true });
      return text(reportArchive("Archived", result));
    },
  },
  {
    name: "unarchive_task",
    description:
      "Clear the archived flag on one or more tasks, restoring them to " +
      "default list/show surfaces and allowing them as relationship targets " +
      "again. Pass several refs to unarchive them as one operation; tasks " +
      "already active are counted as unchanged, and a bad ref is reported " +
      "without aborting the rest.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500)
        .describe("Task keys or IDs. Capped at 500 — one bulk op holds the tracker lock for its whole run."),
    },
    handler: async ({ locttDir }, args) => {
      const refs = args["refs"] as string[];
      const result = await bulkArchive({ locttDir, taskRefs: refs, archive: false });
      return text(reportArchive("Unarchived", result));
    },
  },
];
