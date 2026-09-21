import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatIfZodError,
  recoverInterruptedPrefixRename,
  requireSupportedSchema,
  resolveLocttDir,
} from "@loctt/core";

import * as backupCmd from "./commands/backup.js";
import * as calendarCmd from "./commands/calendar.js";
import * as commentsCmd from "./commands/comments.js";
import * as configCmd from "./commands/config.js";
import * as doctorCmd from "./commands/doctor.js";
import * as gitCmd from "./commands/git.js";
import * as infoCmd from "./commands/info.js";
import * as initCmd from "./commands/init.js";
import * as labelCmd from "./commands/label.js";
import * as mcpCmd from "./commands/mcp.js";
import * as migrateCmd from "./commands/migrate.js";
import * as milestoneCmd from "./commands/milestone.js";
import * as paletteCmd from "./commands/palette.js";
import * as projectCmd from "./commands/project.js";
import * as schemaCmd from "./commands/schema.js";
import * as sprintCmd from "./commands/sprint.js";
import * as taskArchiveCmd from "./commands/task-archive.js";
import * as taskCrudCmd from "./commands/task-crud.js";
import * as taskExportCmd from "./commands/task-export.js";
import * as taskFilesCmd from "./commands/task-files.js";
import * as taskLinksCmd from "./commands/task-links.js";
import * as taskRankCmd from "./commands/task-rank.js";
import * as uiCmd from "./commands/ui.js";
import * as userCmd from "./commands/user.js";
import * as viewsCmd from "./commands/views.js";
import * as workflowEntityCmd from "./commands/workflow-entities.js";
import { getArg, stripRootArgs } from "./runtime/args.js";
import { EXIT, runCommand, UsageError } from "./runtime/errors.js";
import { dirExists, SCHEMA_GUARD_EXEMPT_COMMANDS } from "./runtime/schema-guard.js";
import { usage } from "./usage.js";

/**
 * Resolves the tracker root from the two global flags and the env var.
 *
 * - `--root` is canonical; `--cwd` is its back-compat alias.
 * - If both flags are given they must resolve to the same directory;
 *   a genuine conflict throws a {@link UsageError} (exit 2) rather than
 *   silently picking one — operating on the wrong tracker is a data
 *   hazard, so an ambiguous target must fail loudly.
 * - Precedence when no conflict: an explicit flag > `LOCTT_ROOT` >
 *   `process.cwd()`.
 *
 * Relative paths are resolved against `process.cwd()` so `--root ../other`
 * behaves the way a shell user expects.
 */
export function resolveRoot(
  rootFlag: string | undefined,
  cwdFlag: string | undefined,
  envRoot: string | undefined,
): string {
  const resolveAgainstCwd = (p: string): string => resolvePath(process.cwd(), p);

  if (rootFlag !== undefined && cwdFlag !== undefined) {
    const r = resolveAgainstCwd(rootFlag);
    const c = resolveAgainstCwd(cwdFlag);
    if (r !== c) {
      throw new UsageError(
        `--root and --cwd were both given but point at different directories ` +
        `(${r} vs ${c}). They are aliases for the same thing — pass only one, ` +
        `or make them agree. --root is the canonical name.`,
      );
    }
    return r;
  }
  if (rootFlag !== undefined) return resolveAgainstCwd(rootFlag);
  if (cwdFlag !== undefined) return resolveAgainstCwd(cwdFlag);
  if (envRoot !== undefined && envRoot !== "") return resolveAgainstCwd(envRoot);
  return process.cwd();
}

