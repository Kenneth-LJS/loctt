import { isAbsolute, resolve as resolvePath } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import {
  appendTaskBody,
  archiveTask,
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  buildListContext,
  buildShowModel,
  CONFIG_KEYS,
  createTask,
  deleteTask,
  detachFile,
  disableGit,
  enableGit,
  getConfigValue,
  getGitStatus,
  getTrackerInfo,
  initLoctt,
  linkTask,
  listTasks,
  loadAllTasks,
  loadOptionalConfigs,
  loadState,
  lookupTask,
  publish,
  readHistory,
  readTaskBody,
  resolveLocttDir,
  runDoctor,
  saveState,
  setConfigValue,
  setField,
  sync,
  unarchiveTask,
  unlinkTask,
  unsetConfigValue,
  unsetField,
  writeTaskBody,
} from "@loctt/core";

function usage(): void {
  console.log(`Usage: loctt <command> [options]

Commands:
  init [--prefix <prefix>] [--no-docs] [--yes]
  info
  doctor
  views                            List saved views from queries.yaml
  schema                           Show the workflow config (statuses, priorities, etc.)
  create <title> [--status <s>] [--priority <p>] [--type <t>]
  list [--query <q>] [--view <v>] [--limit <n>] [--archived]
                                   --archived: include archived tasks
                                   (hidden by default; saved views are respected as authored)
  show <task>
  set <task> <field> <value>
  unset <task> <field>
  link <task> <relationship> <target>
  unlink <task> <relationship> <target>
  archive <task>
  unarchive <task>
  delete <task> --force
  body <task> [--set <text>] [--append <text>]
  log <task> [--limit <n>]
  attach <task> <file-path> [--force]
  detach <task> <name>
  mcp                              Start the MCP server (stdio)
  web [--port <n>]                 Start the web UI
  git <enable|disable|status|publish|sync>
  config <get|set|unset|list> [key] [value]
`);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}

