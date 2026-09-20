import {
  archiveMilestone,
  createMilestone,
  deleteMilestone,
  editMilestone,
  filterByName,
  isProgressUnavailable,
  loadMilestonesConfig,
  loadWorkflowConfig,
  milestoneProgressDetailed,
  type MilestoneProgressResult,
  resolveLocttDir,
  resolveMilestoneIdFromInput,
  unarchiveMilestone,
} from "@loctt/core";

import { getArg, hasFlag, positional, rejectUnknownFlags } from "../runtime/args.js";
import { getConfigPagination, getFilterArg, pageConfigList, renderBrokenEntries, truncationNotice } from "../runtime/config-list.js";
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
const ACCEPTED_FLAGS: readonly string[] = ["--all", "--archived", "--filter", "--ids", "--limit", "--name", "--offset", "--progress", "--remap-to", "--target-date", "--yes"];

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
      // K90 order (matching the web `handleListMilestones`): archived
      // filter, then name filter, then page. Progress is computed over
      // the paged window only, so a page's `--progress` scan is bounded.
      const visible = cfg.milestones.filter(m => includeArchived || m.archived !== true);
      const matched = filterByName(visible, getFilterArg(args));
      const page = pageConfigList(matched, getConfigPagination(args));
      const shown = page.items;

      // Opt-in: progress scans every task, and `milestone list` is
      // otherwise a config read.
      let progress: Record<string, MilestoneProgressResult> = {};
      if (showProgress) {
        const workflow = await loadWorkflowConfig(locttDir);
        const report = await milestoneProgressDetailed(locttDir, shown.map(m => m.id), workflow);
        progress = report.progress;
        // K28 (aggregate half): an unreadable task cannot be attributed
        // to a milestone (its milestone field is exactly what failed to
        // parse), so the totals count only the readable corpus. Naming
        // the files a total is short by — rather than silently dropping
        // them — is P-5: a wrong number needs its explanation beside it.
        if (report.unreadable.length > 0) {
          console.error(
            `Warning: ${report.unreadable.length} task(s) could not be read and are excluded from these totals:`,
          );
          for (const u of report.unreadable) console.error(`  ${u.path}: ${u.reason}`);
        }
      }

      for (const m of shown) {
        const arch = m.archived === true ? " (archived)" : "";
        const due = m.target_date ? `  due ${m.target_date}` : "";
        const idCol = showIds ? `\t${m.id}` : "";
        const p = progress[m.id];
        // MSL-35: a per-milestone failure reads "progress unavailable" in
        // place of the numbers for THIS row only — the other rows above
        // and below still print their real done/total. Name the excluded
        // discarded tasks where the number is shown: silently shrinking a
        // denominator is as confusing as leaving dead work in it.
        const prog = p === undefined
          ? ""
          : isProgressUnavailable(p)
            ? "  (progress unavailable)"
            : `  ${p.done}/${p.total}${p.discarded > 0 ? ` (${p.discarded} discarded, excluded)` : ""}`;
        console.log(`${m.name}${idCol}${due}${prog}${arch}`);
      }
      // DEG-C3: surface a hand-broken milestone entry preserved in
      // `cfg.broken` so one broken milestone does not read as "no
      // milestones".
      renderBrokenEntries(cfg.broken);
      const notice = truncationNotice(page);
      if (notice !== undefined) console.log(notice);
      break;
    }
    case "create": {
      await runCommand(async () => {
        // A flag here is a mistyped name, not a name. See
        // `positional`: `--name "X"` used to create an entity
        // literally called `--name`, silently, exit 0.
        const name = positional(args, 2, "loctt milestone create <name> [--target-date <YYYY-MM-DD>]");
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
        if (name === undefined && td === undefined && archivedArg === undefined) {
          throw new UsageError(
            "nothing to change",
            "loctt milestone edit <name|id> [--name <new>] [--target-date <YYYY-MM-DD|->] [--archived <true|false>]",
          );
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
