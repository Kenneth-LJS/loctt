import {
  archiveSprint,
  createSprint,
  deleteSprint,
  editSprint,
  loadSprintsConfig,
  readBurndownSeries,
  resolveLocttDir,
  unarchiveSprint,
} from "@loctt/core";

import { formatNumber, pad } from "../format/value.js";
import { getArg, hasFlag } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt sprint <subcommand>` — sprint lifecycle + burndown
 * series. `burndown` is the only entity command that renders an
 * actual table (rather than a one-per-entity list), so the
 * format/value helpers are imported here.
 */
export async function run(args: string[], root: string): Promise<void> {
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const cfg = await loadSprintsConfig(locttDir);
      for (const s of cfg.sprints) {
        if (!includeArchived && s.archived === true) continue;
        const goal = s.goal ? `  "${s.goal}"` : "";
        const arch = s.archived === true ? "  (archived)" : "";
        console.log(`${s.key}\t${s.label}\t[${s.state}]\t${s.start_date}..${s.end_date}${goal}${arch}`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const key = args[2];
        const start = getArg(args, "--start");
        const end = getArg(args, "--end");
        const state = getArg(args, "--state") ?? "future";
        if (!key || !start || !end) {
          throw new UsageError(
            "missing key, --start, or --end",
            "loctt sprint create <key> --start <YYYY-MM-DD> --end <YYYY-MM-DD> [--state <active|completed|future>] [--label <l>] [--goal <g>]",
          );
        }
        if (state !== "active" && state !== "completed" && state !== "future") {
          throw new UsageError("--state must be one of active|completed|future");
        }
        const label = getArg(args, "--label") ?? key;
        const goal = getArg(args, "--goal");
        await createSprint(locttDir, {
          key,
          label,
          start_date: start,
          end_date: end,
          state,
          ...(goal !== undefined ? { goal } : {}),
        });
        console.log(`Created sprint ${key}`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError(
            "missing key",
            "loctt sprint edit <key> [--label <l>] [--start <d>] [--end <d>] [--state <s>] [--goal <g|->] [--force]",
          );
        }
        const label = getArg(args, "--label");
        const start = getArg(args, "--start");
        const end = getArg(args, "--end");
        const state = getArg(args, "--state");
        const force = hasFlag(args, "--force");
        if (state !== undefined && state !== "active" && state !== "completed" && state !== "future") {
          throw new UsageError("--state must be one of active|completed|future");
        }
        const goalArg = getArg(args, "--goal");
        await editSprint(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...(start !== undefined ? { start_date: start } : {}),
          ...(end !== undefined ? { end_date: end } : {}),
          ...(state !== undefined ? { state } : {}),
          ...(goalArg !== undefined ? { goal: goalArg === "-" ? null : goalArg } : {}),
          ...(force ? { force: true } : {}),
        });
        console.log(`Updated sprint ${key}`);
      });
      break;
    }
    case "delete": {
      const key = args[2];
      if (!key) {
        console.error(`Error: missing key`);
        console.error(`Usage: loctt sprint delete <key> [--remap-to <other>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = getArg(args, "--remap-to");
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete sprint ${key}? This will rewrite affected tasks. (use 'loctt sprint archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const result = await deleteSprint(locttDir, key, {
          hard: true,
          ...(remapTo !== undefined ? { remapTo } : {}),
        });
        if (result.affectedTaskCount > 0) {
          const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "cleared from";
          console.log(`${action} ${result.affectedTaskCount} task(s)`);
        }
        console.log(`Deleted sprint ${key}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError("missing key", `loctt sprint ${sub} <key>`);
        }
        if (sub === "archive") await archiveSprint(locttDir, key);
        else await unarchiveSprint(locttDir, key);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} sprint ${key}`);
      });
      break;
    }
    case "burndown": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError(
            "missing key",
            "loctt sprint burndown <key> [--format <table|json>]",
          );
        }
        const format = getArg(args, "--format") ?? "table";
        if (format !== "table" && format !== "json") {
          throw new UsageError("--format must be one of table|json");
        }
        const series = await readBurndownSeries(locttDir, key);
        if (format === "json") {
          console.log(JSON.stringify(series, null, 2));
          return;
        }
        const unitDisplay = series.unitLabel ?? series.unit;
        console.log(`Sprint:        ${series.sprintKey}`);
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
