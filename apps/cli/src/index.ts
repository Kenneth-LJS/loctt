#!/usr/bin/env node

import {
  initLoctt,
  getTrackerInfo,
  runDoctor,
  resolveLocttDir,
  loadWorkflowConfig,
  loadQueriesConfig,
  loadState,
  saveState,
  createTask,
  lookupTask,
  buildShowModel,
  setField,
  unsetField,
  archiveTask,
  unarchiveTask,
  deleteTask,
  linkTask,
  unlinkTask,
  listTasks,
  loadAllTasks,
  readTaskBody,
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
        const task = await createTask(locttDir, state, {
          title,
          status: getArg(args, "--status"),
          priority: getArg(args, "--priority"),
          task_type: getArg(args, "--type"),
        });
        await saveState(locttDir, state);
        console.log(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
        break;
      }

      case "list": {
        const locttDir = resolveLocttDir(root);
        const tasks = await loadAllTasks(locttDir);
        let workflowConfig = undefined;
        let queriesConfig = undefined;
        try { workflowConfig = await loadWorkflowConfig(locttDir); } catch { /* ok */ }
        try { queriesConfig = await loadQueriesConfig(locttDir); } catch { /* ok */ }

        const result = listTasks(
          tasks,
          {
            query: getArg(args, "--query"),
            view: getArg(args, "--view"),
            limit: getArg(args, "--limit") ? Number(getArg(args, "--limit")) : undefined,
          },
          queriesConfig,
          workflowConfig,
        );

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
        const task = await lookupTask(locttDir, ref);
        await setField(locttDir, task.frontmatter.id, field, value);
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
        const task = await lookupTask(locttDir, ref);
        const targetTask = await lookupTask(locttDir, target);
        await linkTask(locttDir, task.frontmatter.id, relType, targetTask.frontmatter.id);
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
        await unlinkTask(locttDir, task.frontmatter.id, relType, targetTask.frontmatter.id);
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
const isDirectRun = process.argv[1]?.endsWith("cli/dist/index.js") ?? false;
if (isDirectRun) {
  main();
}
