import {
  applyArchivedScope,
  archiveLabel,
  createLabel,
  deleteLabel,
  editLabel,
  filterByName,
  loadLabelsConfig,
  resolveLabelIdFromInput,
  resolveLocttDir,
  unarchiveLabel,
} from "@loctt/core";

import { getArg, hasFlag, parseArchivedScope, positional, rejectUnknownFlags } from "../runtime/args.js";
import { COLOR_ARG_SYNTAX, formatEntityColor, parseEntityColorArg, warnUnknownPalette } from "../runtime/color.js";
import { getConfigPagination, getFilterArg, pageConfigList, renderBrokenEntries, truncationNotice } from "../runtime/config-list.js";
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
const ACCEPTED_FLAGS: readonly string[] = ["--all", "--archived", "--color", "--filter", "--ids", "--limit", "--name", "--offset", "--remap-to", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const scope = parseArchivedScope(args);
      const showIds = hasFlag(args, "--ids");
      const cfg = await loadLabelsConfig(locttDir);
      // K90/K107 order (matching the web `handleListLabels`): archived
      // scope, then name filter, then page. Default scope `active` hides
      // archived; `--archived archived|all` (and the deprecated `--all`
      // alias) widen it.
      const visible = applyArchivedScope(cfg.labels, scope);
      const matched = filterByName(visible, getFilterArg(args));
      const page = pageConfigList(matched, getConfigPagination(args));
      for (const l of page.items) {
        const color = l.color !== undefined ? `  ${formatEntityColor(l.color)}` : "";
        const arch = l.archived === true ? "  (archived)" : "";
        const idCol = showIds ? `\t${l.id}` : "";
        console.log(`${l.name}${idCol}${color}${arch}`);
      }
      // DEG-C3: surface a hand-broken label entry preserved in `cfg.broken`
      // so one broken label does not read as "no labels".
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
        const usage = `loctt label create <name> [--color <${COLOR_ARG_SYNTAX}>]`;
        const name = positional(args, 2, usage);
        if (!name) {
          throw new UsageError("missing name", usage);
        }
        const raw = getArg(args, "--color");
        // K103: all three shapes, not just a hex — core's
        // `CreateLabelInput.color` is an `EntityColor`.
        const color = raw !== undefined ? warnUnknownPalette(parseEntityColorArg(raw)) : undefined;
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
        const usage = `loctt label edit <name|id> [--name <new-name>] [--color <${COLOR_ARG_SYNTAX}|->]`;
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing label ref", usage);
        }
        const cfg = await loadLabelsConfig(locttDir);
        const id = resolveLabelIdFromInput(cfg, ref, { includeArchived: true });
        const name = getArg(args, "--name");
        const colorArg = getArg(args, "--color");
        if (name === undefined && colorArg === undefined) {
          throw new UsageError("nothing to change", usage);
        }
        await editLabel(locttDir, id, {
          ...(name !== undefined ? { name } : {}),
          ...(colorArg !== undefined
            ? { color: colorArg === "-" ? null : warnUnknownPalette(parseEntityColorArg(colorArg)) }
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
