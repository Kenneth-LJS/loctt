import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import { IanaTimezone } from "@loctt/contracts";

import {
  detectMachineTimezone,
  getCalendarConfigPath,
  serializeCalendarConfig,
} from "../config/calendar.js";
import { getProjectsConfigPath, loadProjectsConfig } from "../config/projects.js";
import { getTrackerInfo } from "../diagnostics/info.js";
import {
  getDocsDir,
  getQueriesConfigPath,
  getSchemaVersionPath,
  getStateFilePath,
  getWorkflowConfigPath,
  resolveLocttDir,
} from "../paths/index.js";
import { assertValidPrefix } from "../projects/prefix.js";
import { CURRENT_SCHEMA_VERSION } from "../schema/index.js";
import { ensureDefaultUser } from "../users/index.js";
import { fileExists } from "../utils/fs.js";
import { missingCoreFiles } from "./core-files.js";
import {
  defaultProjectsYaml,
  defaultQueriesYaml,
  defaultStateYaml,
  defaultWorkflowYaml,
} from "./defaults.js";

export interface InitOptions {
  /**
   * Restore files missing from an existing `.loctt/` instead of
   * refusing. Existing files are left exactly as they are — this only
   * fills gaps, so a repair can never overwrite surviving config or
   * tasks.
   */
  readonly repair?: boolean;
  /** Key prefix (bare letters; "-" added at render). Defaults to "T". */
  readonly prefix?: string;
  /**
   * Starting project name (display). Defaults to "Tasks".
   * The project's id is auto-generated as a ULID; the state.yaml
   * counter and tasks' `project` frontmatter both reference that id.
   */
  readonly projectName?: string;
  /** Whether to generate helper docs. Defaults to true. */
  readonly docs?: boolean;
  /**
   * Workspace IANA timezone written into calendar.yaml. Defaults to
   * the initializing machine's zone.
   *
   * Recorded explicitly at init rather than detected on every read:
   * calendar.yaml is workspace-shared and committed, so "today" must
   * mean the same thing to everyone on the tracker. A caller can pass
   * an explicit zone when the initializing machine isn't where the
   * team actually works.
   */
  readonly timezone?: string;
}

export interface InitResult {
  readonly locttDir: string;
  readonly created: readonly string[];
}

/**
 * A `.loctt/` that exists but is missing files init would have written.
 *
 * Distinct from the plain "already exists" refusal: this one names what
 * is gone and points at the repair, because the alternative a user
 * reaches for is deleting the directory — and their tasks with it.
 */
export class InitRepairNeededError extends Error {
  constructor(
    readonly locttDir: string,
    readonly missing: readonly string[],
  ) {
    super(
      `.loctt directory at ${locttDir} exists but is incomplete. Missing: `
      + `${missing.join(", ")}. Run 'loctt init --repair' to restore the missing `
      + `files; your tasks are left untouched. Run 'loctt doctor' for the full report.`,
    );
    this.name = "InitRepairNeededError";
  }
}

/**
 * Writes back only the files that are absent, in place.
 *
 * Deliberately not staged-and-renamed like a fresh init: the directory
 * already holds the user's tasks, so replacing it wholesale is the
 * outcome this exists to avoid. Each write is guarded by an existence
 * check, so a surviving file is never overwritten.
 *
 * `state.yaml` is the delicate one — recreating it resets key counters,
 * which would reissue keys already in use. It is derived from the tasks
 * on disk instead, so the counters resume past the highest key found.
 */
