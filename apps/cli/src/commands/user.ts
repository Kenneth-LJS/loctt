import {
  archiveUser,
  createUser,
  deleteUser,
  getCurrentUser,
  loadAllUsers,
  resolveLocttDir,
  resolveUserRef,
  switchCurrentUser,
  unarchiveUser,
  updateUser,
  UserError,
} from "@loctt/core";

import { getArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "../runtime/errors.js";

/**
 * `loctt user <subcommand>` — user lifecycle + switch-current.
 *
 * `delete` is the only entity whose body has two confirm-style
 * pre-checks (--remap-to / --unassign mutex AND the destructive
 * prompt). Both stay outside runCommand because their outcomes
 * carry their own exit-code semantics.
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
const ACCEPTED_FLAGS: readonly string[] = ["--all", "--avatar", "--email", "--name", "--remap-to", "--switch", "--timezone", "--unassign", "--yes"];

export async function run(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, ACCEPTED_FLAGS);
  const sub = args[1];
  const locttDir = resolveLocttDir(root);
  switch (sub) {
    case "list": {
      const includeArchived = hasFlag(args, "--all");
      const users = await loadAllUsers(locttDir);
      const current = await getCurrentUser(locttDir);
      for (const u of users) {
        if (!includeArchived && u.archived === true) continue;
        const star = current?.id === u.id ? " *" : "";
        const arch = u.archived === true ? " (archived)" : "";
        const email = u.email ? `  <${u.email}>` : "";
        console.log(`${u.id}${star}\t${u.name}${arch}${email}\t${u.timezone}`);
      }
      break;
    }
    case "current": {
      const current = await getCurrentUser(locttDir);
      if (!current) {
        console.log("(no users registered)");
        process.exitCode = EXIT.RUNTIME;
        break;
      }
      console.log(`${current.id}\t${current.name}`);
      break;
    }
    case "switch": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing user ref", "loctt user switch <id-or-name>");
        }
        const target = await resolveUserRef(locttDir, ref);
        await switchCurrentUser(locttDir, target.id);
        console.log(`Switched to ${target.name} (${target.id})`);
      });
      break;
    }
    case "create": {
      await runCommand(async () => {
        const name = args[2];
        if (!name) {
          throw new UsageError(
            "missing name",
            "loctt user create <name> [--email <e>] [--timezone <tz>] [--avatar <path>] [--switch]",
          );
        }
        const email = getArg(args, "--email");
        const timezone = getArg(args, "--timezone");
        const avatarSourcePath = getArg(args, "--avatar");
        const switchToOnCreate = hasFlag(args, "--switch");
        const created = await createUser(locttDir, {
          name,
          ...(email !== undefined ? { email } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(avatarSourcePath !== undefined ? { avatarSourcePath } : {}),
          switchToOnCreate,
        });
        console.log(`Created user ${created.name} (${created.id})`);
      });
      break;
    }
    case "edit": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError(
            "missing user ref",
            "loctt user edit <id-or-name> [--name <n>] [--email <e>] [--timezone <tz>] [--avatar <path>]",
          );
        }
        const target = await resolveUserRef(locttDir, ref);
        const name = getArg(args, "--name");
        const email = getArg(args, "--email");
        const timezone = getArg(args, "--timezone");
        const avatarSourcePath = getArg(args, "--avatar");
        await updateUser(locttDir, target.id, {
          ...(name !== undefined ? { name } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(avatarSourcePath !== undefined ? { avatarSourcePath } : {}),
        });
        console.log(`Updated user ${target.id}`);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      await runCommand(async () => {
        const ref = args[2];
        if (!ref) {
          throw new UsageError("missing user ref", `loctt user ${sub} <id-or-name>`);
        }
        const target = await resolveUserRef(locttDir, ref);
        if (sub === "archive") await archiveUser(locttDir, target.id);
        else await unarchiveUser(locttDir, target.id);
        console.log(`${sub === "archive" ? "Archived" : "Unarchived"} user ${target.name}`);
      });
      break;
    }
    case "delete": {
      const ref = args[2];
      if (!ref) {
        console.error(`Error: missing user ref`);
        console.error(`Usage: loctt user delete <id-or-name> [--remap-to <id-or-name> | --unassign] [--yes]`);
        process.exitCode = EXIT.USAGE;
        break;
      }
      const remapToRef = getArg(args, "--remap-to");
      const unassign = hasFlag(args, "--unassign");
      if (remapToRef !== undefined && unassign) {
        console.error("Error: --remap-to and --unassign are mutually exclusive");
        process.exitCode = EXIT.USAGE;
        break;
      }
      // Confirm prompt has its own exit-code semantics (refused
      // = usage, no = success), so it stays outside runCommand.
      // Resolve the user ref outside the wrapper too so we can
      // include the human-readable name in the prompt.
      let target;
      try {
        target = await resolveUserRef(locttDir, ref);
      } catch (err) {
        if (err instanceof UserError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = EXIT.RUNTIME;
          break;
        }
        throw err;
      }
      const outcome = await confirmHardDelete(
        args,
        `Permanently delete user ${target.name} (${target.id})? ` +
        `This will rewrite affected tasks. ` +
        `(use 'loctt user archive' for a reversible alternative)`,
      );
      if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
      await runCommand(async () => {
        const remapTo = remapToRef !== undefined
          ? (await resolveUserRef(locttDir, remapToRef)).id
          : undefined;
        const result = await deleteUser(locttDir, target.id, {
          ...(remapTo !== undefined ? { remapTo } : {}),
          ...(unassign ? { unassign: true } : {}),
        });
        if (result.remappedAssigneeCount + result.remappedReporterCount > 0) {
          console.log(
            `Updated ${result.remappedAssigneeCount} assignee(s) and ` +
            `${result.remappedReporterCount} reporter(s)`,
          );
        }
        console.log(`Deleted user ${target.name}`);
      });
      break;
    }
    default:
      console.error(`Usage: loctt user <list|current|switch|create|edit|archive|unarchive|delete> ...`);
      process.exitCode = EXIT.USAGE;
      break;
  }
}
