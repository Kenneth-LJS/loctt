import {
  archiveSprint,
  createSprint,
  deleteSprint,
  editSprint,
  loadSprintsConfig,
  readBurndownSeries,
  resolveLocttDir,
  resolveSprintIdFromInput,
  unarchiveSprint,
} from "@loctt/core";

import { formatNumber, pad } from "../format/value.js";
import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt sprint <subcommand>` — sprint lifecycle + burndown series.
 *
 * Sprint references accepted as either an id (ULID) or a name.
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
const ACCEPTED_FLAGS: readonly string[] = ["--all", "--end", "--force", "--format", "--goal", "--ids", "--name", "--remap-to", "--start", "--state", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const showIds = hasFlag(args, "--ids");
      const cfg = await loadSprintsConfig(locttDir);
      for (const s of cfg.sprints) {
        if (!includeArchived && s.archived === true) continue;
        const goal = s.goal ? `  "${s.goal}"` : "";
        const arch = s.archived === true ? "  (archived)" : "";
        const idCol = showIds ? `\t${s.id}` : "";
        console.log(`${s.name}${idCol}\t[${s.state}]\t${s.start_date}..${s.end_date}${goal}${arch}`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const name = args[2];
        const start = getArg(args, "--start");
        const end = getArg(args, "--end");
        const state = getArg(args, "--state") ?? "future";
        if (!name || !start || !end) {
          throw new UsageError(
            "missing name, --start, or --end",
            "loctt sprint create <name> --start <YYYY-MM-DD> --end <YYYY-MM-DD> [--state <active|completed|future>] [--goal <g>]",
          );
        }
        if (state !== "active" && state !== "completed" && state !== "future") {
          throw new UsageError("--state must be one of active|completed|future");
        }
        const goal = getArg(args, "--goal");
        const def = await createSprint(locttDir, {
          name,
          start_date: start,
          end_date: end,
          state,
          ...(goal !== undefined ? { goal } : {}),
        });
        console.log(`Created sprint "${name}" (id ${def.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError(
            "missing sprint ref",
            "loctt sprint edit <name|id> [--name <n>] [--start <d>] [--end <d>] [--state <s>] [--goal <g|->] [--force]",
          );
        }
        const cfg = await loadSprintsConfig(locttDir);
        const id = resolveSprintIdFromInput(cfg, ref, { includeArchived: true });
        const name = getArg(args, "--name");
        const start = getArg(args, "--start");
        const end = getArg(args, "--end");
        const state = getArg(args, "--state");
        const force = hasFlag(args, "--force");
        if (state !== undefined && state !== "active" && state !== "completed" && state !== "future") {
          throw new UsageError("--state must be one of active|completed|future");
        }
        const goalArg = getArg(args, "--goal");
        // `--force` alone is not a change: it only relaxes a guard on
        // one, so an edit naming nothing still reported success.
        if (name === undefined && start === undefined && end === undefined
            && state === undefined && goalArg === undefined) {
          throw new UsageError(
            "nothing to change",
            "loctt sprint edit <name|id> [--name <n>] [--start <d>] [--end <d>] [--state <s>] [--goal <g|->] [--force]",
          );
        }
        await editSprint(locttDir, id, {
          ...(name !== undefined ? { name } : {}),
          ...(start !== undefined ? { start_date: start } : {}),
          ...(end !== undefined ? { end_date: end } : {}),
          ...(state !== undefined ? { state } : {}),
          ...(goalArg !== undefined ? { goal: goalArg === "-" ? null : goalArg } : {}),
          ...(force ? { force: true } : {}),
        });
        console.log(`Updated sprint ${ref}`);
      });
      break;
    }
    case "delete": {
      const ref = args[2];
      if (!ref) {
        console.error(`Error: missing sprint ref`);
        console.error(`Usage: loctt sprint delete <name|id> [--remap-to <other>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = getArg(args, "--remap-to");
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete sprint ${ref}? This will rewrite affected tasks. (use 'loctt sprint archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const cfg = await loadSprintsConfig(locttDir);
        const id = resolveSprintIdFromInput(cfg, ref, { includeArchived: true });
        const remapToId = remapTo !== undefined ? resolveSprintIdFromInput(cfg, remapTo) : undefined;
        const result = await deleteSprint(locttDir, id, {
          hard: true,
          ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
        });
        if (result.affectedTaskCount > 0) {
          const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "cleared from";
          console.log(`${action} ${result.affectedTaskCount} task(s)`);
        }
        console.log(`Deleted sprint ${ref}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing sprint ref", `loctt sprint ${sub} <name|id>`);
        }
        const cfg = await loadSprintsConfig(locttDir);
        const id = resolveSprintIdFromInput(cfg, ref, { includeArchived: true });
        if (sub === "archive") await archiveSprint(locttDir, id);
        else await unarchiveSprint(locttDir, id);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} sprint ${ref}`);
      });
      break;
    }
    case "burndown": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError(
            "missing sprint ref",
            "loctt sprint burndown <name|id> [--format <table|json>]",
          );
        }
        const format = getArg(args, "--format") ?? "table";
        if (format !== "table" && format !== "json") {
          throw new UsageError("--format must be one of table|json");
        }
        const cfg = await loadSprintsConfig(locttDir);
        const id = resolveSprintIdFromInput(cfg, ref, { includeArchived: true });
        const series = await readBurndownSeries(locttDir, id);
        if (format === "json") {
          console.log(JSON.stringify(series, null, 2));
          return;
        }
        const unitDisplay = series.unitLabel ?? series.unit;
        console.log(`Sprint:        ${series.sprintId}`);
        console.log(`Window:        ${series.start} .. ${series.end}`);
        console.log(`Unit:          ${unitDisplay}`);
        console.log(`Initial total: ${series.initialTotal}`);
        console.log(``);
        console.log(`Date          Remaining    Incomplete    Ideal`);
        for (let i = 0; i < series.series.length; i++) {
          const p = series.series[i];
          const ideal = series.ideal[i];
          if (!p) continue;
          const idealStr = ideal ? formatNumber(ideal.remaining) : "";
          console.log(
            `${p.date}    ${pad(formatNumber(p.remaining), 9)}    ${pad(String(p.incompleteTaskCount), 10)}    ${idealStr}`,
          );
        }
      });
      break;
    }
    default:
      console.error(`Usage: loctt sprint <list|create|edit|archive|unarchive|delete|burndown> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