function formatHistoryEntry(entry: HistoryEntry): string {
  const ts = entry.timestamp;
  switch (entry.kind) {
    case "created":
      return `${ts}  created`;
    case "field_change":
      return `${ts}  ${entry.field}: ${formatValue(entry.before)} → ${formatValue(entry.after)}`;
    case "custom_field_change":
      return `${ts}  ${entry.field}: ${formatValue(entry.before)} → ${formatValue(entry.after)}`;
    case "label_added":
      return `${ts}  label added: ${String(entry.after)}`;
    case "label_removed":
      return `${ts}  label removed: ${String(entry.before)}`;
    case "archived":
      return `${ts}  archived`;
    case "unarchived":
      return `${ts}  unarchived`;
    case "link_added": {
      const meta = entry.meta as { type: string; target: string };
      return `${ts}  link added: ${meta.type} → ${meta.target}`;
    }
    case "link_removed": {
      const meta = entry.meta as { type: string; target: string };
      return `${ts}  link removed: ${meta.type} → ${meta.target}`;
    }
    case "body_edited":
      return `${ts}  body edited`;
    default:
      return `${ts}  ${entry.kind}`;
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const root = process.cwd();

  try {
    switch (command) {
      case "init": {
        const prefix = getArg(args, "--prefix") ?? "T-";
        const docs = !hasFlag(args, "--no-docs");
        const result = await initLoctt(root, { prefix, docs });
        console.log(`Initialized .loctt at ${result.locttDir}`);
        console.log(`Created ${result.created.length} files`);
        break;
      }

      case "info": {
        const info = await getTrackerInfo(root);
        if (!info.exists) {
          console.log("No .loctt directory found. Run 'loctt init' to get started.");
          break;
        }
        console.log(`LocTT directory: ${info.locttDir}`);
        console.log(`Tasks: ${info.taskCount}`);
        if (info.workflowConfig) {
          console.log(`Key prefix: ${info.workflowConfig.key.prefix}`);
          console.log(`Statuses: ${info.workflowConfig.statuses.map(s => s.key).join(", ")}`);
        }
        if (info.state) {
          const taskState = info.state.keys["task"];
          if (taskState) {
            console.log(`Next key: ${taskState.prefix}${taskState.next_number}`);
          }
        }
        break;
      }

      case "doctor": {
        const checks = await runDoctor(root);
        for (const check of checks) {
          const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗";
          console.log(`  ${icon} ${check.name}: ${check.message}`);
        }
        const hasError = checks.some(c => c.status === "error");
        if (hasError) process.exitCode = 1;
        break;
      }

      case "views": {
        const locttDir = resolveLocttDir(root);
        const { queriesConfig } = await loadOptionalConfigs(locttDir);
        if (!queriesConfig || queriesConfig.queries.length === 0) {
          console.log("No saved views.");
          break;
        }
        for (const v of queriesConfig.queries) {
          const sortPart = v.sort && v.sort.length > 0
            ? `  [sort: ${v.sort.map(s => `${s.field} ${s.direction}`).join(", ")}]`
            : "";
          console.log(`${v.name}  ${v.query}${sortPart}`);
        }
        break;
      }

      case "schema": {
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        if (!workflowConfig) {
          console.log("No workflow config found.");
          break;
        }
        console.log(`Key prefix: ${workflowConfig.key.prefix}`);
        console.log("");
        console.log("Statuses:");
        for (const s of workflowConfig.statuses) {
          console.log(`  ${s.key} (${s.category}): ${s.label}`);
        }
        if (workflowConfig.priorities.length > 0) {
          console.log("");
          console.log("Priorities:");
          for (const p of workflowConfig.priorities) {
            const valuePart = p.value !== undefined ? ` [${p.value}]` : "";
            console.log(`  ${p.key}: ${p.label}${valuePart}`);
          }
        }
        if (workflowConfig.task_types.length > 0) {
          console.log("");
          console.log("Task types:");
          for (const t of workflowConfig.task_types) {
            console.log(`  ${t.key}: ${t.label}`);
          }
        }
        if (workflowConfig.relationships.length > 0) {
          console.log("");
          console.log("Relationships:");
          for (const r of workflowConfig.relationships) {
            const structural = r.structural ? " [structural]" : "";
            console.log(`  ${r.key} (${r.label}) ↔ ${r.inverse} (${r.inverse_label})${structural}`);
          }
        }
        if (workflowConfig.custom_fields.length > 0) {
          console.log("");
          console.log("Custom fields:");
          for (const f of workflowConfig.custom_fields) {
            const multi = f.multi ? " multi" : "";
            const searchable = f.searchable ? " searchable" : "";
            console.log(`  ${f.key} (${f.type}${multi}${searchable}): ${f.label}`);
            if (f.values && f.values.length > 0) {
              for (const v of f.values) {
                console.log(`    - ${v.key}: ${v.label}`);
              }
            }
          }
        }
        break;
      }

      case "create": {
        const title = args[1];
        if (!title) {
          console.error("Usage: loctt create <title>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const state = await loadState(locttDir);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await createTask({
          locttDir, state, workflowConfig,
          options: {
            title,
            status: getArg(args, "--status"),
            priority: getArg(args, "--priority"),
            task_type: getArg(args, "--type"),
          },
        });
        await saveState(locttDir, state);
        console.log(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
        break;
      }

      case "list": {
        const locttDir = resolveLocttDir(root);
        const tasks = await loadAllTasks(locttDir);
        const { workflowConfig, queriesConfig } = await loadOptionalConfigs(locttDir);

        let limit: number | undefined;
        const limitArg = getArg(args, "--limit");
        if (limitArg !== undefined) {
          limit = Number(limitArg);
          if (Number.isNaN(limit) || limit < 0 || !Number.isInteger(limit)) {
            console.error("Error: --limit must be a non-negative integer");
            process.exitCode = 1;
            break;
          }
        }

        const result = listTasks({
          tasks,
          options: {
            query: getArg(args, "--query"),
            view: getArg(args, "--view"),
            limit,
            includeArchived: hasFlag(args, "--archived"),
          },
          queriesConfig,
          workflowConfig,
          ctx: buildListContext(tasks),
        });

        if (result.length === 0) {
          console.log("No tasks found.");
        } else {
          for (const task of result) {
            const status = task.frontmatter.status ? ` [${task.frontmatter.status}]` : "";
            console.log(`${task.frontmatter.key}  ${task.frontmatter.title}${status}`);
          }
        }
        break;
      }

      case "show": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt show <task>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        const model = await buildShowModel(locttDir, task);

        console.log(`${model.task.frontmatter.key}: ${model.task.frontmatter.title}`);
        const fm = model.task.frontmatter;
        if (fm.status) console.log(`Status: ${fm.status}`);
        if (fm.priority) console.log(`Priority: ${fm.priority}`);
        if (fm.task_type) console.log(`Type: ${fm.task_type}`);
        if (fm.assignee) console.log(`Assignee: ${fm.assignee}`);
        if (fm.due_date) console.log(`Due: ${fm.due_date}`);
        if (fm.archived) console.log(`Archived: ${fm.archived_at}`);
        if (model.relationships.length > 0) {
          console.log(`Relationships:`);
          for (const r of model.relationships) {
            const display = r.missing
              ? `${r.target.slice(0, 8)}… (deleted)`
              : r.resolvedKey ?? r.target;
            console.log(`  ${r.type} → ${display}`);
          }
        }
        if (model.attachments.length > 0) {
          console.log(`Attachments:`);
          for (const a of model.attachments) {
            console.log(`  ${a.name} (${a.size} bytes)`);
          }
        }
        if (model.task.body.trim()) {
          console.log(`\n${model.task.body}`);
        }
        break;
      }

      case "set": {
        const ref = args[1];
        const field = args[2];
        const value = args[3];
        if (!ref || !field || value === undefined) {
          console.error("Usage: loctt set <task> <field> <value>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await lookupTask(locttDir, ref);
        await setField({ locttDir, taskId: task.frontmatter.id, field, value, workflowConfig });
        console.log(`Set ${field} = ${value} on ${task.frontmatter.key}`);
        break;
      }

      case "unset": {
        const ref = args[1];
        const field = args[2];
        if (!ref || !field) {
          console.error("Usage: loctt unset <task> <field>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        await unsetField(locttDir, task.frontmatter.id, field);
        console.log(`Unset ${field} on ${task.frontmatter.key}`);
        break;
      }

      case "link": {
        const ref = args[1];
        const relType = args[2];
        const target = args[3];
        if (!ref || !relType || !target) {
          console.error("Usage: loctt link <task> <relationship> <target>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await lookupTask(locttDir, ref);
        const targetTask = await lookupTask(locttDir, target);
        await linkTask({ locttDir, taskId: task.frontmatter.id, type: relType, target: targetTask.frontmatter.id, workflowConfig });
        console.log(`Linked ${task.frontmatter.key} --${relType}--> ${targetTask.frontmatter.key}`);
        break;
      }

      case "unlink": {
        const ref = args[1];
        const relType = args[2];
        const target = args[3];
        if (!ref || !relType || !target) {
          console.error("Usage: loctt unlink <task> <relationship> <target>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await lookupTask(locttDir, ref);
        const targetTask = await lookupTask(locttDir, target);
        await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: relType, target: targetTask.frontmatter.id, workflowConfig });
        console.log(`Unlinked ${task.frontmatter.key} --${relType}--> ${targetTask.frontmatter.key}`);
        break;
      }

      case "archive": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt archive <task>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        await archiveTask(locttDir, task.frontmatter.id);
        console.log(`Archived ${task.frontmatter.key}`);
        break;
      }

      case "unarchive": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt unarchive <task>");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        await unarchiveTask(locttDir, task.frontmatter.id);
        console.log(`Unarchived ${task.frontmatter.key}`);
        break;
      }

      case "delete": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt delete <task> --force");
          process.exitCode = 1;
          break;
        }
        const force = hasFlag(args, "--force");
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        await deleteTask(locttDir, task.frontmatter.id, { force });
        console.log(`Deleted ${task.frontmatter.key}`);
        break;
      }

      case "body": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt body <task> [--set <text>] [--append <text>]");
          process.exitCode = 1;
          break;
        }
        const newBody = getArg(args, "--set");
        const appendText = getArg(args, "--append");
        if (newBody !== undefined && appendText !== undefined) {
          console.error("Error: --set and --append are mutually exclusive");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        if (newBody !== undefined) {
          await writeTaskBody(locttDir, task.frontmatter.id, newBody + "\n");
          console.log(`Updated body for ${task.frontmatter.key}`);
        } else if (appendText !== undefined) {
          await appendTaskBody(locttDir, task.frontmatter.id, appendText);
          console.log(`Appended to body for ${task.frontmatter.key}`);
        } else {
          const body = await readTaskBody(locttDir, task.frontmatter.id);
          if (body.trim()) {
            console.log(body);
          } else {
            console.log("(empty body)");
          }
        }
        break;
      }

      case "log": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt log <task> [--limit <n>]");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);

        let limit: number | undefined;
        const limitArg = getArg(args, "--limit");
        if (limitArg !== undefined) {
          limit = Number(limitArg);
          if (Number.isNaN(limit) || limit < 0 || !Number.isInteger(limit)) {
            console.error("Error: --limit must be a non-negative integer");
            process.exitCode = 1;
            break;
          }
        }

        const entries = await readHistory(locttDir, task.frontmatter.id);
        entries.reverse();
        const display = limit !== undefined ? entries.slice(0, limit) : entries;

        if (display.length === 0) {
          console.log("No history entries.");
        } else {
          for (const entry of display) {
            console.log(formatHistoryEntry(entry));
          }
        }
        break;
      }

      case "attach": {
        const ref = args[1];
        const filePath = args[2];
        if (!ref || !filePath) {
          console.error("Usage: loctt attach <task> <file-path> [--force]");
          process.exitCode = 1;
          break;
        }
        const force = hasFlag(args, "--force");
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        const sourcePath = isAbsolute(filePath)
          ? filePath
          : resolvePath(process.cwd(), filePath);
        try {
          const result = await attachFile({
            locttDir,
            taskId: task.frontmatter.id,
            sourcePath,
            force,
          });
          const prefix = result.overwritten ? "(overwrote existing) " : "";
          console.log(
            `${prefix}Attached ${result.name} (${result.size} bytes) to ${task.frontmatter.key}`,
          );
        } catch (err) {
          if (err instanceof AttachmentExistsError) {
            console.error(
              `Error: ${err.message}. Use --force to overwrite.`,
            );
            process.exitCode = 1;
            break;
          }
          if (err instanceof AttachmentSourceError) {
            console.error(`Error: ${err.message}`);
            process.exitCode = 1;
            break;
          }
          throw err;
        }
        break;
      }

      case "detach": {
        const ref = args[1];
        const name = args[2];
        if (!ref || !name) {
          console.error("Usage: loctt detach <task> <name>");
          process.exitCode = 1;
          break;
        }
        if (name.includes("/") || name.includes("\\") || name.includes("..")) {
          console.error(
            `Error: <name> must be a plain basename (no path separators or '..')`,
          );
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        try {
          await detachFile({
            locttDir,
            taskId: task.frontmatter.id,
            name,
          });
          console.log(`Detached ${name} from ${task.frontmatter.key}`);
        } catch (err) {
          if (err instanceof AttachmentNotFoundError) {
            console.error(`Error: ${err.message}`);
            process.exitCode = 1;
            break;
          }
          throw err;
        }
        break;
      }

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

      case "web": {
        const { createWebApp } = await import("@loctt/web");
        const port = Number(getArg(args, "--port")) || undefined;
        const app = createWebApp({ root, port });
        await app.start();
        console.log(`LocTT web UI running at http://localhost:${app.port}`);
        break;
      }

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
            process.exitCode = 1;
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
              process.exitCode = 1;
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
              process.exitCode = 1;
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
              process.exitCode = 1;
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
            process.exitCode = 1;
            break;
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
        process.exitCode = 1;
        break;
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly
import { fileURLToPath } from "node:url";
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
