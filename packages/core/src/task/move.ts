import type { HistoryEntry, LocttState, Task } from "@loctt/contracts";
import { ulid } from "ulid";

import { loadProjectsConfig } from "../config/projects.js";
import {
  addToKeyIndex,
  loadKeyIndex,
  loadState,
  saveKeyIndex,
  saveState,
  withStateLock,
} from "../state/index.js";
import { allocateKey, appendKeyHistory } from "../state/keys.js";
import { appendHistory } from "./history.js";
import { writeTask } from "./io.js";
import { lookupTask, TaskNotFoundError } from "./lookup.js";
import { clearLookupCaches } from "./lookup-cache.js";

/**
 * The fields a move is answerable for. A move is a preserve-others edit
 * — it changes exactly these — so it must NOT be written with the
 * universal `["*"]` touched (which would let the write guard's rule 2
 * wave through the loss of an untouched corrupt field).
 */
const MOVE_TOUCHED: ReadonlySet<string> = new Set([
  "project",
  "key",
  "key_history",
  "updated_at",
]);

export class MoveTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoveTaskError";
  }
}

export interface MoveTaskOptions {
  readonly locttDir: string;
  readonly taskRef: string;
  /** Target project id. Must already exist and not be archived. */
  readonly targetProjectId: string;
}

export interface MoveTaskResult {
  readonly task: Task;
  readonly oldKey: string;
  readonly newKey: string;
}

async function loadTargetProject(locttDir: string, projectId: string) {
  const cfg = await loadProjectsConfig(locttDir);
  const def = cfg.projects.find(p => p.id === projectId);
  if (!def) {
    throw new MoveTaskError(`unknown target project: ${projectId}`);
  }
  if (def.archived) {
    throw new MoveTaskError(`target project is archived: ${projectId}`);
  }
  return def;
}


/**
 * Points the key index at a task's new key after a rekey.
 *
 * The index's lazy fold keys off unknown **ids**, and a move keeps the
 * id — so nothing detected the change and `loctt show OPS1` returned
 * "task not found" for a task LocTT had just moved to OPS1, while the
 * retired key still resolved. `doctor` reported the index in sync,
 * because a rekey leaves the entry count unchanged.
 *
 * Fixed here rather than in `lookupByKey`: an out-of-band *hand* edit
 * is documented as unsupported and repaired by `doctor --rebuild-index`
 * (P-12). This is LocTT's own write path, which owns the invariant it
 * breaks. Skipped when the index does not exist — it is built lazily,
 * and creating one here would change when that happens.
 */
async function reindexKey(
  locttDir: string,
  id: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  const index = await loadKeyIndex(locttDir);
  if (!index) return;
  // The old key is kept: `key_history` makes it resolvable (P-7).
  let next = addToKeyIndex(index, newKey, id);
  next = addToKeyIndex(next, oldKey, id);
  if (next !== index) await saveKeyIndex(locttDir, next);
}

function performMove(args: {
  state: LocttState;
  source: Task;
  targetProjectId: string;
  now: string;
  bulkOpId?: string;
}): { task: Task; oldKey: string; newKey: string; historyEntries: HistoryEntry[] } {
  const { state, source, targetProjectId, now, bulkOpId } = args;
  const oldKey = source.frontmatter.key;
  const oldProject = source.frontmatter.project;
  const newKey = allocateKey(state, targetProjectId);
  const keyHistory = appendKeyHistory(source.frontmatter.key_history, oldKey);
  const updated: Task = {
    frontmatter: {
      ...source.frontmatter,
      project: targetProjectId,
      key: newKey,
      key_history: keyHistory,
      updated_at: now,
    },
    body: source.body,
    // Carry the source's health so assembleTaskFile re-emits any
    // preserved corrupt/unrecognised field. Without this a
    // field-local corruption lifted into `source.health` is dropped
    // on the rebuild (§ 13.1 B1 preserve-others, P-11).
    ...(source.health !== undefined ? { health: source.health } : {}),
  };
  const historyEntries: HistoryEntry[] = [
    {
      timestamp: now,
      kind: "field_change",
      field: "project",
      before: oldProject,
      after: targetProjectId,
      ...(bulkOpId !== undefined ? { bulk_op_id: bulkOpId } : {}),
    },
    {
      timestamp: now,
      kind: "field_change",
      field: "key",
      before: oldKey,
      after: newKey,
      ...(bulkOpId !== undefined ? { bulk_op_id: bulkOpId } : {}),
    },
  ];
  return { task: updated, oldKey, newKey, historyEntries };
}

