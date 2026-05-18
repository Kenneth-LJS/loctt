import {
  archiveProject,
  createProject,
  deleteProject,
  editProject,
  loadProjectsConfig,
  resolveLocttDir,
  setDefaultProject,
  unarchiveProject,
} from "@loctt/core";

import { getArg, hasFlag } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt project <subcommand>` — dispatcher for the project
 * lifecycle. Each subcommand body matches the pattern from the
 * original index.ts switch.
 *
 * `delete` deliberately keeps its confirm prompt outside
 * runCommand because the prompt's outcome carries its own
 * exit-code semantics (refused = USAGE, no = SUCCESS); folding
 * it into runCommand would conflate the two.
 */
export async function run(args: string[], root: string): Promise<void> {
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const cfg = await loadProjectsConfig(locttDir);
      for (const p of cfg.projects) {
        if (!includeArchived && p.archived === true) continue;
        const star = cfg.default === p.key ? " *" : "";
        const arch = p.archived === true ? " (archived)" : "";
        console.log(`${p.key}${star}\t${p.label}\t${p.prefix}${arch}`);
      }
      if (cfg.default !== undefined) {
        console.log(``);
        console.log(`* = workspace default`);
      }
      break;
    }
    case "create": {
      await runCommand(async () => {
        const key = args[2];
        const prefix = getArg(args, "--prefix");
        if (!key || !prefix) {
          throw new UsageError(
            "missing key or --prefix",
            "loctt project create <key> --prefix <prefix> [--label <label>] [--default]",
          );
        }
        const label = getArg(args, "--label") ?? key;
        await createProject(locttDir, { key, label, prefix });
        if (hasFlag(args, "--default")) {
          await setDefaultProject(locttDir, key);
        }
        console.log(`Created project ${key} (prefix ${prefix})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const key = args[2];
        const label = getArg(args, "--label");
        if (!key) {
          throw new UsageError("missing key", "loctt project edit <key> [--label <label>]");
        }
        if (label === undefined) {
          throw new UsageError("nothing to update; pass --label");
        }
        await editProject(locttDir, key, { label });
        console.log(`Updated project ${key}`);
      });
      break;
    }
    case "delete": {
      const key = args[2];
      const remapTo = getArg(args, "--remap-to");
      if (!key) {
        console.error(`Error: missing key`);
        console.error(`Usage: loctt project delete <key> [--remap-to <other-key>] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete project ${key}? This will rewrite affected tasks. (use 'loctt project archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const result = await deleteProject(locttDir, key, {
          hard: true,
          ...(remapTo !== undefined ? { remapTo } : {}),
        });
        if (result.remappedTaskCount > 0) {
          console.log(`Remapped ${result.remappedTaskCount} task(s) to ${remapTo}`);
        }
        console.log(`Deleted project ${key}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError("missing key", `loctt project ${sub} <key>`);
        }
        if (sub === "archive") await archiveProject(locttDir, key);
        else await unarchiveProject(locttDir, key);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} project ${key}`);
      });
      break;
    }
    case "set-default": {
      await runCommand(async () => {
        const key = args[2];
        if (!key) {
          throw new UsageError("missing key", "loctt project set-default <key|->");
        }
        await setDefaultProject(locttDir, key === "-" ? null : key);
        console.log(key === "-" ? `Cleared workspace default project` : `Set workspace default to ${key}`);
      });
      break;
    }
    default:
      console.error(`Usage: loctt project <list|create|edit|archive|unarchive|delete|set-default> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
