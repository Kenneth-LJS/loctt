import {
  archiveMilestone,
  createMilestone,
  deleteMilestone,
  editMilestone,
  loadMilestonesConfig,
  loadWorkflowConfig,
  milestoneProgress,
  resolveLocttDir,
  resolveMilestoneIdFromInput,
  unarchiveMilestone,
} from "@loctt/core";

import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt milestone <subcommand>` — milestone lifecycle.
 *
 * Milestone references accepted as either an id (ULID) or a name.
 */
/**
 * Flags this command family accepts. A union across its
 * subcommands: they share one argv, so splitting per subcommand
 * would reject a sibling's valid flag.
 *
 * Without this an unrecognised flag was silently dropped — the
 * reference documented `--label` on project create for a flag the
 * CLI never read, so the worked example created a project named
 * `web` and discarded the label (PRU-C9).
 */
const ACCEPTED_FLAGS: readonly string[] = ["--all", "--archived", "--ids", "--name", "--progress", "--remap-to", "--target-date", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const showIds = hasFlag(args, "--ids");
      const showProgress = hasFlag(args, "--progress");
      const cfg = await loadMilestonesConfig(locttDir);
      const shown = cfg.milestones.filter(m => includeArchived || m.archived !== true);

      // Opt-in: progress scans every task, and `milestone list` is
      // otherwise a config read.
      let progress: Record<string, { done: number; total: number; discarded: number }> = {};
      if (showProgress) {
        const workflow = await loadWorkflowConfig(locttDir);
        progress = await milestoneProgress(locttDir, shown.map(m => m.id), workflow);
      }

      for (const m of shown) {
        const arch = m.archived === true ? " (archived)" : "";
        const due = m.target_date ? `  due ${m.target_date}` : "";
        const idCol = showIds ? `\t${m.id}` : "";
        const p = progress[m.id];
        // Name the excluded discarded tasks where the number is shown:
        // silently shrinking a denominator is as confusing as leaving
        // dead work in it.
        const prog = p
          ? `  ${p.done}/${p.total}${p.discarded > 0 ? ` (${p.discarded} discarded, excluded)` : ""}`
          : "";
        console.log(`${m.name}${idCol}${due}${prog}${arch}`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const name = args[2];
        if (!name) {
          throw new UsageError(
            "missing name",
            "loctt milestone create <name> [--target-date <YYYY-MM-DD>]",
          );
        }
        const targetDate = getArg(args, "--target-date");
        const def = await createMilestone(locttDir, {
          name,
          ...(targetDate !== undefined ? { target_date: targetDate } : {}),
        });
        console.log(`Created milestone "${name}" (id ${def.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError(
            "missing milestone ref",
            "loctt milestone edit <name|id> [--name <new>] [--target-date <YYYY-MM-DD|->] [--archived <true|false>]",
          );
        }
        const cfg = await loadMilestonesConfig(locttDir);
        const id = resolveMilestoneIdFromInput(cfg, ref, { includeArchived: true });
        const name = getArg(args, "--name");
        const td = getArg(args, "--target-date");
        const archivedArg = getArg(args, "--archived");
        if (archivedArg !== undefined && archivedArg !== "true" && archivedArg !== "false") {
          throw new UsageError(`--archived must be exactly "true" or "false", got: ${archivedArg}`);
        }
        await editMilestone(locttDir, id, {
          ...(name !== undefined ? { name } : {}),
          ...(td !== undefined ? { target_date: td === "-" ? null : td } : {}),
          ...(archivedArg !== undefined ? { archived: archivedArg === "true" } : {}),
        });
        console.log(`Updated milestone ${ref}`);
      });
      break;
    }
    case "delete": {
      const ref = args[2];
      if (!ref) {
        console.error(`Error: missing milestone ref`);
        console.error(`Usage: loctt milestone delete <name|id> [--remap-to <other>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = getArg(args, "--remap-to");
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete milestone ${ref}? This will rewrite affected tasks. (use 'loctt milestone archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const cfg = await loadMilestonesConfig(locttDir);
        const id = resolveMilestoneIdFromInput(cfg, ref, { includeArchived: true });
        const remapToId = remapTo !== undefined ? resolveMilestoneIdFromInput(cfg, remapTo) : undefined;
        const result = await deleteMilestone(locttDir, id, {
          hard: true,
          ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
        });
        if (result.affectedTaskCount > 0) {
          const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "cleared from";
          console.log(`${action} ${result.affectedTaskCount} task(s)`);
        }
        console.log(`Deleted milestone ${ref}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing milestone ref", `loctt milestone ${sub} <name|id>`);
        }
        const cfg = await loadMilestonesConfig(locttDir);
        const id = resolveMilestoneIdFromInput(cfg, ref, { includeArchived: true });
        if (sub === "archive") await archiveMilestone(locttDir, id);
        else await unarchiveMilestone(locttDir, id);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} milestone ${ref}`);
      });
      break;
    }
    default:
      console.error(`Usage: loctt milestone <list|create|edit|archive|unarchive|delete> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
