import { stat as fsStat } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import type { HistoryEntry } from "@loctt/contracts";
import {
  appendTaskBody,
  archiveLabel,
  archiveMilestone,
  archiveProject,
  archiveSprint,
  archiveTask,
  archiveUser,
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  buildListContext,
  buildShowModel,
  BurndownError,
  CONFIG_KEYS,
  createLabel,
  createMilestone,
  createProject,
  createSprint,
  createTask,
  createUser,
  deleteLabel,
  deleteMilestone,
  deleteProject,
  deleteSprint,
  deleteTask,
  deleteUser,
  detachFile,
  disableGit,
  editLabel,
  editMilestone,
  editProject,
  editSprint,
  enableGit,
  getConfigValue,
  getCurrentUser,
  getGitStatus,
  getTrackerInfo,
  initLoctt,
  LabelError,
  linkTask,
  listTasks,
  loadAllTasks,
  loadAllUsers,
  loadCalendarConfig,
  loadLabelsConfig,
  loadMilestonesConfig,
  loadOptionalConfigs,
  loadProjectsConfig,
  loadSprintsConfig,
  loadState,
  lookupTask,
  migrateToCurrent,
  MilestoneError,
  planMigration,
  ProjectError,
  publish,
  readBurndownSeries,
  readHistory,
  readTaskBody,
  reorderBoardRank,
  ReorderError,
  reorderRelationship,
  requireSupportedSchema,
  resolveLocttDir,
  resolveProjectKey,
  resolveUserRef,
  runDoctor,
  saveState,
  setConfigValue,
  setDefaultProject,
  setField,
  SprintError,
  switchCurrentUser,
  sync,
  TaskNotFoundError,
  unarchiveLabel,
  unarchiveMilestone,
  unarchiveProject,
  unarchiveSprint,
  unarchiveTask,
  unarchiveUser,
  unlinkTask,
  unsetConfigValue,
  unsetField,
  updateUser,
  UserError,
  withStateLock,
  writeTaskBody,
} from "@loctt/core";

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fsStat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Locate the built client SPA directory. Tries (in order):
 *   1. LOCTT_CLIENT_DIR env override
 *   2. <cli-bundle>/client            (production: shipped alongside CLI bundle)
 *   3. <cli-bundle>/../../web/dist/client  (workspace dev: apps/web/dist/client)
 * Returns undefined if no client build is available — server still works as API-only.
 */
async function resolveClientDir(): Promise<string | undefined> {
  const envDir = process.env.LOCTT_CLIENT_DIR;
  if (envDir && (await dirExists(envDir))) return envDir;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolvePath(here, "client"),
    resolvePath(here, "../../web/dist/client"),
  ];
  for (const c of candidates) {
    if (await dirExists(c)) return c;
  }
  return undefined;
}

function usage(): void {
  console.log(`Usage: loctt [--cwd <dir>] <command> [options]

Global options:
  --cwd <dir>                      Operate against the tracker rooted
                                   at <dir> instead of the current
                                   working directory.

Commands:
  init [--prefix <prefix>] [--project-key <key>] [--project-label <label>] [--no-docs]
  info
  doctor
  views                            List saved views from queries.yaml
  schema                           Show the workflow config (statuses, priorities, etc.)
  project <list|create|edit|archive|unarchive|delete|set-default> ...
                                   list --all: include archived projects
                                   delete --hard: permanent (remap_to required if tasks exist)
  user <list|current|switch|create|edit|archive|unarchive|delete> ...
  label <list|create|edit|archive|unarchive|delete> ...
                                   list --all: include archived labels
                                   delete --hard: permanent (drops key from every task)
  milestone <list|create|edit|archive|unarchive|delete> ...
                                   list --all: include archived milestones
                                   delete --hard: permanent (clears milestone field on tasks)
  sprint <list|create|edit|archive|unarchive|delete|burndown> ...
                                   list --all: include archived sprints
                                   delete --hard: permanent (clears sprint field on tasks)
                                   burndown <key> [--format <table|json>]
  calendar show                   Print the calendar config (timezone, working days, holidays)
  rerank <source> <relationship> <target> [--before <task>] [--after <task>]
  board-rerank <task> [--before <task>] [--after <task>]
  create <title> [--project <key>] [--status <s>] [--priority <p>] [--type <t>]
  list [--query <q>] [--view <v>] [--limit <n>] [--archived] [--project <key>]
                                   --archived: include archived tasks
                                   (hidden by default; saved views are respected as authored)
  show <task>
  set <task> <field> <value>
  unset <task> <field>
  link <task> <relationship> <target>
  unlink <task> <relationship> <target>
  archive <task>
  unarchive <task>
  delete <task> [--hard]            Soft-delete (archive) by default; --hard removes the task directory
  body <task> [--set <text>] [--append <text>]
  log <task> [--limit <n>]
  attach <task> <file-path> [--force]
  detach <task> <name>
  mcp                              Start the MCP server (stdio)
  ui [--port <n>] [--no-open]      Start the web UI (foreground)
  git <enable|disable|status|publish|sync>
  config <get|set|unset|list> [key] [value]
  migrate [--yes] [--dry-run]      Upgrade the tracker schema to the current version
`);
}

