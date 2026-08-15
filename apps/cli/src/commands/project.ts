import {
  archiveProject,
  createProject,
  deleteProject,
  editProject,
  loadAllTasks,
  loadProjectsConfig,
  resolveLocttDir,
  resolveProjectIdFromInput,
  setDefaultProject,
  setProjectPrefix,
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
    case "set-prefix": {
      const ref = args[2];
      const newPrefix = args[3];
      if (!ref || !newPrefix) {
        console.error(`Error: missing project ref or prefix`);
        console.error(`Usage: loctt project set-prefix <name|id> <new-prefix> [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }

      // Resolve and count before prompting: the confirmation has to
      // state the blast radius in numbers (PRU-C10), and "this will
      // rename some tasks" is not a number. Resolution errors surface
      // here rather than after the user has already said yes.
      let id: string;
      let affected: number;
      let currentPrefix: string;
      try {
        const cfg = await loadProjectsConfig(locttDir);
        id = resolveProjectIdFromInput(cfg, ref);
        const project = cfg.projects.find(p => p.id === id);
        currentPrefix = project?.prefix ?? "";
        const tasks = await loadAllTasks(locttDir);
        affected = tasks.filter(t => t.frontmatter.project === id).length;
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = EXIT.RUNTIME;
        break;
      }

      // Setting the prefix a project already has changes nothing, so
      // there is no blast radius to confirm (PRU-C11).
      if (currentPrefix === newPrefix) {
        console.log(`Project ${ref} already uses prefix ${newPrefix}; nothing to do`);
        break;
      }

      const outcome = await confirmHardDelete(
        args,
        `Rename ${affected} task(s) in ${ref} from ${currentPrefix} to ${newPrefix}? ` +
        `Numbers are preserved (${currentPrefix}1 becomes ${newPrefix}1) and old keys ` +
        `keep resolving via key_history.`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }

      await runCommand(async () => {
        const result = await setProjectPrefix(locttDir, id, newPrefix);
        console.log(
          `Renamed ${result.renamed} task(s) from ${result.from} to ${result.to}`,
        );
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
      console.error(`Usage: loctt project <list|create|edit|set-prefix|archive|unarchive|delete|set-default> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