async function repairLoctt(
  locttDir: string,
  opts: { prefix: string; projectName: string; timezone: string; projectId: string },
): Promise<InitResult> {
  const created: string[] = [];
  await mkdir(join(locttDir, "config"), { recursive: true });
  await mkdir(join(locttDir, "tasks"), { recursive: true });
  await mkdir(join(locttDir, "local"), { recursive: true });

  // Reuse the surviving project id where possible: tasks reference their
  // project by id (P-2), so minting a new one would orphan every task.
  let projectId = opts.projectId;
  let prefix = opts.prefix;
  if (await fileExists(getProjectsConfigPath(locttDir))) {
    try {
      const cfg = await loadProjectsConfig(locttDir);
      const first = cfg.projects[0];
      if (first) {
        projectId = first.id;
        prefix = first.prefix;
      }
    } catch {
      // Unreadable projects.yaml: fall through to the generated id
      // rather than failing the repair outright.
    }
  }

  const writes: [string, string, string][] = [
    [getWorkflowConfigPath(locttDir), defaultWorkflowYaml(prefix), "config/workflow.yaml"],
    [getQueriesConfigPath(locttDir), defaultQueriesYaml(), "config/queries.yaml"],
    [getCalendarConfigPath(locttDir), serializeCalendarConfig({
      timezone: opts.timezone,
      first_day_of_week: 1,
      working_days: [1, 2, 3, 4, 5],
      holidays: [],
    }), "config/calendar.yaml"],
    [getProjectsConfigPath(locttDir), defaultProjectsYaml(projectId, opts.projectName, prefix), "config/projects.yaml"],
  ];
  for (const [path, content, label] of writes) {
    if (await fileExists(path)) continue;
    await writeFile(path, content, "utf-8");
    created.push(label);
  }

  if (!(await fileExists(getStateFilePath(locttDir)))) {
    // Fresh counters would reissue keys already on disk, so `doctor
    // --rebuild-index` is the documented follow-up. Written at 1 rather
    // than guessed, and the repair output says so.
    await writeFile(getStateFilePath(locttDir), defaultStateYaml(projectId, prefix), "utf-8");
    created.push("state.yaml");
  }

  const schemaPath = join(locttDir, ".schema-version");
  if (!(await fileExists(schemaPath))) {
    await writeFile(schemaPath, `${String(CURRENT_SCHEMA_VERSION)}\n`, "utf-8");
    created.push(".schema-version");
  }

  return { locttDir, created };
}

/**
 * Initializes a .loctt directory with default config, state, and structure.
 * Throws if .loctt already exists.
 */