/**
 * Process exit codes used across all `loctt` subcommands. Scripts and
 * tests can switch on these to distinguish "user said no" from "the
 * tracker is on a newer schema" from "you typed the command wrong."
 */
export const EXIT = {
  /** Command succeeded, or user declined a confirm prompt. */
  SUCCESS: 0,
  /** Domain/runtime error (validation, IO, schema mismatch, …). */
  RUNTIME: 1,
  /** Usage error: missing args, bad flag, mutually-exclusive flags. */
  USAGE: 2,
} as const;

/**
 * Returns the string value for `--flag <value>` or `--flag=value`.
 * Returns undefined if the flag is absent or used in boolean form
 * (`--flag` followed by another flag), so callers can distinguish
 * "not set" from "set to empty string".
 *
 * Anything after `--` is treated as positional and ignored.
 *
 * Notes:
 * - Empty-string values (`--set ""`) are returned as `""` rather than
 *   coerced to a number or treated as missing. We rolled our own
 *   parser because off-the-shelf mri auto-coerces `""` to `0`.
 * - Repeated flags: the last occurrence wins, matching the most
 *   intuitive shell behavior (`--limit 1 --limit 2` → `2`).
 * - Long-flag form `-flag` (single dash) is implicitly accepted so
 *   `--flag` and `-flag` collide. The CLI defines no short flags so
 *   this is harmless today; revisit if any are added.
 */
function getArg(args: string[], flag: string): string | undefined {
  const name = flag.replace(/^--?/, "");
  let result: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    if (a === undefined) continue;
    // `--flag=value` form
    if (a === `--${name}=` || a.startsWith(`--${name}=`)) {
      result = a.slice(`--${name}=`.length);
      continue;
    }
    if (a === `-${name}=` || a.startsWith(`-${name}=`)) {
      result = a.slice(`-${name}=`.length);
      continue;
    }
    // `--flag value` form. Treat the next arg as a value unless it
    // looks like another flag — in which case --flag was bare/boolean.
    if (a === `--${name}` || a === `-${name}`) {
      const next = args[i + 1];
      if (next === undefined) continue;
      if (next.startsWith("-") && next !== "-") continue;
      result = next;
      i += 1;
    }
  }
  return result;
}

/**
 * Removes `--cwd <value>` and `--cwd=<value>` occurrences from an
 * argv slice. Used by `main()` after extracting the cwd value so
 * handlers never see the global flag and so the first positional
 * after `loctt` is always the subcommand. Repeated occurrences are
 * all stripped (last one wins for the value, consistent with
 * `getArg`).
 *
 * Mirrors `getArg`'s rules so the two helpers can't disagree about
 * what counts as the value of `--cwd`:
 * - The value is consumed only when the next token is a positional
 *   (does not start with `-`). Bare `--cwd --help` therefore leaves
 *   `--help` in the output instead of swallowing it.
 * - Anything after `--` is positional and never touched.
 */
