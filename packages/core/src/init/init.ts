import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getProjectsConfigPath } from "../config/projects.js";
import {
  getConfigDir,
  getDocsDir,
  getLocalDir,
  getQueriesConfigPath,
  getSchemaVersionPath,
  getStateFilePath,
  getTasksDir,
  getWorkflowConfigPath,
  resolveLocttDir,
} from "../paths/index.js";
import { CURRENT_SCHEMA_VERSION, writeSchemaVersion } from "../schema/index.js";
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
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectKey)) {
    throw new Error(
      `project key must be a slug (lowercase letters, digits, hyphen, underscore), got: ${projectKey}`,
    );
  }
  if (prefix.length === 0) {
    throw new Error(`prefix must be non-empty`);
  }

  if (await fileExists(locttDir)) {
    throw new Error(`.loctt directory already exists at ${locttDir}`);
  }

  const created: string[] = [];

  // Create directory structure
  await mkdir(getConfigDir(locttDir), { recursive: true });
  await mkdir(getTasksDir(locttDir), { recursive: true });
  await mkdir(getLocalDir(locttDir), { recursive: true });

  // Write default config files
  const workflowPath = getWorkflowConfigPath(locttDir);
  await writeFile(workflowPath, defaultWorkflowYaml(prefix), "utf-8");
  created.push(workflowPath);

  const queriesPath = getQueriesConfigPath(locttDir);
  await writeFile(queriesPath, defaultQueriesYaml(), "utf-8");
  created.push(queriesPath);

  // Write the starting project list. From this point on, the
  // tracker has multi-project support: more projects can be added
  // via `loctt project create`, but at least one always exists.
  const projectsPath = getProjectsConfigPath(locttDir);
  await writeFile(projectsPath, defaultProjectsYaml(projectKey, projectLabel, prefix), "utf-8");
  created.push(projectsPath);

  // Write default state. Counter is keyed by the project key, not
  // the literal "task" — per-project counters layer cleanly on top.
  const statePath = getStateFilePath(locttDir);
  await writeFile(statePath, defaultStateYaml(projectKey, prefix), "utf-8");
  created.push(statePath);

  // Stamp the schema version. Migrations key off this on every load.
  await writeSchemaVersion(locttDir, CURRENT_SCHEMA_VERSION);
  created.push(getSchemaVersionPath(locttDir));

  // Bootstrap a default user. Names come from $USER env so the
  // first run is zero-prompt; the user can edit later.
  await ensureDefaultUser(locttDir);

  // Write the .loctt/.gitignore so per-checkout files (current user
  // pointer, per-user UI settings) don't pollute the shared history.
  // The committed parts of `.loctt/` (tasks, workflow, projects,
  // user profiles) are still tracked normally.
  const gitignorePath = join(locttDir, ".gitignore");
  await writeFile(
    gitignorePath,
    [
      "# Per-checkout pointers and per-user UI settings — do not commit.",
      ".current-user",
      "users/*/settings.yaml",
      "",
      "# Migration backups left by `loctt migrate`.",
      "../.loctt.backup-*",
      "",
    ].join("\n"),
    "utf-8",
  );
  created.push(gitignorePath);

  // Generate helper docs if requested
  if (genDocs) {
    const docsDir = getDocsDir(locttDir);
    await mkdir(docsDir, { recursive: true });

    const readmePath = join(docsDir, "README.md");
    await writeFile(readmePath, DOCS_README, "utf-8");
    created.push(readmePath);

    const workflowDocPath = join(docsDir, "workflow.md");
    await writeFile(workflowDocPath, DOCS_WORKFLOW, "utf-8");
    created.push(workflowDocPath);

    const gitSyncDocPath = join(docsDir, "git-sync.md");
    await writeFile(gitSyncDocPath, DOCS_GIT_SYNC, "utf-8");
    created.push(gitSyncDocPath);

    const agentsDocPath = join(docsDir, "agents.md");
    await writeFile(agentsDocPath, DOCS_AGENTS, "utf-8");
    created.push(agentsDocPath);
  }

  return { locttDir, created };
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