export async function initLoctt(root: string, options: InitOptions = {}): Promise<InitResult> {
  const locttDir = resolveLocttDir(root);
  const prefix = options.prefix ?? "T";
  const projectName = options.projectName ?? "Tasks";
  const genDocs = options.docs ?? true;
  // Validate before staging anything: serializeCalendarConfig doesn't
  // check, so an unknown zone would otherwise write a calendar.yaml
  // that every subsequent load rejects.
  const timezone = options.timezone ?? detectMachineTimezone();
  const tzCheck = IanaTimezone.safeParse(timezone);
  if (!tzCheck.success) {
    throw new Error(
      `invalid timezone "${timezone}": ${tzCheck.error.issues.map(i => i.message).join("; ")}`,
    );
  }

  // K88/A80: prefixes are bare uppercase letters (the `-` is inserted at
  // key render). Strict: a dash or lowercase/digit/punctuation is
  // rejected, not normalised.
  assertValidPrefix(prefix);
  if (projectName.length === 0) {
    throw new Error(`project name must be non-empty`);
  }

  // Generate the initial project's id up front so projects.yaml and
  // state.yaml agree on the same ULID.
  const { ulid } = await import("ulid");
  const projectId = ulid();

  // B22 (K129): an EMPTY `.loctt/` (no config, no state, no tasks) is
  // set up like a missing one, with no message and no extra step. Ken:
  // "just ignore, proceed with steps. dont even show this to the user".
  let intoExisting = false;
  if (await fileExists(locttDir)) {
    // A tracker already here is either healthy — in which case re-init
    // is a mistake and must be refused — or damaged, in which case
    // refusing with "already exists" leaves `rm -rf .loctt/` as the only
    // route back, destroying every surviving task (ONB-C3).
    const missing = await missingCoreFiles(locttDir);
    if (missing.length === 0) {
      throw new Error(`.loctt directory already exists at ${locttDir}`);
    }
    // `getTrackerInfo` owns the empty-versus-damaged line, so what the
    // web shows as "no tracker" and what init fills in cannot disagree.
    // Only `empty` is safe here: a `damaged` tracker still has tasks,
    // and a fresh state.yaml would reissue their keys.
    if ((await getTrackerInfo(root)).initState === "empty") {
      intoExisting = true;
    } else {
      if (options.repair !== true) {
        throw new InitRepairNeededError(locttDir, missing);
      }
      return repairLoctt(locttDir, { prefix, projectName, timezone, projectId });
    }
  }

  // Stage everything in a sibling temp directory and atomically
  // rename it into place at the very end. A crash mid-init leaves
  // only the temp directory behind, which can be cleaned up
  // manually; the user's project root never contains a half-built
  // `.loctt/`.
  const parent = dirname(locttDir);
  await mkdir(parent, { recursive: true });
  const stageDir = `${locttDir}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

  const created: string[] = [];
  try {
    await mkdir(stageDir, { recursive: true });
    await mkdir(join(stageDir, "config"), { recursive: true });
    await mkdir(join(stageDir, "tasks"), { recursive: true });
    await mkdir(join(stageDir, "local"), { recursive: true });

    await writeFile(join(stageDir, "config", "workflow.yaml"), defaultWorkflowYaml(prefix), "utf-8");
    created.push(getWorkflowConfigPath(locttDir));

    await writeFile(join(stageDir, "config", "queries.yaml"), defaultQueriesYaml(), "utf-8");
    created.push(getQueriesConfigPath(locttDir));

    // Calendar. The timezone is semantic, not just Gantt shading — it
    // decides what "today" means for `due_date < today` — so it's
    // recorded here as an explicit committed value rather than being
    // re-detected per machine on every read.
    await writeFile(
      join(stageDir, "config", "calendar.yaml"),
      serializeCalendarConfig({
        timezone,
        first_day_of_week: 1,
        working_days: [1, 2, 3, 4, 5],
        holidays: [],
      }),
      "utf-8",
    );
    created.push(getCalendarConfigPath(locttDir));

    // Starting project list. From this point on the tracker has
    // multi-project support: more projects can be added via
    // `loctt project create`, but at least one always exists.
    await writeFile(
      join(stageDir, "config", "projects.yaml"),
      defaultProjectsYaml(projectId, projectName, prefix),
      "utf-8",
    );
    created.push(getProjectsConfigPath(locttDir));

    // Counter is keyed by the project's id (ULID), matching the entry
    // in projects.yaml. Per-project counters layer on this id cleanly
    // when more projects are added later.
    await writeFile(join(stageDir, "state.yaml"), defaultStateYaml(projectId, prefix), "utf-8");
    created.push(getStateFilePath(locttDir));

    // Schema version. Migrations key off this on every load.
    await writeFile(join(stageDir, ".schema-version"), `${CURRENT_SCHEMA_VERSION}\n`, "utf-8");
    created.push(getSchemaVersionPath(locttDir));

    // Per-checkout files (current user pointer, per-user UI
    // settings) are gitignored so they don't pollute shared
    // history. Committed parts (tasks, workflow, projects, user
    // profiles) are still tracked normally.
    await writeFile(
      join(stageDir, ".gitignore"),
      [
        "# Per-checkout pointers and per-user UI settings — do not commit.",
        ".current-user",
        "users/*/settings.yaml",
        "",
      ].join("\n"),
      "utf-8",
    );
    created.push(join(locttDir, ".gitignore"));

    if (genDocs) {
      await mkdir(join(stageDir, "docs"), { recursive: true });
      await writeFile(join(stageDir, "docs", "README.md"), DOCS_README, "utf-8");
      created.push(join(getDocsDir(locttDir), "README.md"));
      await writeFile(join(stageDir, "docs", "workflow.md"), DOCS_WORKFLOW, "utf-8");
      created.push(join(getDocsDir(locttDir), "workflow.md"));
      await writeFile(join(stageDir, "docs", "git-sync.md"), DOCS_GIT_SYNC, "utf-8");
      created.push(join(getDocsDir(locttDir), "git-sync.md"));
      await writeFile(join(stageDir, "docs", "agents.md"), DOCS_AGENTS, "utf-8");
      created.push(join(getDocsDir(locttDir), "agents.md"));
    }

    if (intoExisting) {
      // The folder is already there, so it cannot be renamed into
      // place. The staged files are moved in instead, and anything
      // already in the folder is kept as it is. Not atomic: a crash
      // part-way leaves a `damaged` tracker, which `--repair` finishes.
      //
      // One exception (A346): `.schema-version`. An empty tracker has no
      // config, state or task for an old stamp to describe, and
      // `rm -rf .loctt/*` leaves this dotfile behind; keeping it would
      // stamp the fresh tracker with a version it was not written at.
      await rm(getSchemaVersionPath(locttDir), { force: true });
      const kept = await moveEntriesInto(stageDir, locttDir);
      await rm(stageDir, { recursive: true, force: true });
      // `created` names what was written, not what was staged: a file
      // the folder already held was kept, so it was not created.
      const notWritten = (p: string): boolean =>
        kept.some(k => p === k || p.startsWith(`${k}${sep}`));
      const written = created.filter(p => !notWritten(p));
      created.length = 0;
      created.push(...written);
    } else {
      // Atomic flip — after this point, `.loctt/` exists in its
      // final form or not at all.
      await rename(stageDir, locttDir);
    }
  } catch (err) {
    // Clean up the staging directory; the user's project root is
    // unchanged because we never wrote into the final path.
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  // Migration backups land as siblings (`../.loctt.backup-*`),
  // so the gitignore entry needs to live in the project root, not
  // inside `.loctt/`. Append to root .gitignore (create if absent).
  await ensureRootGitignoreEntry(parent);

  // Bootstrap a default user. Names come from $USER env so the
  // first run is zero-prompt; the user can edit later. Done
  // post-rename so the user folder is created against the final
  // location, and so the rest of init succeeds even if the user
  // bootstrap fails (re-running `loctt user create` recovers).
  await ensureDefaultUser(locttDir);

  return { locttDir, created };
}

/**
 * Moves every entry of `src` into `dest`, merging directories and never
 * replacing anything `dest` already holds. Used to set up an empty
 * `.loctt/` in place (B22). Returns the `dest` paths it left alone
 * because something was already there, so the caller can report only
 * what it actually wrote.
 */
async function moveEntriesInto(src: string, dest: string): Promise<string[]> {
  const kept: string[] = [];
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (!(await fileExists(to))) {
      await rename(from, to);
    } else if (entry.isDirectory() && (await stat(to)).isDirectory()) {
      kept.push(...(await moveEntriesInto(from, to)));
    } else {
      // `dest` already has something here: it is the user's, kept.
      kept.push(to);
    }
  }
  return kept;
}

