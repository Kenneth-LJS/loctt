import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename,writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Task } from "@loctt/contracts";

import { getTaskFilePath } from "../paths/index.js";
import { assembleTaskFile,parseFrontmatter, serializeFrontmatter, splitTaskFile } from "./frontmatter.js";
import { appendHistory } from "./history.js";

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}

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
 */
export async function writeTask(locttDir: string, taskId: string, task: Task): Promise<void> {
  // Validate frontmatter by round-tripping through serialize+parse before writing
  parseFrontmatter(serializeFrontmatter(task.frontmatter));

  const filePath = getTaskFilePath(locttDir, taskId);
  await mkdir(dirname(filePath), { recursive: true });
  const content = assembleTaskFile(task.frontmatter, task.body);
  await atomicWrite(filePath, content);
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
 * Replaces the markdown body of a task while preserving frontmatter.
 * Updates `updated_at` to the current time.
 */
export async function writeTaskBody(locttDir: string, taskId: string, newBody: string): Promise<void> {
  const filePath = getTaskFilePath(locttDir, taskId);
  const content = await readFile(filePath, "utf-8");
  const { rawYaml } = splitTaskFile(content);
  const frontmatter = parseFrontmatter(rawYaml);
  const now = new Date().toISOString();
  const updated = { ...frontmatter, updated_at: now };
  const assembled = assembleTaskFile(updated, newBody);
  await atomicWrite(filePath, assembled);
  await appendHistory(locttDir, taskId, [{ timestamp: now, kind: "body_edited" }]);
}

/**
 * Appends text to a task's markdown body, separating it from the existing
 * content with a blank line. Empty bodies just become the appended text.
 *
 * Single source of truth for append spacing — both CLI `body --append` and
 * MCP `append_task_body` go through this so their behavior can't drift.
 */
export async function appendTaskBody(locttDir: string, taskId: string, text: string): Promise<void> {
  const current = await readTaskBody(locttDir, taskId);
  let next: string;
  if (current.length === 0) {
    next = text + "\n";
  } else if (current.endsWith("\n\n")) {
    next = current + text + "\n";
  } else if (current.endsWith("\n")) {
    next = current + "\n" + text + "\n";
  } else {
    next = current + "\n\n" + text + "\n";
  }
  await writeTaskBody(locttDir, taskId, next);
}
