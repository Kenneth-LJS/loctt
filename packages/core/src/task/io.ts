import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Task } from "@loctt/contracts";
import { getTaskFilePath } from "../paths/index.js";
import { splitTaskFile, parseFrontmatter, assembleTaskFile } from "./frontmatter.js";

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
  const filePath = getTaskFilePath(locttDir, taskId);
  await mkdir(dirname(filePath), { recursive: true });
  const content = assembleTaskFile(task.frontmatter, task.body);
  await writeFile(filePath, content, "utf-8");
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
 */
export async function writeTaskBody(locttDir: string, taskId: string, newBody: string): Promise<void> {
  const filePath = getTaskFilePath(locttDir, taskId);
  const content = await readFile(filePath, "utf-8");
  const { rawYaml } = splitTaskFile(content);
  const frontmatter = parseFrontmatter(rawYaml);
  const assembled = assembleTaskFile(frontmatter, newBody);
  await writeFile(filePath, assembled, "utf-8");
}
