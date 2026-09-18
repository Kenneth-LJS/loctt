/**
 * Backup and restore over MCP (M5.1).
 *
 * Present because a capability in core is not done until both surfaces
 * have it: a backup only one surface can take is not a backup, and a
 * backup taken on the CLI must restore through MCP and the reverse
 * (BAK-C1, BAK-C24).
 */

import { resolve as resolvePath } from "node:path";

import {
  EXCLUSION_REASONS,
  exportBackup,
  restoreBackup,
  type RestoreMode,
} from "@loctt/core";
import { z } from "zod";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "backup",
    description:
      "Writes a whole-tracker JSONL backup (tasks with body, comments, "
      + "attachments and history, plus config, users and state.yaml). This is "
      + "the backup format; the CSV export is a report for a spreadsheet and "
      + "cannot restore. Returns JSON {files, bytes, tasks, configs, users, "
      + "includedHistory, excluded, schemaVersion}. Machine-local files "
      + "(.loctt/local/, user settings and recents) are deliberately excluded "
      + "and listed in `excluded`.",
    inputSchema: {
      output: z.string().min(1).describe("Destination file path, relative to the tracker root."),
      no_history: z.boolean().optional()
        .describe("Exclude _history.yaml. History is included by default."),
      split_bytes: z.number().int().min(1).optional()
        .describe("Bytes per part; the output splits into numbered parts above this."),
    },
    handler: async ({ root, locttDir }, args) => {
      const report = await exportBackup(locttDir, {
        outputPath: resolvePath(root, args["output"] as string),
        includeHistory: args["no_history"] !== true,
        ...(typeof args["split_bytes"] === "number"
          ? { splitThresholdBytes: args["split_bytes"] }
          : {}),
      });
      return text(JSON.stringify({
        ...report,
        excluded: report.excluded.map(path => ({
          path, reason: EXCLUSION_REASONS[path] ?? "",
        })),
      }, null, 2));
    },
  },
  {
    name: "restore",
    description:
      "Restores a JSONL backup. Modes: 'bare' (default) refuses a non-empty "
      + "tracker; 'merge' creates only ids absent from the tracker and never "
      + "edits one that is present; 'overwrite' replaces any id the backup "
      + "carries, preserving each displaced body in the task's directory. "
      + "Key, prefix, slug and name collisions are resolved and reported. "
      + "Returns JSON {mode, dryRun, created, skipped, overwritten, "
      + "reallocatedKeys, reassignedPrefixes, reassignedSlugs, "
      + "renamedEntities, displacedBodies, badLines}.",
    inputSchema: {
      files: z.array(z.string().min(1)).min(1)
        .describe("Backup file paths. A split backup needs every part; a partial set is refused."),
      mode: z.enum(["bare", "merge", "overwrite"]).optional()
        .describe("Defaults to 'bare'."),
      dry_run: z.boolean().optional()
        .describe("Predict counts without writing anything."),
    },
    handler: async ({ root, locttDir }, args) => {
      const files = (args["files"] as string[]).map(f => resolvePath(root, f));
      const report = await restoreBackup(locttDir, files, {
        mode: (args["mode"] as RestoreMode | undefined) ?? "bare",
        dryRun: args["dry_run"] === true,
      });
      return text(JSON.stringify(report, null, 2));
    },
  },
];