function stripCwdArg(args: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === undefined) { i += 1; continue; }
    if (a === "--") {
      out.push(...args.slice(i));
      return out;
    }
    if (a === "--cwd" || a === "-cwd") {
      const next = args[i + 1];
      // Same rule as getArg: only treat the next token as the value
      // if it doesn't itself look like a flag (so `--cwd --help`
      // leaves `--help` intact).
      if (next !== undefined && !next.startsWith("-")) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (a.startsWith("--cwd=") || a.startsWith("-cwd=")) {
      i += 1;
      continue;
    }
    out.push(a);
    i += 1;
  }
  return out;
}

/**
 * Returns true when a boolean flag is present (`--archived`,
 * `--archived=true`). `--archived=false` is treated as absent so a
 * caller can override a default-true behaviour. Any other value
 * after `=` (`--archived=anything`, `--archived=`) is treated as
 * truthy, matching common shell-flag intuition. Anything after `--`
 * is positional and ignored.
 */
function hasFlag(args: string[], flag: string): boolean {
  const name = flag.replace(/^--?/, "");
  let present = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") break;
    if (a === undefined) continue;
    if (a === `--${name}` || a === `-${name}`) { present = true; continue; }
    if (a === `--${name}=true` || a === `-${name}=true`) { present = true; continue; }
    if (a === `--${name}=false` || a === `-${name}=false`) { present = false; continue; }
    if (a.startsWith(`--${name}=`) || a.startsWith(`-${name}=`)) { present = true; continue; }
  }
  return present;
}

/**
 * Reads a single line from stdin and resolves true on a `y`/`yes`
 * response (case-insensitive), false on anything else (including
 * empty input or EOF). Used for destructive-action confirmations.
 *
 * If stdin isn't a TTY (piped input, CI), returns false — callers
 * should pass `--yes` to skip the prompt non-interactively.
 */
async function confirmInteractive(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      `Refusing to prompt for confirmation in non-interactive mode. Pass --yes to skip.`,
    );
    return false;
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

type ConfirmOutcome = "yes" | "no" | "refused";

/**
 * Confirms a destructive action.
 * - `--yes` flag → "yes" (no prompt).
 * - Interactive TTY: prompts; user "y" → "yes", anything else → "no".
 * - Non-TTY without `--yes` → "refused" (a usage error, not a denial).
 *
 * Callers should map `"no"` → {@link EXIT.SUCCESS} (clean refusal)
 * and `"refused"` → {@link EXIT.USAGE} (the script forgot `--yes`).
 */
async function confirmHardDelete(args: string[], question: string): Promise<ConfirmOutcome> {
  if (hasFlag(args, "--yes")) return "yes";
  if (!process.stdin.isTTY) {
    console.error(
      `Refusing to prompt for confirmation in non-interactive mode. Pass --yes to skip.`,
    );
    return "refused";
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes" ? "yes" : "no";
  } finally {
    rl.close();
  }
}

/**
 * Thrown by command handlers for input/usage errors (missing args,
 * mutually-exclusive flags, malformed values that the parser
 * caught). The dispatcher prints a "Usage:" line if `usage` is
 * provided, then exits with {@link EXIT.USAGE}.
 *
 * Domain errors (e.g. `ProjectError`) bubble out as themselves and
 * are mapped to {@link EXIT.RUNTIME} by the dispatcher; only call
 * this when the *user's input* is wrong.
 */
class UsageError extends Error {
  readonly name = "UsageError" as const;
  constructor(message: string, readonly usage?: string) {
    super(message);
  }
}

/**
 * Domain-error classes that the CLI dispatcher knows how to report
 * cleanly: print `Error: <message>` to stderr, exit
 * {@link EXIT.RUNTIME}. Anything not in this list bubbles through
 * the top-level catch (which still prints a clean message but
 * cannot show a "this was a known kind of failure" hint).
 *
 * Listed once here so adding a new domain error class is a single
 * import + one-line append rather than a new try/catch arm in
 * every command.
 */
const KNOWN_DOMAIN_ERRORS: ReadonlyArray<new (...args: never[]) => Error> = [
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  BurndownError,
  LabelError,
  MilestoneError,
  ProjectError,
  ReorderError,
  SprintError,
  TaskNotFoundError,
  UserError,
  // RelationshipError surfaces from link/unlink; not currently
  // imported here because the existing handlers let it bubble.
  // Add it when a future command catches it.
];

