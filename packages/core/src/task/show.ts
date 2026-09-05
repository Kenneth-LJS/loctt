import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Task, WorkflowConfig } from "@loctt/contracts";

import type { AuxConfigs } from "../config/validation.js";
import { getAttachmentsDir } from "../paths/index.js";
import { classifyTaskHealth, withExtrinsicHealth } from "./health.js";
import { lookupById, TaskNotFoundError, UnreadableTaskError } from "./lookup.js";
import { mimeForFilename } from "./mime.js";

/** Attachment metadata discovered from the task folder. */
export interface AttachmentInfo {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  /**
   * IANA MIME type derived from the filename extension. Absent when
   * the extension is unknown — consumers should treat that as
   * `application/octet-stream`. No file content is read to determine
   * the type.
   */
  readonly mime?: string;
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
  /**
   * The target's live title and status, carried so a relationships
   * panel can show what a linked task actually is without issuing one
   * request per edge. Absent when `missing` is true.
   *
   * Read at resolve time rather than stored on the edge: a copy on the
   * edge would go stale the moment the target changed, which is the
   * kind of drift P1 exists to prevent.
   */
  readonly resolvedTitle?: string;
  readonly resolvedStatus?: string;
}

/** A structured task summary for display. */
export interface TaskShowModel {
  readonly task: Task;
  readonly attachments: readonly AttachmentInfo[];
  readonly relationships: readonly ResolvedRelationship[];
  /**
   * Why the attachments list is empty, when it is empty *because the
   * directory could not be read* rather than because there is nothing
   * in it.
   *
   * REL-49 wants an unreadable `attachments/` to degrade **that
   * section** and leave the rest of the task rendering. Absent on the
   * overwhelmingly common paths — no attachments, or attachments that
   * read fine — so a caller that ignores it behaves exactly as before.
   */
  readonly attachmentsError?: string;
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
  } catch (err) {
    // **ENOENT only.** A bare `catch { return [] }` made "there is no
    // attachments directory" and "I could not read it" the same
    // answer, so a permissions failure rendered as
    // "No attachments on this task yet" over a directory holding a
    // file — ERR-1's prohibition, and REL-49's first bullet inverted.
    //
    // Found by the M2 gate and confirmed on the CLI: `loctt show`
    // dropped the section silently too, so this is core, not the web
    // client.
    //
    // A task with no attachments has no directory, which is the
    // overwhelmingly common path and still returns []. Anything else
    // — EACCES, EIO, ENOTDIR — is a real failure and now propagates
    // to a caller that can name the directory and the reason.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const attachments: AttachmentInfo[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const filePath = join(attachmentsDir, entry);
    const stats = await stat(filePath);
    if (stats.isFile()) {
      const mime = mimeForFilename(entry);
      attachments.push({
        name: entry,
        path: filePath,
        size: stats.size,
        ...(mime !== undefined ? { mime } : {}),
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
        const status = target.frontmatter.status;
        const title = target.frontmatter.title;
        return {
          type: r.type,
          target: r.target,
          resolvedKey: target.frontmatter.key,
          // title is optional now (K26 — a target with a degraded title
          // still resolves); include it only when present.
          ...(title !== undefined ? { resolvedTitle: title } : {}),
          ...(status !== undefined ? { resolvedStatus: status } : {}),
          missing: false,
        };
      } catch (err) {
        // A target that is absent and a target that will not parse are
        // both edges this task cannot follow — from *this* task's point
        // of view they are the same broken link, and neither is a
        // reason to fail the page the user actually asked for.
        //
        // Only `TaskNotFoundError` was tolerated, so one corrupt
        // `task.md` made every task linking to it return a 500 naming
        // the corrupt task's **ULID** — a page the user can neither
        // read nor act on, about a task they did not ask for. Found by
        // the M2 gate (F3), and it is the unfinished half of A19: the
        // same tolerance was applied to `unlink` and not to the read.
        //
        // The corrupt task's *own* page still reports the parse error
        // with its path and position — that is where the user can act,
        // and `UnreadableTaskError` carries what they need. Swallowing
        // it here loses nothing, because the row is already rendered as
        // broken.
        //
        // A permission or disk failure still propagates: those are not
        // "this edge is broken", they are "this tracker cannot be
        // read", and hiding them would be the LST-33 mistake.
        if (err instanceof TaskNotFoundError || err instanceof UnreadableTaskError) {
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
  /**
   * Configs for extrinsic health classification (proposal § 4.6). When
   * given, `invalid_value` / `dangling` findings are computed and merged
   * onto `model.task.health` alongside the intrinsic findings, so a
   * surface reads one list. Omit to report intrinsic health only (the
   * detail view without a workflow loaded).
   */
  health?: { workflow?: WorkflowConfig; aux?: AuxConfigs },
): Promise<TaskShowModel> {
  // **Not `Promise.all` over both.** It was, and that made an
  // attachments failure reject the whole model — so once
  // `discoverAttachments` correctly stopped swallowing an unreadable
  // directory, the *entire* task read began failing on all three
  // surfaces: task, relationships, comments and meta panel, gone
  // together. Measured: `loctt show T-1` printed nothing but the
  // EACCES.
  //
  // That is REL-49 inverted twice over — the first fix removed a
  // silent lie and put a total failure in its place, when the case
  // asks for the section to degrade and everything else to stand.
  // Found by the M2 gate at round 2 (F5).
  //
  // Relationships still reject: a task whose *own* links cannot be
  // resolved has no honest page to show, and `resolveRelationships`
  // already tolerates the per-edge failures that are survivable.
  const relationships = await resolveRelationships(locttDir, task);
  // Merge extrinsic health (invalid_value / dangling) onto the intrinsic
  // health, so the model's task carries one list a surface can render.
  let modelTask = task;
  if (health !== undefined) {
    const extrinsic = await classifyTaskHealth(locttDir, task, health.workflow, health.aux ?? {});
    if (extrinsic.length > 0) modelTask = withExtrinsicHealth(task, extrinsic);
  }
  try {
    const attachments = await discoverAttachments(locttDir, task.frontmatter.id);
    return { task: modelTask, attachments, relationships };
  } catch (err) {
    return {
      task: modelTask,
      attachments: [],
      relationships,
      attachmentsError: (err as Error).message,
    };
  }
}
