import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Task } from "@loctt/contracts";

import { getAttachmentsDir } from "../paths/index.js";
import { lookupById, TaskNotFoundError } from "./lookup.js";

/** Attachment metadata discovered from the task folder. */
export interface AttachmentInfo {
  readonly name: string;
  readonly path: string;
  readonly size: number;
}

/**
 * A relationship with its target ID resolved to the current user-facing key.
 * If the target task no longer exists, `resolvedKey` is undefined and `missing`
 * is true so renderers can surface a sensible fallback.
 */
export interface ResolvedRelationship {
  readonly type: string;
  readonly target: string;
  readonly resolvedKey?: string;
  readonly missing: boolean;
}

/** A structured task summary for display. */
export interface TaskShowModel {
  readonly task: Task;
  readonly attachments: readonly AttachmentInfo[];
  readonly relationships: readonly ResolvedRelationship[];
}

/**
 * Discovers attachment files in a task's `attachments/` subdirectory.
 *
 * Returns `[]` if the directory doesn't exist (a task with no attachments
 * never gets the subdir created). Dotfiles and any nested subdirectories
 * are skipped — the v1 contract is a flat directory of regular files.
 */
export async function discoverAttachments(
  locttDir: string,
  taskId: string,
): Promise<AttachmentInfo[]> {
  const attachmentsDir = getAttachmentsDir(locttDir, taskId);
  let entries;
  try {
    entries = await readdir(attachmentsDir);
  } catch {
    return [];
  }

  const attachments: AttachmentInfo[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const filePath = join(attachmentsDir, entry);
    const stats = await stat(filePath);
    if (stats.isFile()) {
      attachments.push({
        name: entry,
        path: filePath,
        size: stats.size,
      });
    }
    // Skip directories and other non-file entries (defense in depth).
  }

  return attachments;
}

/**
 * Resolves each relationship target ID to the current key of the referenced
 * task. Targets that no longer exist are marked `missing` so callers can
 * render a sensible fallback (we keep the raw ID in `target`).
 */
export async function resolveRelationships(
  locttDir: string,
  task: Task,
): Promise<ResolvedRelationship[]> {
  const rels = task.frontmatter.relationships ?? [];
  return Promise.all(
    rels.map(async r => {
      try {
        const target = await lookupById(locttDir, r.target);
        return { type: r.type, target: r.target, resolvedKey: target.frontmatter.key, missing: false };
      } catch (err) {
        // Only treat genuinely-missing tasks as "missing"; let real I/O
        // errors (permission, disk) propagate so the caller sees them.
        if (err instanceof TaskNotFoundError) {
          return { type: r.type, target: r.target, missing: true };
        }
        throw err;
      }
    }),
  );
}

/**
 * Builds a TaskShowModel from a loaded task.
 * Includes attachment discovery and relationship key resolution.
 */
export async function buildShowModel(
  locttDir: string,
  task: Task,
): Promise<TaskShowModel> {
  const [attachments, relationships] = await Promise.all([
    discoverAttachments(locttDir, task.frontmatter.id),
    resolveRelationships(locttDir, task),
  ]);
  return { task, attachments, relationships };
}