/**
 * Runs a command handler and maps thrown errors to the right exit
 * code + stderr message:
 * - `UsageError` → print `Error: …` (and `Usage: …` if provided),
 *   exit {@link EXIT.USAGE}.
 * - Any class in {@link KNOWN_DOMAIN_ERRORS} → print `Error: …`,
 *   exit {@link EXIT.RUNTIME}.
 * - Anything else → re-throw so the outer `main()` catch handles it.
 *
 * The body owns the success path: `runCommand` only touches
 * `process.exitCode` on a thrown error. A body that needs to
 * report partial success can set `process.exitCode` itself before
 * returning normally.
 *
 * Each command's body becomes:
 *
 *     case "foo": {
 *       await runCommand(async () => {
 *         // body that may throw UsageError, or a domain error,
 *         // or do nothing if the command succeeds.
 *       });
 *       break;
 *     }
 *
 * which is much shorter than the per-command try/catch pattern
 * the file used to use.
 */
async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}`);
      if (err.usage) console.error(`Usage: ${err.usage}`);
      process.exitCode = EXIT.USAGE;
      return;
    }
    if (err instanceof Error) {
      for (const Klass of KNOWN_DOMAIN_ERRORS) {
        if (err instanceof Klass) {
          console.error(`Error: ${err.message}`);
          process.exitCode = EXIT.RUNTIME;
          return;
        }
      }
    }
    throw err;
  }
}

/** Round a number to one decimal place for compact column display. */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/** Right-pad a string to `width` columns (single-byte assumption). */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
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

/**
 * Commands that are exempt from the schema-version boot guard.
 *  - `init` runs before any tracker exists.
 *  - `migrate` is the path that fixes a stale schema.
 *  - help/usage commands don't touch the tracker.
 *  - `mcp` and `ui` are long-lived servers that run their own
 *    per-request boot guard.
 */
const SCHEMA_GUARD_EXEMPT_COMMANDS = new Set([
  "init",
  "migrate",
  "mcp",
  "ui",
  "help",
  "--help",
  "-h",
  undefined,
]);

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
      case "init": {
        const prefix = getArg(args, "--prefix") ?? "T-";
        const projectKey = getArg(args, "--project-key");
        const projectLabel = getArg(args, "--project-label");
        const docs = !hasFlag(args, "--no-docs");
        const result = await initLoctt(root, {
          prefix,
          docs,
          ...(projectKey ? { projectKey } : {}),
          ...(projectLabel ? { projectLabel } : {}),
        });
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
          console.log(`Statuses: ${info.workflowConfig.statuses.map(s => s.key).join(", ")}`);
        }
        // Print per-project counters. Each line: "<key> [*]  <prefix><next_number>"
        // The asterisk marks the workspace default.
        try {
          const projects = await loadProjectsConfig(resolveLocttDir(root));
          if (projects.projects.length > 0) {
            console.log(``);
            console.log(`Projects:`);
            for (const p of projects.projects) {
              const counter = info.state?.keys[p.key];
              const star = projects.default === p.key ? " *" : "";
              const next = counter ? `${counter.prefix}${counter.next_number}` : `(no counter)`;
              console.log(`  ${p.key}${star}  ${p.label}  next: ${next}`);
            }
          }
        } catch {
          // No projects.yaml — show nothing extra.
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
        if (hasError) process.exitCode = EXIT.RUNTIME;
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
          process.exitCode = EXIT.USAGE;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);

        // Resolve target project. Walk explicit > workspace default
        // > unique-single-project. Fail if ambiguous.
        const projectsConfig = await loadProjectsConfig(locttDir);
        let projectKey: string;
        try {
          const explicit = getArg(args, "--project");
          projectKey = resolveProjectKey(projectsConfig, {
            ...(explicit !== undefined ? { explicit } : {}),
          });
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exitCode = EXIT.RUNTIME;
          break;
        }

        const task = await withStateLock(locttDir, async () => {
          const state = await loadState(locttDir);
          const status = getArg(args, "--status");
          const priority = getArg(args, "--priority");
          const taskType = getArg(args, "--type");
          const created = await createTask({
            locttDir,
            state,
            ...(workflowConfig !== undefined ? { workflowConfig } : {}),
            options: {
              project: projectKey,
              title,
              ...(status !== undefined ? { status } : {}),
              ...(priority !== undefined ? { priority } : {}),
              ...(taskType !== undefined ? { task_type: taskType } : {}),
            },
          });
          await saveState(locttDir, state);
          return created;
        });
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
            process.exitCode = EXIT.USAGE;
            break;
          }
        }

        // Sugar: `--project <key>` is equivalent to a `project = <key>`
        // clause AND-ed onto whatever query the user passed. Avoids
        // making users construct DSL strings for the common case.
        const projectFilter = getArg(args, "--project");
        const baseQuery = getArg(args, "--query");
        const composedQuery = projectFilter !== undefined
          ? (baseQuery !== undefined && baseQuery.length > 0
              ? `(${baseQuery}) and project = ${projectFilter}`
              : `project = ${projectFilter}`)
          : baseQuery;

        const view = getArg(args, "--view");
        const result = listTasks({
          tasks,
          options: {
            ...(composedQuery !== undefined ? { query: composedQuery } : {}),
            ...(view !== undefined ? { view } : {}),
            ...(limit !== undefined ? { limit } : {}),
            includeArchived: hasFlag(args, "--archived"),
          },
          ...(queriesConfig !== undefined ? { queriesConfig } : {}),
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
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
          process.exitCode = EXIT.USAGE;
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
          process.exitCode = EXIT.USAGE;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await lookupTask(locttDir, ref);
        await setField({
          locttDir,
          taskId: task.frontmatter.id,
          field,
          value,
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        });
        console.log(`Set ${field} = ${value} on ${task.frontmatter.key}`);
        break;
      }

      case "unset": {
        const ref = args[1];
        const field = args[2];
        if (!ref || !field) {
          console.error("Usage: loctt unset <task> <field>");
          process.exitCode = EXIT.USAGE;
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
          process.exitCode = EXIT.USAGE;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await lookupTask(locttDir, ref);
        const targetTask = await lookupTask(locttDir, target);
        await linkTask({
          locttDir,
          taskId: task.frontmatter.id,
          type: relType,
          target: targetTask.frontmatter.id,
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        });
        console.log(`Linked ${task.frontmatter.key} --${relType}--> ${targetTask.frontmatter.key}`);
        break;
      }

      case "unlink": {
        const ref = args[1];
        const relType = args[2];
        const target = args[3];
        if (!ref || !relType || !target) {
          console.error("Usage: loctt unlink <task> <relationship> <target>");
          process.exitCode = EXIT.USAGE;
          break;
        }
        const locttDir = resolveLocttDir(root);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await lookupTask(locttDir, ref);
        const targetTask = await lookupTask(locttDir, target);
        await unlinkTask({
          locttDir,
          taskId: task.frontmatter.id,
          type: relType,
          target: targetTask.frontmatter.id,
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        });
        console.log(`Unlinked ${task.frontmatter.key} --${relType}--> ${targetTask.frontmatter.key}`);
        break;
      }

      case "archive": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt archive <task>");
          process.exitCode = EXIT.USAGE;
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
          process.exitCode = EXIT.USAGE;
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
          console.error("Usage: loctt delete <task> [--hard] [--yes]");
          process.exitCode = EXIT.USAGE;
          break;
        }
        const hard = hasFlag(args, "--hard");
        const locttDir = resolveLocttDir(root);
        const task = await lookupTask(locttDir, ref);
        if (hard) {
          const outcome = await confirmHardDelete(
            args,
            `Permanently delete task ${task.frontmatter.key}?`,
          );
          if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
          await deleteTask(locttDir, task.frontmatter.id, { force: true });
          console.log(`Hard-deleted ${task.frontmatter.key}`);
        } else {
          if (task.frontmatter.archived) {
            console.error(
              `Task ${task.frontmatter.key} is already archived. ` +
              `Use --hard to permanently remove it.`,
            );
            process.exitCode = EXIT.RUNTIME;
            break;
          }
          await archiveTask(locttDir, task.frontmatter.id);
          console.log(`Archived ${task.frontmatter.key} (use --hard to remove permanently)`);
        }
        break;
      }

      case "body": {
        const ref = args[1];
        if (!ref) {
          console.error("Usage: loctt body <task> [--set <text>] [--append <text>]");
          process.exitCode = EXIT.USAGE;
          break;
        }
        const newBody = getArg(args, "--set");
        const appendText = getArg(args, "--append");
        if (newBody !== undefined && appendText !== undefined) {
          console.error("Error: --set and --append are mutually exclusive");
          process.exitCode = EXIT.USAGE;
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
          process.exitCode = EXIT.USAGE;
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
            process.exitCode = EXIT.USAGE;
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
        // Caught explicitly (rather than via runCommand) because the
        // CLI augments `AttachmentExistsError` with a "Use --force"
        // hint that the core error class can't carry on its own.
        const ref = args[1];
        const filePath = args[2];
        if (!ref || !filePath) {
          console.error("Error: missing task ref or file path");
          console.error("Usage: loctt attach <task> <file-path> [--force]");
          process.exitCode = EXIT.USAGE;
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
            console.error(`Error: ${err.message}. Use --force to overwrite.`);
            process.exitCode = EXIT.RUNTIME;
            break;
          }
          if (err instanceof AttachmentSourceError) {
            console.error(`Error: ${err.message}`);
            process.exitCode = EXIT.RUNTIME;
            break;
          }
          throw err;
        }
        break;
      }

      case "detach": {
        await runCommand(async () => {
          const ref = args[1];
          const name = args[2];
          if (!ref || !name) {
            throw new UsageError("missing task ref or name", "loctt detach <task> <name>");
          }
          if (name.includes("/") || name.includes("\\") || name.includes("..")) {
            throw new UsageError(`<name> must be a plain basename (no path separators or '..')`);
          }
          const locttDir = resolveLocttDir(root);
          const task = await lookupTask(locttDir, ref);
          await detachFile({
            locttDir,
            taskId: task.frontmatter.id,
            name,
          });
          console.log(`Detached ${name} from ${task.frontmatter.key}`);
        });
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
          } catch {
            // ignore — user can open the URL manually
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
            const hard = hasFlag(args, "--hard");
            if (!key) {
              console.error(`Error: missing key`);
              console.error(`Usage: loctt project delete <key> [--hard] [--remap-to <other-key>] [--yes]`);
              process.exitCode = EXIT.USAGE;
              break;
            }
            if (hard) {
              // Confirmation has its own exit-code semantics (refused
              // = usage error, no = success), so it stays outside
              // runCommand which would conflate the two.
              const outcome = await confirmHardDelete(
                args,
                `Permanently delete project ${key}? This will rewrite affected tasks.`,
              );
              if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
            }
            await runCommand(async () => {
              const result = await deleteProject(locttDir, key, {
                hard,
                ...(remapTo !== undefined ? { remapTo } : {}),
              });
              if (hard) {
                if (result.remappedTaskCount > 0) {
                  console.log(`Remapped ${result.remappedTaskCount} task(s) to ${remapTo}`);
                }
                console.log(`Hard-deleted project ${key}`);
              } else {
                console.log(`Archived project ${key} (use --hard to remove permanently)`);
              }
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
              `This will rewrite affected tasks.`,
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
              console.error(`Usage: loctt label delete <key> [--hard] [--remap-to <other>] [--yes]`);
              process.exitCode = EXIT.USAGE;
              break;
            }
            const remapTo = getArg(args, "--remap-to");
            const hard = hasFlag(args, "--hard");
            if (hard) {
              const outcome = await confirmHardDelete(
                args,
                `Permanently delete label ${key}? This will rewrite affected tasks.`,
              );
              if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
            }
            await runCommand(async () => {
              const result = await deleteLabel(locttDir, key, {
                hard,
                ...(remapTo !== undefined ? { remapTo } : {}),
              });
              if (hard) {
                if (result.affectedTaskCount > 0) {
                  const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "removed from";
                  console.log(`${action} ${result.affectedTaskCount} task(s)`);
                }
                console.log(`Hard-deleted label ${key}`);
              } else {
                console.log(`Archived label ${key} (use --hard to remove permanently)`);
              }
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
              console.error(`Usage: loctt milestone delete <key> [--hard] [--remap-to <other>] [--yes]`);
              process.exitCode = EXIT.USAGE;
              break;
            }
            const remapTo = getArg(args, "--remap-to");
            const hard = hasFlag(args, "--hard");
            if (hard) {
              const outcome = await confirmHardDelete(
                args,
                `Permanently delete milestone ${key}? This will rewrite affected tasks.`,
              );
              if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
            }
            await runCommand(async () => {
              const result = await deleteMilestone(locttDir, key, {
                hard,
                ...(remapTo !== undefined ? { remapTo } : {}),
              });
              if (hard) {
                if (result.affectedTaskCount > 0) {
                  const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "cleared from";
                  console.log(`${action} ${result.affectedTaskCount} task(s)`);
                }
                console.log(`Hard-deleted milestone ${key}`);
              } else {
                console.log(`Archived milestone ${key} (use --hard to remove permanently)`);
              }
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
              console.error(`Usage: loctt sprint delete <key> [--hard] [--remap-to <other>] [--yes]`);
              process.exitCode = EXIT.USAGE;
              break;
            }
            const remapTo = getArg(args, "--remap-to");
            const hard = hasFlag(args, "--hard");
            if (hard) {
              const outcome = await confirmHardDelete(
                args,
                `Permanently delete sprint ${key}? This will rewrite affected tasks.`,
              );
              if (outcome !== "yes") { process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS; break; }
            }
            await runCommand(async () => {
              const result = await deleteSprint(locttDir, key, {
                hard,
                ...(remapTo !== undefined ? { remapTo } : {}),
              });
              if (hard) {
                if (result.affectedTaskCount > 0) {
                  const action = remapTo !== undefined ? `remapped to '${remapTo}'` : "cleared from";
                  console.log(`${action} ${result.affectedTaskCount} task(s)`);
                }
                console.log(`Hard-deleted sprint ${key}`);
              } else {
                console.log(`Archived sprint ${key} (use --hard to remove permanently)`);
              }
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

      case "rerank": {
        await runCommand(async () => {
          const source = args[1];
          const relationship = args[2];
          const target = args[3];
          if (!source || !relationship || !target) {
            throw new UsageError(
              "missing source, relationship, or target",
              "loctt rerank <source> <relationship> <target> [--before <task>] [--after <task>]",
            );
          }
          const before = getArg(args, "--before");
          const after = getArg(args, "--after");
          if (before !== undefined && after !== undefined) {
            throw new UsageError("--before and --after are mutually exclusive; pass at most one");
          }
          const result = await reorderRelationship({
            locttDir: resolveLocttDir(root),
            sourceRef: source,
            relationshipType: relationship,
            targetRef: target,
            ...(before !== undefined ? { before } : {}),
            ...(after !== undefined ? { after } : {}),
          });
          console.log(`Reranked ${target} under ${source}/${relationship} (rank=${result.rank})`);
          if (result.rebalanced) {
            console.log(`(also rebalanced sibling ranks)`);
          }
        });
        break;
      }

      case "board-rerank": {
        await runCommand(async () => {
          const task = args[1];
          if (!task) {
            throw new UsageError(
              "missing task",
              "loctt board-rerank <task> [--before <task>] [--after <task>]",
            );
          }
          const before = getArg(args, "--before");
          const after = getArg(args, "--after");
          if (before !== undefined && after !== undefined) {
            throw new UsageError("--before and --after are mutually exclusive; pass at most one");
          }
          const result = await reorderBoardRank({
            locttDir: resolveLocttDir(root),
            taskRef: task,
            ...(before !== undefined ? { before } : {}),
            ...(after !== undefined ? { after } : {}),
          });
          console.log(`Reranked ${task} on board (rank=${result.rank})`);
          if (result.rebalanced) {
            console.log(`(also rebalanced sibling ranks)`);
          }
        });
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
