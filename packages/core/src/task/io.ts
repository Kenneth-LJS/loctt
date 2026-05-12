import { readFile } from "node:fs/promises";

import { type Task, TaskFrontmatterSchema } from "@loctt/contracts";

import { getTaskFilePath } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { assembleTaskFile,parseFrontmatter, splitTaskFile } from "./frontmatter.js";
import { appendHistory } from "./history.js";
import { clearLookupCaches } from "./lookup-cache.js";

/**
 * Reads and parses a task.md file into a Task (frontmatter + body).
 * Throws if the file doesn't exist or is malformed.
 */
export async function readTask(locttDir: string, taskId: string): Promise<Task> {
  const filePath = getTaskFilePath(locttDir, taskId);
  const content = await readFile(filePath, "utf-8");
  const { rawYaml, body } = splitTaskFile(content);
  const frontmatter = parseFrontmatter(rawYaml);
  return { frontmatter, body };
}

/**
 * Writes a full task.md file (frontmatter + body) to disk.
 * Creates the task directory if it doesn't exist.
 *
 * Drops in-process lookup negative cache entries because a write
 * may have introduced or rewritten a key (e.g. project remap loops
 * call writeTask per task with a new `project` field, and the
 * task's `key` may have changed via key_history). Cheaper than
 * trying to detect key changes here; positive lookups still go
 * through the on-disk index.
 */
export async function writeTask(locttDir: string, taskId: string, task: Task): Promise<void> {
  // Validate the frontmatter shape against the schema before writing.
  // Previously this round-tripped through serialize+parse, which
  // re-stringified the YAML purely to re-parse it — schema validation
  // catches the same class of error in one pass.
  TaskFrontmatterSchema.parse(task.frontmatter);

  const filePath = getTaskFilePath(locttDir, taskId);
  const content = assembleTaskFile(task.frontmatter, task.body);
  await writeFileAtomically(filePath, content);
  clearLookupCaches(locttDir);
}

/**
 * Reads only the markdown body of a task (skipping frontmatter).
 */
export async function readTaskBody(locttDir: string, taskId: string): Promise<string> {
  const filePath = getTaskFilePath(locttDir, taskId);
  const content = await readFile(filePath, "utf-8");
  const { body } = splitTaskFile(content);
  return body;
}

/**
 * Internal helper: reads a task once, applies `transformer` to the body,
 * bumps `updated_at`, writes atomically, and appends a `body_edited`
 * history entry. Single read+write — no double parse/serialize.
 *
 * Wrapped in withStateLock so a concurrent setField/archive can't
 * interleave with the read-modify-write, and so the body write +
 * history append are atomic against other writers.
 *
 * Clears the in-process lookup negative cache on success so a
 * just-rewritten body doesn't continue to resolve a stale "key
 * not found" cached from before — same invariant `writeTask`
 * maintains for frontmatter writes.
 */
async function updateTaskBody(
  locttDir: string,
  taskId: string,
  transformer: (body: string) => string,
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const filePath = getTaskFilePath(locttDir, taskId);
    const content = await readFile(filePath, "utf-8");
    const { rawYaml, body } = splitTaskFile(content);
    const frontmatter = parseFrontmatter(rawYaml);
    const newBody = transformer(body);
    const now = new Date().toISOString();
    const updated = { ...frontmatter, updated_at: now };
    const assembled = assembleTaskFile(updated, newBody);
    await writeFileAtomically(filePath, assembled);
    clearLookupCaches(locttDir);
    await appendHistory(locttDir, taskId, [{ timestamp: now, kind: "body_edited" }]);
  });
}

/**
 * Replaces the markdown body of a task while preserving frontmatter.
 * Updates `updated_at` to the current time.
 */
export async function writeTaskBody(locttDir: string, taskId: string, newBody: string): Promise<void> {
  await updateTaskBody(locttDir, taskId, () => newBody);
}

/**
 * Appends text to a task's markdown body, separating it from the existing
 * content with a blank line. Empty bodies just become the appended text.
 *
 * Single source of truth for append spacing — both CLI `body --append` and
 * MCP `append_task_body` go through this so their behavior can't drift.
 */
export async function appendTaskBody(locttDir: string, taskId: string, text: string): Promise<void> {
  await updateTaskBody(locttDir, taskId, (current) => {
    if (current.length === 0) {
      return text + "\n";
    } else if (current.endsWith("\n\n")) {
      return current + text + "\n";
    } else if (current.endsWith("\n")) {
      return current + "\n" + text + "\n";
    } else {
      return current + "\n\n" + text + "\n";
    }
  });
}
