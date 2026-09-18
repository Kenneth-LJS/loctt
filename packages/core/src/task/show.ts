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
  /**
   * The target is corrupt — distinct from missing (S4 / corruption
   * sweep). `missing` alone conflated three states an edge can be in:
   *
   *   1. **resolved-healthy** — `missing:false`, `targetCorrupt` absent.
   *   2. **resolved-but-corrupt** — `missing:false`, `targetCorrupt:true`.
   *      The tolerant `readTask` loaded the target but it carries
   *      `health` findings (e.g. a wrong-typed `title`). Before this the
   *      edge rendered as an ordinary, untitled-but-fine row — a corrupt
   *      task disguised as a healthy one with no title.
   *   3. **corrupt-but-unreadable** — `missing:true`, `targetCorrupt:true`.
   *      The target is on disk but object-fatally unreadable
   *      (`UnreadableTaskError` — a bad `id`/`key` or a YAML syntax
   *      error). Before this it rendered identically to a *deleted*
   *      target, telling the user a file that exists was removed.
   *   4. **absent/deleted** — `missing:true`, `targetCorrupt` absent.
   *      `TaskNotFoundError`: no task directory at all.
   *
   * The absent-vs-unreadable split (3 vs 4) is free: the two are already
   * distinct exception classes (`TaskNotFoundError` vs
   * `UnreadableTaskError`) caught in the same block. Omitted (not
   * `false`) on the healthy path so a consumer that ignores it — and the
   * existing wire/tests that assert exact edge shapes — behave as before.
   */
  readonly targetCorrupt?: boolean;
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
        // The tolerant `readTask` returns a Task even when a field-local
        // corruption was lifted into `health` (a wrong-typed title, an
        // unrecognised key, etc.). Such a target resolves — it has a key
        // and often a title — but the edge must say it needs attention
        // rather than pass as an ordinary row (sweep § "Surface it").
        const corrupt = (target.health?.length ?? 0) > 0;
        return {
          type: r.type,
          target: r.target,
          resolvedKey: target.frontmatter.key,
          // title is optional now (K26 — a target with a degraded title
          // still resolves); include it only when present.
          ...(title !== undefined ? { resolvedTitle: title } : {}),
          ...(status !== undefined ? { resolvedStatus: status } : {}),
          missing: false,
          ...(corrupt ? { targetCorrupt: true } : {}),
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
        // Genuinely absent: no task directory. `missing` alone — this is
        // the deleted/dangling case REL-24 renders as "no task with id".
        if (err instanceof TaskNotFoundError) {
          return { type: r.type, target: r.target, missing: true };
        }
        // On disk but object-fatally unreadable (bad id/key, YAML syntax
        // error). Still `missing` from this task's point of view — the
        // edge cannot be followed to a readable task — but corrupt, NOT
        // deleted: the file exists and the fix is to repair it, not to
        // accept it as gone. Distinguishing the two costs nothing: they
        // are already separate exception classes.
        if (err instanceof UnreadableTaskError) {
          return { type: r.type, target: r.target, missing: true, targetCorrupt: true };
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
