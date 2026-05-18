import {
  archiveLabel,
  createLabel,
  deleteLabel,
  editLabel,
  loadLabelsConfig,
  resolveLocttDir,
  unarchiveLabel,
} from "@loctt/core";

import { getArg, hasFlag } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt label <subcommand>` — label lifecycle.
 *
 * `delete` keeps its confirm prompt outside runCommand for the
 * exit-code-disambiguation reason (refused = USAGE, no = SUCCESS).
 */
export async function run(args: string[], root: string): Promise<void> {
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const cfg = await loadLabelsConfig(locttDir);
      for (const l of cfg.labels) {
        if (!includeArchived && l.archived === true) continue;
        const color = l.color ? `  ${l.color}` : "";
        const arch = l.archived === true ? "  (archived)" : "";
        console.log(`${l.key}\t${l.label}${color}${arch}`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError(
            "missing key",
            "loctt label create <key> [--label <label>] [--color <hex>]",
          );
        }
        const label = getArg(args, "--label") ?? key;
        const color = getArg(args, "--color");
        await createLabel(locttDir, {
          key,
          label,
          ...(color !== undefined ? { color } : {}),
        });
        console.log(`Created label ${key}`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError(
            "missing key",
            "loctt label edit <key> [--label <label>] [--color <hex|->]",
          );
        }
        const label = getArg(args, "--label");
        const colorArg = getArg(args, "--color");
        await editLabel(locttDir, key, {
          ...(label !== undefined ? { label } : {}),
          ...(colorArg !== undefined
            ? { color: colorArg === "-" ? null : colorArg }
            : {}),
        });
        console.log(`Updated label ${key}`);
      });
      break;
    }
    case "delete": {
      const key = args[2];
      if (!key) {
        console.error(`Error: missing key`);
        console.error(`Usage: loctt label delete <key> [--remap-to <other>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = getArg(args, "--remap-to");
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete label ${key}? This will rewrite affected tasks. (use 'loctt label archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const result = await deleteLabel(locttDir, key, {
          hard: true,
          ...(remapTo !== undefined ? { remapTo } : {}),
        });
        if (result.affectedTaskCount > 0) {
          const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "removed from";
          console.log(`${action} ${result.affectedTaskCount} task(s)`);
        }
        console.log(`Deleted label ${key}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError("missing key", `loctt label ${sub} <key>`);
        }
        if (sub === "archive") await archiveLabel(locttDir, key);
        else await unarchiveLabel(locttDir, key);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} label ${key}`);
      });
      break;
    }
    default:
      console.error(`Usage: loctt label <list|create|edit|archive|unarchive|delete> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
