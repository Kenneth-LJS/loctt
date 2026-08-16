import {
  archiveLabel,
  createLabel,
  deleteLabel,
  editLabel,
  loadLabelsConfig,
  resolveLabelIdFromInput,
  resolveLocttDir,
  unarchiveLabel,
} from "@loctt/core";

import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt label <subcommand>` — label lifecycle.
 *
 * Label references accepted as either an id (ULID) or a name; the
 * `list` command prints names + ids so users can disambiguate.
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
const ACCEPTED_FLAGS: readonly string[] = ["--all", "--color", "--ids", "--name", "--remap-to", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const showIds = hasFlag(args, "--ids");
      const cfg = await loadLabelsConfig(locttDir);
      for (const l of cfg.labels) {
        if (!includeArchived && l.archived === true) continue;
        const color = l.color ? `  ${l.color}` : "";
        const arch = l.archived === true ? "  (archived)" : "";
        const idCol = showIds ? `\t${l.id}` : "";
        console.log(`${l.name}${idCol}${color}${arch}`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const name = args[2];
        if (!name) {
          throw new UsageError(
            "missing name",
            "loctt label create <name> [--color <hex>]",
          );
        }
        const color = getArg(args, "--color");
        const def = await createLabel(locttDir, {
          name,
          ...(color !== undefined ? { color } : {}),
        });
        console.log(`Created label "${name}" (id ${def.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError(
            "missing label ref",
            "loctt label edit <name|id> [--name <new-name>] [--color <hex|->]",
          );
        }
        const cfg = await loadLabelsConfig(locttDir);
        const id = resolveLabelIdFromInput(cfg, ref, { includeArchived: true });
        const name = getArg(args, "--name");
        const colorArg = getArg(args, "--color");
        if (name === undefined && colorArg === undefined) {
          throw new UsageError(
            "nothing to change",
            "loctt label edit <name|id> [--name <new-name>] [--color <hex|->]",
          );
        }
        await editLabel(locttDir, id, {
          ...(name !== undefined ? { name } : {}),
          ...(colorArg !== undefined
            ? { color: colorArg === "-" ? null : colorArg }
            : {}),
        });
        console.log(`Updated label ${ref}`);
      });
      break;
    }
    case "delete": {
      const ref = args[2];
      if (!ref) {
        console.error(`Error: missing label ref`);
        console.error(`Usage: loctt label delete <name|id> [--remap-to <other>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapTo = getArg(args, "--remap-to");
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete label ${ref}? This will rewrite affected tasks. (use 'loctt label archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const cfg = await loadLabelsConfig(locttDir);
        const id = resolveLabelIdFromInput(cfg, ref, { includeArchived: true });
        const remapToId = remapTo !== undefined ? resolveLabelIdFromInput(cfg, remapTo) : undefined;
        const result = await deleteLabel(locttDir, id, {
          hard: true,
          ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
        });
        if (result.affectedTaskCount > 0) {
          const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "removed from";
          console.log(`${action} ${result.affectedTaskCount} task(s)`);
        }
        console.log(`Deleted label ${ref}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing label ref", `loctt label ${sub} <name|id>`);
        }
        const cfg = await loadLabelsConfig(locttDir);
        const id = resolveLabelIdFromInput(cfg, ref, { includeArchived: true });
        if (sub === "archive") await archiveLabel(locttDir, id);
        else await unarchiveLabel(locttDir, id);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} label ${ref}`);
      });
      break;
    }
    default:
      console.error(`Usage: loctt label <list|create|edit|archive|unarchive|delete> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
