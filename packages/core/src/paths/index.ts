import { join, resolve } from "node:path";

const LOCTT_DIR = ".loctt";
const TASKS_DIR = "tasks";
const CONFIG_DIR = "config";
const LOCAL_DIR = "local";
const STATE_FILE = "state.yaml";
const TASK_FILE = "task.md";

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
