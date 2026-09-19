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

import { requireConfirm } from "../runtime/confirm.js";
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
      + "and listed in `excluded`. Requires `confirm: true`: a backup "
      + "writes the whole tracker to `output`, which may be any path the "
      + "server can write, so an auto-approved agent must not be able to "
      + "write it out silently.",
    inputSchema: {
      output: z.string().min(1).describe("Destination file path, relative to the tracker root."),
      no_history: z.boolean().optional()
        .describe("Exclude _history.yaml. History is included by default."),
      split_bytes: z.number().int().min(1).optional()
        .describe("Bytes per part; the output splits into numbered parts above this."),
      confirm: z.boolean().optional()
        .describe("Required: must be true. A backup writes the whole tracker to a file path."),
    },
    handler: async ({ root, locttDir }, args) => {
      // F2: a backup writes the whole tracker out to an arbitrary path
      // (paths are intentionally NOT confined — backup/restore are an
      // import/export boundary by design, K73/Ken). The confirm gate is
      // the guard: a human approving it is what stops a steered agent
      // from crossing the tracker boundary silently.
      const blocked = requireConfirm(args, "backup");
      if (blocked) return blocked;
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
      + "renamedEntities, displacedBodies, badLines}. A real (non-dry-run) "
      + "restore requires `confirm: true`: it reads from an arbitrary file "
      + "and writes into the tracker (overwrite/merge can destroy work). "
      + "`dry_run` writes nothing and needs no confirm.",
    inputSchema: {
      files: z.array(z.string().min(1)).min(1)
        .describe("Backup file paths. A split backup needs every part; a partial set is refused."),
      mode: z.enum(["bare", "merge", "overwrite"]).optional()
        .describe("Defaults to 'bare'."),
      dry_run: z.boolean().optional()
        .describe("Predict counts without writing anything. A dry run needs no confirm."),
      confirm: z.boolean().optional()
        .describe("Required for a real restore (not needed for dry_run): reads an arbitrary file and writes into the tracker."),
    },
    handler: async ({ root, locttDir }, args) => {
      // F2/F3: a real restore reads from an arbitrary file and writes into
      // the tracker; overwrite (and merge) can destroy work. Confirm-gate
      // every non-dry-run restore — dry_run writes nothing, so it stays
      // open (it is exactly the "predict first" tool the docs point to).
      const isDryRun = args["dry_run"] === true;
      if (!isDryRun) {
        const blocked = requireConfirm(args, "restore");
        if (blocked) return blocked;
      }
      const files = (args["files"] as string[]).map(f => resolvePath(root, f));
      const report = await restoreBackup(locttDir, files, {
        mode: (args["mode"] as RestoreMode | undefined) ?? "bare",
        dryRun: args["dry_run"] === true,
      });
      return text(JSON.stringify(report, null, 2));
    },
  },
];