/**
 * Moves a task to a different project. The task keeps its id and its
 * body, but receives a fresh key allocated under the target project's
 * prefix. The previous key is appended to `key_history` so existing
 * lookups by the old key continue to work.
 *
 * History records two `field_change` entries — one for `project`, one
 * for `key` — both stamped with the same timestamp.
 */
export async function moveTaskToProject(
  opts: MoveTaskOptions,
): Promise<MoveTaskResult> {
  await loadTargetProject(opts.locttDir, opts.targetProjectId);
  return withStateLock(opts.locttDir, async () => {
    const source = await lookupTask(opts.locttDir, opts.taskRef);
    if (source.frontmatter.project === opts.targetProjectId) {
      return { task: source, oldKey: source.frontmatter.key, newKey: source.frontmatter.key };
    }
    const state = await loadState(opts.locttDir);
    const now = new Date().toISOString();
    const { task, oldKey, newKey, historyEntries } = performMove({
      state, source, targetProjectId: opts.targetProjectId, now,
    });
    await writeTask(opts.locttDir, task.frontmatter.id, task, MOVE_TOUCHED);
    await saveState(opts.locttDir, state);
    await reindexKey(opts.locttDir, task.frontmatter.id, oldKey, newKey);
    clearLookupCaches(opts.locttDir);
    await appendHistory(opts.locttDir, task.frontmatter.id, historyEntries);
    return { task, oldKey, newKey };
  });
}

export interface BulkMoveTaskOptions {
  readonly locttDir: string;
  readonly taskRefs: readonly string[];
  readonly targetProjectId: string;
}

export interface BulkMoveTaskResult {
  readonly bulk_op_id: string;
  readonly succeeded: { taskId: string; oldKey: string; newKey: string }[];
  readonly failed: { taskId: string; error: string }[];
}

/**
 * Bulk variant of {@link moveTaskToProject}. One state lock spans the
 * whole batch; per-task failures are captured rather than aborting.
 * Every history entry produced carries the shared `bulk_op_id`.
 */
export async function bulkMoveTasksToProject(
  opts: BulkMoveTaskOptions,
): Promise<BulkMoveTaskResult> {
  await loadTargetProject(opts.locttDir, opts.targetProjectId);
  const bulkOpId = ulid();
  return withStateLock(opts.locttDir, async () => {
    const state = await loadState(opts.locttDir);
    const now = new Date().toISOString();
    const succeeded: { taskId: string; oldKey: string; newKey: string }[] = [];
    const failed: { taskId: string; error: string }[] = [];
    let mutated = false;
    for (const ref of opts.taskRefs) {
      try {
        const source = await lookupTask(opts.locttDir, ref);
        if (source.frontmatter.project === opts.targetProjectId) {
          succeeded.push({
            taskId: source.frontmatter.id,
            oldKey: source.frontmatter.key,
            newKey: source.frontmatter.key,
          });
          continue;
        }
        const { task, oldKey, newKey, historyEntries } = performMove({
          state, source, targetProjectId: opts.targetProjectId, now, bulkOpId,
        });
        // `performMove` has already consumed a key from `state`. Mark
        // the state dirty here rather than after the write: a write that
        // fails leaves the counter incremented either way, and whether
        // that increment survived used to depend on whether some *other*
        // task in the batch happened to succeed. Persisting it always is
        // the safe direction — a consumed-then-abandoned number is a gap
        // in the sequence, while reissuing one collides with a key the
        // user may still hold in key_history (P-7).
        mutated = true;
        await writeTask(opts.locttDir, task.frontmatter.id, task, MOVE_TOUCHED);
        await reindexKey(opts.locttDir, task.frontmatter.id, oldKey, newKey);
        await appendHistory(opts.locttDir, task.frontmatter.id, historyEntries);
        succeeded.push({ taskId: task.frontmatter.id, oldKey, newKey });
      } catch (err) {
        if (err instanceof TaskNotFoundError) {
          failed.push({ taskId: ref, error: "task not found" });
        } else {
          failed.push({ taskId: ref, error: (err as Error).message });
        }
      }
    }
    if (mutated) {
      await saveState(opts.locttDir, state);
      clearLookupCaches(opts.locttDir);
    }
    return { bulk_op_id: bulkOpId, succeeded, failed };
  });
}
