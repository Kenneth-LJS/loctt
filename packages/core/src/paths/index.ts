import { join, resolve } from "node:path";

const LOCTT_DIR = ".loctt";
const TASKS_DIR = "tasks";
const CONFIG_DIR = "config";
const LOCAL_DIR = "local";
const DOCS_DIR = "docs";
const ATTACHMENTS_DIR = "attachments";
const STATE_FILE = "state.yaml";
const TASK_FILE = "task.md";
const HISTORY_FILE = "_history.yaml";
const WORKFLOW_FILE = "workflow.yaml";
const QUERIES_FILE = "queries.yaml";
const SYNC_FILE = "sync.yaml";
const RECONCILE_FILE = "reconcile.yaml";
const KEY_INDEX_FILE = "key-index.yaml";
const JOURNAL_FILE = "journal.yaml";
const SCHEMA_VERSION_FILE = ".schema-version";
const SCHEMA_MIGRATION_IN_PROGRESS_FILE = ".schema-migration-in-progress";
const USERS_DIR = "users";
const USER_PROFILE_FILE = "profile.yaml";
const USER_SETTINGS_FILE = "settings.yaml";
const CURRENT_USER_FILE = ".current-user";

/**
 * Validates that a string is a safe basename for a file inside a task
 * directory: no path separators, no `..`, no null bytes. Empty strings
 * are also rejected.
 *
 * Throws a generic `Error` on violation; callers that want a typed
 * error should catch and rethrow.
 */
export function assertSafeBasename(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("filename must be a non-empty string");
  }
  if (name.includes("\0")) {
    throw new Error("filename must not contain null bytes");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(`filename must not contain path separators: ${name}`);
  }
  if (name === "." || name === "..") {
    throw new Error(`filename must not be "." or ".."`);
  }
  // Defense-in-depth: catch any embedded traversal token
  if (name.split(/[/\\]/).some(p => p === "..")) {
    throw new Error(`filename must not contain path traversal: ${name}`);
  }
}

/**
 * Resolves the .loctt directory from a given root.
 * Does not check existence — caller is responsible for validation.
 */
export function resolveLocttDir(root: string): string {
  return resolve(root, LOCTT_DIR);
}

/** Returns the path to the tasks directory: .loctt/tasks/ */
export function getTaskDir(locttDir: string, taskId: string): string {
  assertSafeBasename(taskId);
  return join(locttDir, TASKS_DIR, taskId);
}

/** Returns the path to a task's task.md file. */
export function getTaskFilePath(locttDir: string, taskId: string): string {
  assertSafeBasename(taskId);
  return join(locttDir, TASKS_DIR, taskId, TASK_FILE);
}

/** Returns the path to a task's _history.yaml file. */
export function getHistoryFilePath(locttDir: string, taskId: string): string {
  assertSafeBasename(taskId);
  return join(locttDir, TASKS_DIR, taskId, HISTORY_FILE);
}

/** Returns the path to a task's attachments directory. */
export function getAttachmentsDir(locttDir: string, taskId: string): string {
  assertSafeBasename(taskId);
  return join(locttDir, TASKS_DIR, taskId, ATTACHMENTS_DIR);
}

/**
 * Returns the absolute path to a single attachment file. The `name`
 * argument must be a plain basename — slashes, backslashes, `..`, and
 * null bytes are rejected.
 */
export function getAttachmentPath(
  locttDir: string,
  taskId: string,
  name: string,
): string {
  assertSafeBasename(taskId);
  assertSafeBasename(name);
  return join(locttDir, TASKS_DIR, taskId, ATTACHMENTS_DIR, name);
}

/** Returns the path to the config directory: .loctt/config/ */
export function getConfigDir(locttDir: string): string {
  return join(locttDir, CONFIG_DIR);
}

/** Returns the path to .loctt/state.yaml. */
export function getStateFilePath(locttDir: string): string {
  return join(locttDir, STATE_FILE);
}

/** Returns the path to the local directory: .loctt/local/ */
export function getLocalDir(locttDir: string): string {
  return join(locttDir, LOCAL_DIR);
}

/** Returns the path to .loctt/config/workflow.yaml. */
export function getWorkflowConfigPath(locttDir: string): string {
  return join(locttDir, CONFIG_DIR, WORKFLOW_FILE);
}

/** Returns the path to .loctt/config/queries.yaml. */
export function getQueriesConfigPath(locttDir: string): string {
  return join(locttDir, CONFIG_DIR, QUERIES_FILE);
}

/** Returns the path to .loctt/local/sync.yaml. */
export function getSyncStatePath(locttDir: string): string {
  return join(locttDir, LOCAL_DIR, SYNC_FILE);
}

/** Returns the path to .loctt/local/reconcile.yaml. */
export function getReconcileStatePath(locttDir: string): string {
  return join(locttDir, LOCAL_DIR, RECONCILE_FILE);
}

/** Returns the path to the docs directory: .loctt/docs/ */
export function getDocsDir(locttDir: string): string {
  return join(locttDir, DOCS_DIR);
}

/** Returns the path to the tasks root directory: .loctt/tasks/ */
export function getTasksDir(locttDir: string): string {
  return join(locttDir, TASKS_DIR);
}

/** Returns the path to .loctt/local/key-index.yaml. */
export function getKeyIndexPath(locttDir: string): string {
  return join(locttDir, LOCAL_DIR, KEY_INDEX_FILE);
}

/**
 * Returns the path to .loctt/local/journal.yaml — the crash-recovery
 * journal for multi-step writes (see `state/journal.ts`). Local only;
 * not shared across machines via git.
 */
export function getJournalPath(locttDir: string): string {
  return join(locttDir, LOCAL_DIR, JOURNAL_FILE);
}

/** Returns the path to .loctt/.schema-version. */
export function getSchemaVersionPath(locttDir: string): string {
  return join(locttDir, SCHEMA_VERSION_FILE);
}

/** Returns the path to .loctt/.schema-migration-in-progress. */
export function getSchemaMigrationInProgressPath(locttDir: string): string {
  return join(locttDir, SCHEMA_MIGRATION_IN_PROGRESS_FILE);
}

/** Returns the path to .loctt/users/. */
export function getUsersDir(locttDir: string): string {
  return join(locttDir, USERS_DIR);
}

/** Returns the path to a single user's folder: .loctt/users/<id>/. */
export function getUserDir(locttDir: string, userId: string): string {
  assertSafeBasename(userId);
  return join(locttDir, USERS_DIR, userId);
}

/** Returns the path to a user's profile.yaml. */
export function getUserProfilePath(locttDir: string, userId: string): string {
  assertSafeBasename(userId);
  return join(locttDir, USERS_DIR, userId, USER_PROFILE_FILE);
}

/** Returns the path to a user's settings.yaml (gitignored). */
export function getUserSettingsPath(locttDir: string, userId: string): string {
  assertSafeBasename(userId);
  return join(locttDir, USERS_DIR, userId, USER_SETTINGS_FILE);
}

/** Returns the path to .loctt/.current-user (gitignored). */
export function getCurrentUserPath(locttDir: string): string {
  return join(locttDir, CURRENT_USER_FILE);
}