export async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Global tracker-root flag. `--root <dir>` is the canonical name
  // (matching the web server and `LOCTT_ROOT`); `--cwd <dir>` is kept
  // as a back-compat alias so existing scripts keep working. Both point
  // a surface at a tracker without shelling into its directory.
  //
  // Precedence: an explicit flag > the LOCTT_ROOT env var > process.cwd().
  // If both flags are given they must agree; a genuine conflict is a
  // usage error rather than a silent pick-one.
  //
  // Strip both flags from `args` so the first positional becomes the
  // subcommand and `loctt ui`/`loctt mcp` accept the flag directly
  // instead of rejecting it as an unknown option.
  const rootOverride = getArg(rawArgs, "--root");
  const cwdOverride = getArg(rawArgs, "--cwd");
  let root: string;
  try {
    root = resolveRoot(rootOverride, cwdOverride, process.env["LOCTT_ROOT"]);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = EXIT.USAGE;
      return;
    }
    throw err;
  }
  const args = stripRootArgs(rawArgs);
  const command = args[0];

  try {
    // Boot guard: every command that touches an existing tracker
    // must run against a tracker whose schema matches what this
    // CLI knows how to read. Mismatches direct the user to
    // `loctt migrate` rather than silently mutating data the code
    // doesn't fully understand.
    if (!SCHEMA_GUARD_EXEMPT_COMMANDS.has(command)) {
      const locttDir = resolveLocttDir(root);
      if (await dirExists(locttDir)) {
        await requireSupportedSchema(locttDir);
        // Finish any rename that died partway before the command reads
        // a task key. Runs after the schema guard: recovery rewrites
        // task files, which is only safe once the schema is known good.
        const { recovered, error: recoveryError } =
          await recoverInterruptedPrefixRename(locttDir);
        if (recovered) {
          process.stderr.write(
            `Finished an interrupted prefix rename: ` +
            `${recovered.from} → ${recovered.to} ` +
            `(${recovered.renamed} task(s) renamed).\n`,
          );
        } else if (recoveryError) {
          process.stderr.write(
            `Warning: could not finish an interrupted prefix rename: ` +
            `${recoveryError.message}\nRun \`loctt doctor\` for detail.\n`,
          );
        }
      }
      // If the directory doesn't exist, the command will fail
      // naturally via its own existence check (e.g. resolveLocttDir
      // call sites that read state.yaml).
    }

    switch (command) {
      // All wrapped, so an unknown-option UsageError maps to EXIT.USAGE
      // (2) the way every other command's does. These four were
      // unwrapped on the argument that they threw no UsageError — which
      // stopped being true once they validated their flags: `doctor`
      // exited 1 for a usage error, and `info` / `views` / `schema`
      // exited 0 while silently ignoring the flag.
      case "init":   await runCommand(() => initCmd.run(args, root));   break;
      case "info":   await runCommand(() => infoCmd.run(args, root));   break;
      case "doctor": await runCommand(() => doctorCmd.run(args, root)); break;
      case "views":  await runCommand(() => viewsCmd.run(args, root));  break;
      case "schema": await runCommand(() => schemaCmd.run(args, root)); break;
      case "backup":  await runCommand(() => backupCmd.backup(args, root));  break;
      case "restore": await runCommand(() => backupCmd.restore(args, root)); break;

      case "create":    await runCommand(() => taskCrudCmd.create(args, root));    break;
      case "list":      await runCommand(() => taskCrudCmd.list(args, root));      break;
      case "export":    await runCommand(() => taskExportCmd.exportTasks(args, root)); break;
      case "show":      await runCommand(() => taskCrudCmd.show(args, root));      break;
      case "set":       await runCommand(() => taskCrudCmd.set(args, root));       break;
      case "unset":     await runCommand(() => taskCrudCmd.unset(args, root));     break;
      case "body":      await runCommand(() => taskCrudCmd.body(args, root));      break;
      case "log":       await runCommand(() => taskCrudCmd.log(args, root));       break;
      case "duplicate":      await runCommand(() => taskCrudCmd.duplicate(args, root)); break;
      case "move":           await runCommand(() => taskCrudCmd.move(args, root));      break;
      case "comment":        await runCommand(() => commentsCmd.add(args, root));    break;
      case "comments":       await runCommand(() => commentsCmd.list(args, root));   break;
      case "comment-edit":   await runCommand(() => commentsCmd.edit(args, root));   break;
      case "comment-delete": await runCommand(() => commentsCmd.remove(args, root)); break;
      case "delete":    await runCommand(() => taskCrudCmd.deleteCmd(args, root)); break;
      case "archive":   await runCommand(() => taskArchiveCmd.archive(args, root));   break;
      case "unarchive": await runCommand(() => taskArchiveCmd.unarchive(args, root)); break;
      case "attach":    await runCommand(() => taskFilesCmd.attach(args, root));   break;
      case "detach":    await runCommand(() => taskFilesCmd.detach(args, root));   break;
      case "link":      await runCommand(() => taskLinksCmd.link(args, root));     break;
      case "unlink":    await runCommand(() => taskLinksCmd.unlink(args, root));   break;

      case "mcp": await mcpCmd.run(args, root); break;
      case "ui":  await runCommand(() => uiCmd.run(args, root));  break;

      case "project": await runCommand(() => projectCmd.run(args, root)); break;

      case "user": await runCommand(() => userCmd.run(args, root)); break;

      case "label": await runCommand(() => labelCmd.run(args, root)); break;

      // K103: the built-in palette is tracker-independent (it lives in
      // core, not in .loctt/), so this needs no root and no init.
      case "palette": await runCommand(() => { paletteCmd.run(args); return Promise.resolve(); }); break;

      case "milestone": await runCommand(() => milestoneCmd.run(args, root)); break;
      case "sprint":    await runCommand(() => sprintCmd.run(args, root));    break;
      case "calendar":  await runCommand(() => calendarCmd.run(args, root));  break;

      case "rerank":       await runCommand(() => taskRankCmd.rerank(args, root));      break;
      case "board-rerank": await runCommand(() => taskRankCmd.boardRerank(args, root)); break;
      case "board-move":   await runCommand(() => taskRankCmd.boardMoveCmd(args, root)); break;

      // Workflow.yaml entity editing (parity with the web settings panels
      // and the MCP workflow tools). Each family is its own top-level
      // command; all route through the per-entity core functions. See
      // commands/workflow-entities.ts.
      case "status":       await runCommand(() => workflowEntityCmd.status(args, root)); break;
      case "priority":     await runCommand(() => workflowEntityCmd.priority(args, root)); break;
      case "task-type":    await runCommand(() => workflowEntityCmd.taskType(args, root)); break;
      case "relationship": await runCommand(() => workflowEntityCmd.relationship(args, root)); break;
      case "custom-field": await runCommand(() => workflowEntityCmd.customField(args, root)); break;
      case "board-column": await runCommand(() => workflowEntityCmd.boardColumn(args, root)); break;
      case "estimation":   await runCommand(() => workflowEntityCmd.estimation(args, root)); break;
      case "timeline":     await runCommand(() => workflowEntityCmd.timeline(args, root)); break;

      case "git":     await runCommand(() => gitCmd.run(args, root));     break;
      case "config":  await runCommand(() => configCmd.run(args, root));  break;
      case "migrate": await migrateCmd.run(args, root); break;

      case "--help":
      case "-h":
      case "help":
        usage();
        break;

      default:
        if (command) {
          console.error(`Unknown command: ${command}`);
        }
        usage();
        process.exitCode = EXIT.USAGE;
        break;
    }
  } catch (err) {
    // A ZodError's `.message` is the serialized issue array, so printing
    // it raw gave the user braces, "code" and "path" instead of an
    // explanation — while MCP returned prose for the same input (P10).
    // formatZodIssues is the formatter every other layer already uses.
    //
    // EXIT.RUNTIME (1) is already the domain-error code the case wants;
    // only the message was wrong.
    const zodProse = formatIfZodError(err, "task");
    if (zodProse !== null) {
      console.error(`Error: ${zodProse}`);
      process.exitCode = EXIT.RUNTIME;
      return;
    }
    // Print just the message in normal mode; include the stack when
    // LOCTT_DEBUG=1 so triage isn't blind. Non-Error throws (rare)
    // get a defensive stringify.
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
      if (process.env["LOCTT_DEBUG"] === "1" && err.stack) {
        console.error(err.stack);
      }
    } else {
      console.error(`Error: ${String(err)}`);
    }
    process.exitCode = EXIT.RUNTIME;
  }
}

// Only auto-run when executed directly. Resolve both sides through
// realpath so the guard still fires when invoked via symlinks (npm link,
// global installs that symlink the bin, nvm shims, etc.).
import { realpathSync } from "node:fs";
const argv1 = process.argv[1];
const isDirectRun = argv1 !== undefined
  && realpathSync(argv1) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = EXIT.RUNTIME;
  });
}
