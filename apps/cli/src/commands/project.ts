import {
  archiveProject,
  createProject,
  deleteProject,
  editProject,
  loadProjectsConfig,
  resolveLocttDir,
  resolveProjectIdFromInput,
  setDefaultProject,
  unarchiveProject,
} from "@loctt/core";

import { getArg, hasFlag } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt project <subcommand>` — dispatcher for the project lifecycle.
 *
 * Project references are accepted as either a name (unambiguous match)
 * or the internal ULID. `loctt project list` shows names and prefixes;
 * the id is omitted by default to keep output friendly.
 *
 * `delete` deliberately keeps its confirm prompt outside `runCommand`
 * because the prompt's outcome carries its own exit-code semantics
 * (refused = USAGE, no = SUCCESS); folding it into runCommand would
 * conflate the two.
 */
export async function run(args: string[], root: string): Promise<void> {
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const showIds = hasFlag(args, "--ids");
      const cfg = await loadProjectsConfig(locttDir);
      for (const p of cfg.projects) {
        if (!includeArchived && p.archived === true) continue;
        const star = cfg.default === p.id ? " *" : "";
        const arch = p.archived === true ? " (archived)" : "";
        const idCol = showIds ? `\t${p.id}` : "";
        console.log(`${p.name}${star}\t${p.prefix}${idCol}${arch}`);
      }
      if (cfg.default !== undefined) {
        console.log(``);
        console.log(`* = workspace default${showIds ? "" : "; pass --ids to also print internal ids"}`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const name = args[2];
        const prefix = getArg(args, "--prefix");
        if (!name || !prefix) {
          throw new UsageError(
            "missing name or --prefix",
            "loctt project create <name> --prefix <prefix> [--default]",
          );
        }
        const def = await createProject(locttDir, { name, prefix });
        if (hasFlag(args, "--default")) {
          await setDefaultProject(locttDir, def.id);
        }
        console.log(`Created project "${name}" (prefix ${prefix}, id ${def.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        const name = getArg(args, "--name");
        if (!ref) {
          throw new UsageError("missing project ref", "loctt project edit <name|id> [--name <new-name>]");
        }
        if (name === undefined) {
          throw new UsageError("nothing to update; pass --name");
        }
        const cfg = await loadProjectsConfig(locttDir);
        const id = resolveProjectIdFromInput(cfg, ref);
        await editProject(locttDir, id, { name });
        console.log(`Updated project ${id} (now "${name}")`);
      });
      break;
    }
    case "delete": {
      const ref = args[2];
      const remapTo = getArg(args, "--remap-to");
      if (!ref) {
        console.error(`Error: missing project ref`);
        console.error(`Usage: loctt project delete <name|id> [--remap-to <name|id>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete project ${ref}? This will rewrite affected tasks. (use 'loctt project archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const cfg = await loadProjectsConfig(locttDir);
        const id = resolveProjectIdFromInput(cfg, ref);
        const remapToId = remapTo !== undefined ? resolveProjectIdFromInput(cfg, remapTo) : undefined;
        const result = await deleteProject(locttDir, id, {
          hard: true,
          ...(remapToId !== undefined ? { remapTo: remapToId } : {}),
        });
        if (result.remappedTaskCount > 0) {
          console.log(`Remapped ${result.remappedTaskCount} task(s) to ${remapTo}`);
        }
        console.log(`Deleted project ${ref}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing project ref", `loctt project ${sub} <name|id>`);
        }
        const cfg = await loadProjectsConfig(locttDir);
        const id = resolveProjectIdFromInput(cfg, ref, { includeArchived: true });
        if (sub === "archive") await archiveProject(locttDir, id);
        else await unarchiveProject(locttDir, id);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} project ${ref}`);
      });
      break;
    }
    case "set-default": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing project ref", "loctt project set-default <name|id|->");
        }
        if (ref === "-") {
          await setDefaultProject(locttDir, null);
          console.log(`Cleared workspace default project`);
        } else {
          await setDefaultProject(locttDir, ref);
          console.log(`Set workspace default to ${ref}`);
        }
      });
      break;
    }
    default:
      console.error(`Usage: loctt project <list|create|edit|archive|unarchive|delete|set-default> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