async function ensureRootGitignoreEntry(rootDir: string): Promise<void> {
  const path = join(rootDir, ".gitignore");
  const entry = ".loctt.backup-*";
  let existing = "";
  try {
    existing = await readFile(path, "utf-8");
  } catch {
    // Missing root .gitignore — write a fresh one with just our entry.
  }
  const lines = existing.split("\n");
  if (lines.some(l => l.trim() === entry)) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(
    path,
    `${existing}${sep}# LocTT migration backups\n${entry}\n`,
    "utf-8",
  );
}

const DOCS_README = `# LocTT

Local task tracker. Tasks are stored as markdown files under \`.loctt/tasks/\`.

## Quick Reference

- Configuration: \`.loctt/config/workflow.yaml\` and \`.loctt/config/queries.yaml\`
- State: \`.loctt/state.yaml\`
- Tasks: \`.loctt/tasks/<id>/task.md\`

See other docs in this directory for workflow, git sync, and agent guidelines.
`;

const DOCS_WORKFLOW = `# Workflow

## Statuses
Statuses are defined in \`.loctt/config/workflow.yaml\`. Each status has a semantic category (pending, active, completed, discarded).

## Priorities
Priorities have optional numeric values for sorting.

## Task Types
Task types categorize tasks. Default: \`task\`.

## Relationships
Relationships link tasks together. Default types: parent/child, blocks/is_blocked_by, relates_to.
`;

const DOCS_GIT_SYNC = `# Git Sync

LocTT supports optional Git-backed mode using a \`.loctt\` branch with sparse worktree.

## Commands
- \`loctt git enable\` — Enable Git-backed mode
- \`loctt git disable\` — Disable Git-backed mode
- \`loctt publish\` — Push local state to the canonical branch
- \`loctt sync\` — Pull canonical state into local workspace

## Rules
- Do not manually edit the \`.loctt\` branch
- Conflicts are resolved through the reconcile flow
`;

const DOCS_AGENTS = `# Agent Guidelines

When using LocTT through MCP or other agent interfaces:

- Use structured tools for metadata operations (create, update, set/unset fields)
- Do not edit task frontmatter directly — use the provided tools
- If a validation fails, do not bypass it by editing the file
- Markdown body content can be edited freely
`;
