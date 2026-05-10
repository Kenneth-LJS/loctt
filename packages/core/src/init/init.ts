import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getProjectsConfigPath } from "../config/projects.js";
import {
  getDocsDir,
  getQueriesConfigPath,
  getSchemaVersionPath,
  getStateFilePath,
  getWorkflowConfigPath,
  resolveLocttDir,
} from "../paths/index.js";
import { CURRENT_SCHEMA_VERSION } from "../schema/index.js";
import { ensureDefaultUser } from "../users/index.js";
import { fileExists } from "../utils/fs.js";
import {
  defaultProjectsYaml,
  defaultQueriesYaml,
  defaultStateYaml,
  defaultWorkflowYaml,
} from "./defaults.js";

export interface InitOptions {
  /** Key prefix, defaults to "T-". */
  readonly prefix?: string;
  /**
   * Starting project key (slug). Defaults to "tasks".
   * The state.yaml counter is keyed by this and tasks created in
   * this project carry it as their `project` frontmatter field.
   */
  readonly projectKey?: string;
  /**
   * Starting project label (display name). Defaults to "Tasks".
   */
  readonly projectLabel?: string;
  /** Whether to generate helper docs. Defaults to true. */
  readonly docs?: boolean;
}

export interface InitResult {
  readonly locttDir: string;
  readonly created: readonly string[];
}

/**
 * Initializes a .loctt directory with default config, state, and structure.
 * Throws if .loctt already exists.
 */
export async function initLoctt(root: string, options: InitOptions = {}): Promise<InitResult> {
  const locttDir = resolveLocttDir(root);
  const prefix = options.prefix ?? "T-";
  const projectKey = options.projectKey ?? "task";
  const projectLabel = options.projectLabel ?? "Task";
  const genDocs = options.docs ?? true;

  // Validate up front so the user sees a clean error rather than a
  // post-write parse failure on first load.
  if (!/^[a-z][a-z0-9_-]*$/.test(projectKey)) {
    throw new Error(
      `project key must start with a lowercase letter, followed by lowercase letters, digits, hyphen, or underscore (got: ${projectKey})`,
    );
  }
  if (prefix.length === 0) {
    throw new Error(`prefix must be non-empty`);
  }

  if (await fileExists(locttDir)) {
    throw new Error(`.loctt directory already exists at ${locttDir}`);
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

    // Starting project list. From this point on the tracker has
    // multi-project support: more projects can be added via
    // `loctt project create`, but at least one always exists.
    await writeFile(
      join(stageDir, "config", "projects.yaml"),
      defaultProjectsYaml(projectKey, projectLabel, prefix),
      "utf-8",
    );
    created.push(getProjectsConfigPath(locttDir));

    // Counter is keyed by the project key, not the literal "task"
    // — per-project counters layer cleanly on top.
    await writeFile(join(stageDir, "state.yaml"), defaultStateYaml(projectKey, prefix), "utf-8");
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

    // Atomic flip — after this point, `.loctt/` exists in its
    // final form or not at all.
    await rename(stageDir, locttDir);
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
