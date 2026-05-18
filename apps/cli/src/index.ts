import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONFIG_KEYS,
  disableGit,
  enableGit,
  getConfigValue,
  getGitStatus,
  migrateToCurrent,
  planMigration,
  publish,
  requireSupportedSchema,
  resolveLocttDir,
  setConfigValue,
  sync,
  unsetConfigValue,
} from "@loctt/core";

import * as calendarCmd from "./commands/calendar.js";
import * as doctorCmd from "./commands/doctor.js";
import * as infoCmd from "./commands/info.js";
import * as initCmd from "./commands/init.js";
import * as labelCmd from "./commands/label.js";
import * as milestoneCmd from "./commands/milestone.js";
import * as projectCmd from "./commands/project.js";
import * as schemaCmd from "./commands/schema.js";
import * as sprintCmd from "./commands/sprint.js";
import * as taskArchiveCmd from "./commands/task-archive.js";
import * as taskCrudCmd from "./commands/task-crud.js";
import * as taskFilesCmd from "./commands/task-files.js";
import * as taskLinksCmd from "./commands/task-links.js";
import * as taskRankCmd from "./commands/task-rank.js";
import * as userCmd from "./commands/user.js";
import * as viewsCmd from "./commands/views.js";
import { getArg, hasFlag, stripCwdArg } from "./runtime/args.js";
import { confirmInteractive } from "./runtime/confirm.js";
import { EXIT, runCommand } from "./runtime/errors.js";
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

      case "project": await projectCmd.run(args, root); break;

      case "user": await userCmd.run(args, root); break;

      case "label": await labelCmd.run(args, root); break;

      case "milestone": await milestoneCmd.run(args, root); break;
      case "sprint":    await sprintCmd.run(args, root);    break;
      case "calendar":  await calendarCmd.run(args, root);  break;

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
