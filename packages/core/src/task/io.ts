import { createHash } from "node:crypto";
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
  opts: BodyWriteOptions = {},
): Promise<void> {
  await withStateLock(locttDir, async () => {
    const filePath = getTaskFilePath(locttDir, taskId);
    const content = await readFile(filePath, "utf-8");
    const { rawYaml, body } = splitTaskFile(content);
    const frontmatter = parseFrontmatter(rawYaml);

    // The lock serialises this call's read-modify-write; it cannot see
    // that the *caller's* buffer is stale. Two clients that both read
    // and both write therefore both succeed, and the second silently
    // discards the first's work (CMT-C3).
    if (opts.expectedToken !== undefined) {
      const current = tokenFor(frontmatter.updated_at, body);
      if (current !== opts.expectedToken) {
        throw new StaleBodyWriteError(frontmatter.key ?? taskId);
      }
    }
    const newBody = transformer(body);
    const now = new Date().toISOString();
    const updated = { ...frontmatter, updated_at: now };
    const assembled = assembleTaskFile(updated, newBody);
    await writeFileAtomically(filePath, assembled);
    clearLookupCaches(locttDir);
    // Carry the body itself (M3): without it history records *that* the
    // body changed and never *to what*, so nothing can reconstruct a
    // prior version — and the git-sync merge rule (M2) that resolves a
    // contested field by taking the later write depends on being able to.
    // Coalescing keeps this to one snapshot per editing burst rather
    // than one per keystroke.
    await appendHistory(locttDir, taskId, [
      { timestamp: now, kind: "body_edited", before: body, after: newBody },
    ]);
  });
}

/**
 * Replaces the markdown body of a task while preserving frontmatter.
 * Updates `updated_at` to the current time.
 */
export async function writeTaskBody(
  locttDir: string,
  taskId: string,
  newBody: string,
  opts: BodyWriteOptions = {},
): Promise<void> {
  await updateTaskBody(locttDir, taskId, () => newBody, opts);
}

/** Options shared by the body write paths. */
export interface BodyWriteOptions {
  /**
   * A token from a prior {@link bodyToken} read. When given, the write
   * is refused if the task changed in between. Omit for
   * last-write-wins, which is what every existing caller gets.
   */
  readonly expectedToken?: string;
}

/**
 * Rejected because the task moved under the caller.
 *
 * States plainly that nothing was written: a client that cannot tell a
 * refusal from a success will close the tab believing its text landed.
 */
export class StaleBodyWriteError extends Error {
  constructor(readonly ref: string) {
    super(
      `${ref} changed since you read it — your text has NOT been saved. `
      + `Re-read the task, reapply your edit, and write again.`,
    );
    this.name = "StaleBodyWriteError";
  }
}

/**
 * A token identifying the task's current body state.
 *
 * Derived from `updated_at` plus a body digest rather than stored:
 * nothing new lands on disk, and any write — body or frontmatter —
 * invalidates it, which is the conservative direction. A token that
 * survived an unrelated frontmatter change could let a body write
 * through that was composed against different metadata.
 */
export async function bodyToken(locttDir: string, taskId: string): Promise<string> {
  const content = await readFile(getTaskFilePath(locttDir, taskId), "utf-8");
  const { rawYaml, body } = splitTaskFile(content);
  return tokenFor(parseFrontmatter(rawYaml).updated_at, body);
}

function tokenFor(updatedAt: string | undefined, body: string): string {
  return createHash("sha256")
    .update(`${updatedAt ?? ""}\u0000${body}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Appends text to a task's markdown body, separating it from the existing
 * content with a blank line. Empty bodies just become the appended text.
 *
 * Single source of truth for append spacing — both CLI `body --append` and
 * MCP `append_task_body` go through this so their behavior can't drift.
 *
 * Takes the same {@link BodyWriteOptions} as {@link writeTaskBody}: an
 * append is as capable of clobbering a concurrent edit as a replace,
 * since the text it appends to is the text it just read.
 */
export async function appendTaskBody(
  locttDir: string,
  taskId: string,
  text: string,
  opts: BodyWriteOptions = {},
): Promise<void> {
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
  }, opts);
}
