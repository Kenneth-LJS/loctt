import { join, resolve } from "node:path";

const LOCTT_DIR = ".loctt";
const TASKS_DIR = "tasks";
const CONFIG_DIR = "config";
const LOCAL_DIR = "local";
const DOCS_DIR = "docs";
const STATE_FILE = "state.yaml";
const TASK_FILE = "task.md";
const HISTORY_FILE = "history.yaml";
const WORKFLOW_FILE = "workflow.yaml";
const QUERIES_FILE = "queries.yaml";
const SYNC_FILE = "sync.yaml";
const RECONCILE_FILE = "reconcile.yaml";
const KEY_INDEX_FILE = "key-index.yaml";

/**
 * Resolves the .loctt directory from a given root.
 * Does not check existence — caller is responsible for validation.
 */
export function resolveLocttDir(root: string): string {
  return resolve(root, LOCTT_DIR);
}

/** Returns the path to the tasks directory: .loctt/tasks/ */
export function getTaskDir(locttDir: string, taskId: string): string {
  return join(locttDir, TASKS_DIR, taskId);
}

/** Returns the path to a task's task.md file. */
export function getTaskFilePath(locttDir: string, taskId: string): string {
  return join(locttDir, TASKS_DIR, taskId, TASK_FILE);
}

/** Returns the path to a task's history.yaml file. */
export function getHistoryFilePath(locttDir: string, taskId: string): string {
  return join(locttDir, TASKS_DIR, taskId, HISTORY_FILE);
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
