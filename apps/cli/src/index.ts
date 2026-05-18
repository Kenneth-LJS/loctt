import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  archiveLabel,
  archiveMilestone,
  archiveProject,
  archiveSprint,
  archiveUser,
  CONFIG_KEYS,
  createLabel,
  createMilestone,
  createProject,
  createSprint,
  createUser,
  deleteLabel,
  deleteMilestone,
  deleteProject,
  deleteSprint,
  deleteUser,
  disableGit,
  editLabel,
  editMilestone,
  editProject,
  editSprint,
  enableGit,
  getConfigValue,
  getCurrentUser,
  getGitStatus,
  loadAllUsers,
  loadCalendarConfig,
  loadLabelsConfig,
  loadMilestonesConfig,
  loadProjectsConfig,
  loadSprintsConfig,
  migrateToCurrent,
  planMigration,
  publish,
  readBurndownSeries,
  requireSupportedSchema,
  resolveLocttDir,
  resolveUserRef,
  setConfigValue,
  setDefaultProject,
  switchCurrentUser,
  sync,
  unarchiveLabel,
  unarchiveMilestone,
  unarchiveProject,
  unarchiveSprint,
  unarchiveUser,
  unsetConfigValue,
  updateUser,
  UserError,
} from "@loctt/core";

import * as doctorCmd from "./commands/doctor.js";
import * as infoCmd from "./commands/info.js";
import * as initCmd from "./commands/init.js";
import * as schemaCmd from "./commands/schema.js";
import * as taskArchiveCmd from "./commands/task-archive.js";
import * as taskCrudCmd from "./commands/task-crud.js";
import * as taskFilesCmd from "./commands/task-files.js";
import * as taskLinksCmd from "./commands/task-links.js";
import * as taskRankCmd from "./commands/task-rank.js";
import * as viewsCmd from "./commands/views.js";
import { formatNumber, pad } from "./format/value.js";
import { getArg, hasFlag, stripCwdArg } from "./runtime/args.js";
import { confirmHardDelete, confirmInteractive } from "./runtime/confirm.js";
import { EXIT, runCommand, UsageError } from "./runtime/errors.js";
import { dirExists, resolveClientDir, SCHEMA_GUARD_EXEMPT_COMMANDS } from "./runtime/schema-guard.js";
import { usage } from "./usage.js";

