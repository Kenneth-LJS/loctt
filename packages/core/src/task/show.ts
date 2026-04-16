import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Task } from "@loctt/contracts";
import { getTaskDir } from "../paths/index.js";

/** Attachment metadata discovered from the task folder. */
export interface AttachmentInfo {
  readonly name: string;
  readonly path: string;
  readonly size: number;
}

/** A structured task summary for display. */
export interface TaskShowModel {
  readonly task: Task;
  readonly attachments: readonly AttachmentInfo[];
}

/**
 * Discovers attachment files in a task's folder.
 * Any file that isn't task.md is considered an attachment.
 */
export async function discoverAttachments(
  locttDir: string,
  taskId: string,
): Promise<AttachmentInfo[]> {
  const taskDir = getTaskDir(locttDir, taskId);
  let entries;
  try {
    entries = await readdir(taskDir);
  } catch {
    return [];
  }

  const attachments: AttachmentInfo[] = [];
  for (const entry of entries) {
    if (entry === "task.md") continue;
    const filePath = join(taskDir, entry);
    const stats = await stat(filePath);
    if (stats.isFile()) {
      attachments.push({
        name: entry,
        path: filePath,
        size: stats.size,
      });
    }
  }

  return attachments;
}

/**
 * Builds a TaskShowModel from a loaded task.
 * Includes attachment discovery.
 */
export async function buildShowModel(
  locttDir: string,
  task: Task,
): Promise<TaskShowModel> {
  const attachments = await discoverAttachments(locttDir, task.frontmatter.id);
  return { task, attachments };
}
