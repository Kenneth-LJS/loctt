import {
  archiveMilestone,
  createMilestone,
  deleteMilestone,
  editMilestone,
  loadMilestonesConfig,
  resolveLocttDir,
  unarchiveMilestone,
} from "@loctt/core";

import { getArg, hasFlag } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt milestone <subcommand>` — milestone lifecycle.
 *
 * `edit --archived <true|false>` is the only place a string-typed
 * boolean flag exists in the CLI surface (because the field on the
 * frontmatter is a tri-state: present-true, present-false, absent).
 */
export async function run(args: string[], root: string): Promise<void> {
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const cfg = await loadMilestonesConfig(locttDir);
      for (const m of cfg.milestones) {
        if (!includeArchived && m.archived === true) continue;
        const arch = m.archived === true ? " (archived)" : "";
        const due = m.target_date ? `  due ${m.target_date}` : "";
        console.log(`${m.key}\t${m.label}${due}${arch}`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError(
            "missing key",
            "loctt milestone create <key> [--label <label>] [--target-date <YYYY-MM-DD>]",
          );
        }
        const label = getArg(args, "--label") ?? key;
        const targetDate = getArg(args, "--target-date");
        await createMilestone(locttDir, {
          key,
          label,
          ...(targetDate !== undefined ? { target_date: targetDate } : {}),
        });
        console.log(`Created milestone ${key}`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError(
            "missing key",
            "loctt milestone edit <key> [--label <l>] [--target-date <YYYY-MM-DD|->] [--archived <true|false>]",
          );
        }
        const label = getArg(args, "--label");
        const td = getArg(args, "--target-date");
        const archivedArg = getArg(args, "--archived");
        if (archivedArg !== undefined && archivedArg !== "true" && archivedArg !== "false") {
          throw new UsageError(`--archived must be exactly "true" or "false", got: ${archivedArg}`);
        }
        await editMilestone(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...(td !== undefined ? { target_date: td === "-" ? null : td } : {}),
          ...(archivedArg !== undefined ? { archived: archivedArg === "true" } : {}),
        });
        console.log(`Updated milestone ${key}`);
      });
      break;
    }
    case "delete": {
      const key = args[2];
      if (!key) {
        console.error(`Error: missing key`);
        console.error(`Usage: loctt milestone delete <key> [--remap-to <other>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = getArg(args, "--remap-to");
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete milestone ${key}? This will rewrite affected tasks. (use 'loctt milestone archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const result = await deleteMilestone(locttDir, key, {
          hard: true,
          ...(remapTo !== undefined ? { remapTo } : {}),
        });
        if (result.affectedTaskCount > 0) {
          const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "cleared from";
          console.log(`${action} ${result.affectedTaskCount} task(s)`);
        }
        console.log(`Deleted milestone ${key}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError("missing key", `loctt milestone ${sub} <key>`);
        }
        if (sub === "archive") await archiveMilestone(locttDir, key);
        else await unarchiveMilestone(locttDir, key);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} milestone ${key}`);
      });
      break;
    }
    default:
      console.error(`Usage: loctt milestone <list|create|edit|archive|unarchive|delete> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