export async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Global `--cwd <dir>` lets callers operate on a tracker without
  // shelling out to a subdirectory. Default is process.cwd().
  // Strip `--cwd <dir>` (and `--cwd=<dir>`) from `args` so the
  // first positional becomes the subcommand, regardless of where
  // --cwd appeared on the command line.
  const cwdOverride = getArg(rawArgs, "--cwd");
  const root = cwdOverride !== undefined
    ? resolvePath(process.cwd(), cwdOverride)
    : process.cwd();
  const args = stripCwdArg(rawArgs);
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
      }
      // If the directory doesn't exist, the command will fail
      // naturally via its own existence check (e.g. resolveLocttDir
      // call sites that read state.yaml).
    }

    switch (command) {
      case "init":   await initCmd.run(args, root);   break;
      case "info":   await infoCmd.run(args, root);   break;
      case "doctor": await doctorCmd.run(args, root); break;
      case "views":  await viewsCmd.run(args, root);  break;
      case "schema": await schemaCmd.run(args, root); break;

      case "create":    await runCommand(() => taskCrudCmd.create(args, root));    break;
      case "list":      await runCommand(() => taskCrudCmd.list(args, root));      break;
      case "show":      await runCommand(() => taskCrudCmd.show(args, root));      break;
      case "set":       await runCommand(() => taskCrudCmd.set(args, root));       break;
      case "unset":     await runCommand(() => taskCrudCmd.unset(args, root));     break;
      case "body":      await runCommand(() => taskCrudCmd.body(args, root));      break;
      case "log":       await runCommand(() => taskCrudCmd.log(args, root));       break;
      case "delete":    await runCommand(() => taskCrudCmd.deleteCmd(args, root)); break;
      case "archive":   await runCommand(() => taskArchiveCmd.archive(args, root));   break;
      case "unarchive": await runCommand(() => taskArchiveCmd.unarchive(args, root)); break;
      case "attach":    await runCommand(() => taskFilesCmd.attach(args, root));   break;
      case "detach":    await runCommand(() => taskFilesCmd.detach(args, root));   break;
      case "link":      await runCommand(() => taskLinksCmd.link(args, root));     break;
      case "unlink":    await runCommand(() => taskLinksCmd.unlink(args, root));   break;

      case "mcp": {
        const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
        const { getTools, executeTool } = await import("@loctt/mcp");

        const server = new McpServer({ name: "loctt", version: "0.1.0" });
        for (const tool of getTools()) {
          server.registerTool(
            tool.name,
            {
              description: tool.description,
              inputSchema: tool.inputSchema,
            },
            async (params: unknown) => {
              const result = await executeTool(root, tool.name, (params ?? {}) as Record<string, unknown>);
              return { content: result.content.map(c => ({ ...c })), isError: result.isError };
            },
          );
        }
        const transport = new StdioServerTransport();
        await server.connect(transport);
        break;
      }

      case "ui": {
        const { createWebApp } = await import("@loctt/web");
        const port = Number(getArg(args, "--port")) || undefined;
        const noOpen = hasFlag(args, "--no-open");
        const clientDir = await resolveClientDir();
        const app = createWebApp({
          root,
          ...(port !== undefined ? { port } : {}),
          ...(clientDir !== undefined ? { clientDir } : {}),
        });
        await app.start();
        const url = `http://localhost:${app.port}`;
        console.log(`LocTT UI running at ${url}`);
        console.log(`Press Ctrl-C to stop.`);

        if (!noOpen) {
          const opener =
            process.platform === "darwin" ? "open" :
            process.platform === "win32" ? "start" :
            "xdg-open";
          const { spawn } = await import("node:child_process");
          try {
            spawn(opener, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
          } catch (err) {
            // The browser-open is a nice-to-have, not the operation;
            // the URL is already printed above. Silent failure is
            // intentional for end users — but surface the cause
            // under LOCTT_DEBUG so it's debuggable when needed.
            if (process.env["LOCTT_DEBUG"] === "1") {
              console.error(`[loctt ui] failed to auto-open browser:`, err);
            }
          }
        }

        await new Promise<void>((resolve) => {
          const shutdown = () => { resolve(); };
          process.once("SIGINT", shutdown);
          process.once("SIGTERM", shutdown);
        });
        await app.stop();
        break;
      }

      case "project": {
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
            // Confirmation has its own exit-code semantics (refused =
            // usage error, no = success), so it stays outside
            // runCommand which would conflate the two.
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
        break;
      }

      case "user": {
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
        break;
      }

      case "label": {
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
        break;
      }

      case "milestone": {
        const sub = args[1];
        const locttDir = resolveLocttDir(root);
        switch (sub) {
          case "list": {
            const includeArchived = hasFlag(args, "--all");
            const cfg = await loadMilestonesConfig(locttDir);
            for (const m of cfg.milestones) {
              if (!includeArchived && m.archived === true) continue;
              const arch = m.archived === true ? " (archived)" : "";
              const due = m.target_date ? `  due ${m.target_date}` : "";
              console.log(`${m.key}\t${m.label}${due}${arch}`);
            }
            break;
          }
          case "create": {
            await runCommand(async () => {
              const key = args[2];
              if (!key) {
                throw new UsageError(
                  "missing key",
                  "loctt milestone create <key> [--label <label>] [--target-date <YYYY-MM-DD>]",
                );
              }
              const label = getArg(args, "--label") ?? key;
              const targetDate = getArg(args, "--target-date");
              await createMilestone(locttDir, {
                key,
                label,
                ...(targetDate !== undefined ? { target_date: targetDate } : {}),
              });
              console.log(`Created milestone ${key}`);
            });
            break;
          }
          case "edit": {
            await runCommand(async () => {
              const key = args[2];
              if (!key) {
                throw new UsageError(
                  "missing key",
                  "loctt milestone edit <key> [--label <l>] [--target-date <YYYY-MM-DD|->] [--archived <true|false>]",
                );
              }
              const label = getArg(args, "--label");
              const td = getArg(args, "--target-date");
              const archivedArg = getArg(args, "--archived");
              if (archivedArg !== undefined && archivedArg !== "true" && archivedArg !== "false") {
                throw new UsageError(`--archived must be exactly "true" or "false", got: ${archivedArg}`);
              }
              await editMilestone(locttDir, key, {
                ...(label !== undefined ? { label } : {}),
                ...(td !== undefined ? { target_date: td === "-" ? null : td } : {}),
                ...(archivedArg !== undefined ? { archived: archivedArg === "true" } : {}),
              });
              console.log(`Updated milestone ${key}`);
            });
            break;
          }
          case "delete": {
            const key = args[2];
            if (!key) {
              console.error(`Error: missing key`);
              console.error(`Usage: loctt milestone delete <key> [--remap-to <other>] [--yes]`);
              process.exitCode = EXIT.USAGE;
              break;
            }
            const remapTo = getArg(args, "--remap-to");
            const outcome = await confirmHardDelete(
              args,
              `Permanently delete milestone ${key}? This will rewrite affected tasks. (use 'loctt milestone archive' for a reversible alternative)`,
            );
            if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
            await runCommand(async () => {
              const result = await deleteMilestone(locttDir, key, {
                hard: true,
                ...(remapTo !== undefined ? { remapTo } : {}),
              });
              if (result.affectedTaskCount > 0) {
                const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "cleared from";
                console.log(`${action} ${result.affectedTaskCount} task(s)`);
              }
              console.log(`Deleted milestone ${key}`);
            });
            break;
          }
          case "archive":
          case "unarchive": {
            await runCommand(async () => {
              const key = args[2];
              if (!key) {
                throw new UsageError("missing key", `loctt milestone ${sub} <key>`);
              }
              if (sub === "archive") await archiveMilestone(locttDir, key);
              else await unarchiveMilestone(locttDir, key);
              console.log(`${sub === "archive" ? "Archived" : "Unarchived"} milestone ${key}`);
            });
            break;
          }
          default:
            console.error(`Usage: loctt milestone <list|create|edit|archive|unarchive|delete> ...`);
            process.exitCode = EXIT.USAGE;
            break;
        }
        break;
      }

      case "sprint": {
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
        break;
      }

      case "calendar": {
        const sub = args[1];
        const locttDir = resolveLocttDir(root);
        if (sub === "show") {
          const cfg = await loadCalendarConfig(locttDir);
          console.log(`Timezone:          ${cfg.timezone}`);
          console.log(`First day of week: ${cfg.first_day_of_week} (0=Sun)`);
          console.log(`Working days:      ${cfg.working_days.join(", ")}`);
          if (cfg.holidays.length === 0) {
            console.log(`Holidays:          (none)`);
          } else {
            console.log(`Holidays:`);
            for (const h of cfg.holidays) {
              console.log(`  ${h.date}  ${h.label}`);
            }
          }
        } else {
          console.error(`Usage: loctt calendar show`);
          process.exitCode = EXIT.USAGE;
        }
        break;
      }

      case "rerank":       await runCommand(() => taskRankCmd.rerank(args, root));      break;
      case "board-rerank": await runCommand(() => taskRankCmd.boardRerank(args, root)); break;

      case "git": {
        const sub = args[1];
        const locttDir = resolveLocttDir(root);
        switch (sub) {
          case "enable": {
            await enableGit(locttDir, root);
            console.log("Git-backed mode enabled");
            break;
          }
          case "disable": {
            await disableGit(locttDir);
            console.log("Git-backed mode disabled");
            break;
          }
          case "status": {
            const status = await getGitStatus(locttDir, root);
            console.log(`Enabled: ${status.enabled}`);
            console.log(`Branch: ${status.branch}`);
            console.log(`Remote: ${status.remote}`);
            console.log(`Auto-push: ${status.autoPush}`);
            console.log(`Auto-fetch: ${status.autoFetch}`);
            console.log(`Inside git repo: ${status.isGitRepo}`);
            if (status.lastSyncedCommit) {
              console.log(`Last synced commit: ${status.lastSyncedCommit}`);
            }
            break;
          }
          case "publish": {
            const result = await publish(locttDir, root);
            if (result.committed) {
              console.log("Published local state to loctt branch");
            } else {
              console.log("No changes to publish");
            }
            if (result.pushed === true) {
              console.log("Pushed to remote");
            }
            break;
          }
          case "sync": {
            const result = await sync(locttDir, root);
            if (result.fetched === true) {
              console.log("Fetched from remote");
            }
            if (result.updated) {
              console.log("Synced loctt branch into local workspace");
            } else {
              console.log("Already up to date");
            }
            break;
          }
          default:
            console.error("Usage: loctt git <enable|disable|status|publish|sync>");
            process.exitCode = EXIT.USAGE;
            break;
        }
        break;
      }

      case "config": {
        const sub = args[1];
        const locttDir = resolveLocttDir(root);
        switch (sub) {
          case "get": {
            const key = args[2];
            if (!key) {
              console.error("Usage: loctt config get <key>");
              process.exitCode = EXIT.USAGE;
              break;
            }
            const value = await getConfigValue(locttDir, key);
            if (value === undefined) {
              // print empty line for missing
              console.log("");
            } else {
              console.log(String(value));
            }
            break;
          }
          case "set": {
            const key = args[2];
            const value = args[3];
            if (!key || value === undefined) {
              console.error("Usage: loctt config set <key> <value>");
              process.exitCode = EXIT.USAGE;
              break;
            }
            await setConfigValue({ locttDir, root }, key, value);
            console.log(`Set ${key} = ${value}`);
            break;
          }
          case "unset": {
            const key = args[2];
            if (!key) {
              console.error("Usage: loctt config unset <key>");
              process.exitCode = EXIT.USAGE;
              break;
            }
            await unsetConfigValue({ locttDir, root }, key);
            console.log(`Unset ${key}`);
            break;
          }
          case "list": {
            for (const def of CONFIG_KEYS) {
              const value = await getConfigValue(locttDir, def.key).catch(() => undefined);
              const display = value === undefined ? "" : String(value);
              console.log(`${def.key} = ${display}`);
            }
            break;
          }
          default:
            console.error("Usage: loctt config <get|set|unset|list> [key] [value]");
            process.exitCode = EXIT.USAGE;
            break;
        }
        break;
      }

      case "migrate": {
        const locttDir = resolveLocttDir(root);
        const dryRun = hasFlag(args, "--dry-run");
        const skipPrompt = hasFlag(args, "--yes");

        const plan = await planMigration(locttDir);
        if (plan.steps.length === 0) {
          console.log(`Schema is already at v${plan.to}. Nothing to do.`);
          break;
        }

        console.log(`LocTT schema migration`);
        console.log(``);
        console.log(`  Current version: ${plan.from}`);
        console.log(`  Target version:  ${plan.to}`);
        console.log(``);
        console.log(`Migrations to run:`);
        for (const step of plan.steps) {
          const tags: string[] = [];
          if (step.deprecated) tags.push("deprecated");
          if (step.risky) tags.push("risky");
          const tagStr = tags.length > 0 ? `  [${tags.join(", ")}]` : "";
          console.log(`  v${step.from} → v${step.to}  ${step.description}${tagStr}`);
        }
        console.log(``);

        if (dryRun) {
          console.log(`Dry run only — no changes made.`);
          break;
        }

        if (!skipPrompt) {
          const ok = await confirmInteractive(
            `This will back up .loctt/ and apply the migrations above. Proceed?`,
          );
          if (!ok) {
            console.log(`Aborted.`);
            // User declined, not an error: exit 0 so scripts don't
            // false-alarm on a clean refusal.
            process.exitCode = EXIT.SUCCESS;
            break;
          }
        }

        const result = await migrateToCurrent(locttDir);
        if (result.backupPath) {
          console.log(`Backup written to ${result.backupPath}`);
        }
        console.log(``);
        let i = 1;
        for (const step of result.steps) {
          console.log(`[${i}/${result.steps.length}] v${step.from} → v${step.to}  ${step.description}`);
          i += 1;
        }
        console.log(``);
        console.log(`Migration complete. Schema is now v${result.to}.`);
        if (result.backupPath) {
          console.log(`You can delete ${result.backupPath} once you've verified everything works.`);
        }
        break;
      }

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
