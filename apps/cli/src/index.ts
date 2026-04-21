import type { HistoryEntry } from "@loctt/contracts";
import {
  archiveTask,
  buildListContext,
  buildShowModel,
  createTask,
  deleteTask,
  getTrackerInfo,
  initLoctt,
  linkTask,
  listTasks,
  loadAllTasks,
  loadOptionalConfigs,
  loadState,
  lookupTask,
  readHistory,
  readTaskBody,
  resolveLocttDir,
  runDoctor,
  saveState,
  setField,
  unarchiveTask,
  unlinkTask,
  unsetField,
  writeTaskBody,
} from "@loctt/core";

function usage(): void {
  console.log(`Usage: loctt <command> [options]

Commands:
  init [--prefix <prefix>] [--no-docs] [--yes]
  info
  doctor
  create <title> [--status <s>] [--priority <p>] [--type <t>]
  list [--query <q>] [--view <v>] [--limit <n>]
  show <task>
  set <task> <field> <value>
  unset <task> <field>
  link <task> <relationship> <target>
  unlink <task> <relationship> <target>
  archive <task>
  unarchive <task>
  delete <task> --force
  body <task> [--set <text>]
  log <task> [--limit <n>]
  mcp                              Start the MCP server (stdio)
  web [--port <n>]                 Start the web UI
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

function formatHistoryEntry(entry: HistoryEntry): string {
  const ts = entry.timestamp;
  switch (entry.kind) {
    case "created":
      return `${ts}  created`;
    case "field_change":
      return `${ts}  ${entry.field}: ${String(entry.before ?? "(none)")} → ${String(entry.after ?? "(none)")}`;
    case "custom_field_change":
      return `${ts}  ${entry.field}: ${String(entry.before ?? "(none)")} → ${String(entry.after ?? "(none)")}`;
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
        if (fm.relationships && fm.relationships.length > 0) {
          console.log(`Relationships:`);
          for (const r of fm.relationships) {
            console.log(`  ${r.type} → ${r.target}`);
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
        const task = await lookupTask(locttDir, ref);
        const targetTask = await lookupTask(locttDir, target);
        await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: relType, target: targetTask.frontmatter.id });
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
          console.error("Usage: loctt body <task> [--set <text>]");
          process.exitCode = 1;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        const newBody = getArg(args, "--set");
        if (newBody !== undefined) {
          await writeTaskBody(locttDir, task.frontmatter.id, newBody + "\n");
          console.log(`Updated body for ${task.frontmatter.key}`);
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

      case "mcp": {
        const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
        const { getTools, executeTool } = await import("@loctt/mcp");

        const server = new McpServer({ name: "loctt", version: "0.1.0" });
        for (const tool of getTools()) {
          server.tool(tool.name, tool.description, tool.inputSchema as Record<string, unknown>, async (params: Record<string, unknown>) => {
            const result = await executeTool(root, tool.name, params);
            return { content: result.content.map(c => ({ ...c })), isError: result.isError };
          });
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
