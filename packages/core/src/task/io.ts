import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { FieldHealth, Task } from "@loctt/contracts";

import { LocttError, type LocttErrorOptions } from "../errors.js";
import { getTaskFilePath } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { assembleTaskFile, parseFrontmatter, splitTaskFile } from "./frontmatter.js";
import { appendHistory } from "./history.js";
import { clearLookupCaches } from "./lookup-cache.js";

/**
 * Reads and parses a task.md file into a Task (frontmatter + body).
 *
 * Tolerant by construction (proposal § 4.3): a field-local corruption
 * (a wrong-typed `due_date`, a broken `title`, an unrecognised key) does
 * NOT throw — the corrupt field is lifted into `task.health` and the
 * rest of the task loads (`health` is omitted when clean). Object-fatal
 * corruption — a YAML syntax error or a bad `id`/`key` — still throws
 * `TaskParseError`, so `lookup.ts`'s attribution to `UnreadableTaskError`
 * is unchanged. A file that doesn't exist throws ENOENT.
 */
export async function readTask(locttDir: string, taskId: string): Promise<Task> {
  const filePath = getTaskFilePath(locttDir, taskId);
  const content = await readFile(filePath, "utf-8");
  const { rawYaml, body } = splitTaskFile(content);
  const { frontmatter, health } = parseFrontmatter(rawYaml);
  return { frontmatter, body, ...(health.length > 0 ? { health } : {}) };
}

/**
 * Refused because a write would introduce or worsen field-level
 * corruption (proposal § 4.4/§ 13.1 B1). Carries the field so a surface
 * can attribute the refusal to the corrupt field, not the one edited.
 */
export class CorruptWriteError extends LocttError {
  constructor(message: string, field: string | undefined, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, {
      dataState: "not_saved",
      ...(field !== undefined ? { field } : {}),
      ...opts,
    });
    this.name = "CorruptWriteError";
  }
}

/**
 * The single write-side guard (proposal § 4.4, as amended by § 13.1 B1).
 *
 * Replaces the old strict `TaskFrontmatterSchema.parse` on the write
 * path — which refused every write to a corrupt task — with a rule that
 * is *safer* than strict, not looser: it permits the writes principle 7
 * requires (edit another field, preserve the corrupt one) and forbids
 * the ones principle 1 cares about (a write that makes corruption worse
 * or silently discards a corrupt value).
 *
 * Serialize `after`, re-parse it (object-fatal → refuse, as before),
 * then enforce two rules by `(field, kind)`:
 *   1. **No new finding.** A `(field, kind)` in `after` but not `before`
 *      means the write introduced corruption — refuse.
 *   2. **A finding may leave only for a touched field.** A `(field,
 *      kind)` in `before` but not `after` is a repair *only* when `field`
 *      is in the write's declared `touched` set. Otherwise the write
 *      defaulted a corrupt structure away and discarded its raw value —
 *      exactly the silent loss `?? {}` / `?? []` cause — so refuse.
 *
 * `before` is the on-disk state, re-read here so the guard measures
 * against the bytes on disk (review S3), not a possibly-stale caller
 * copy. That is one extra read per write, always under the state lock.
 */
export async function assertWriteSafe(
  locttDir: string,
  taskId: string,
  after: Task,
  touched: ReadonlySet<string>,
): Promise<void> {
  // 1. The serialized result must still be object-parseable.
  const content = assembleTaskFile(after);
  const { rawYaml } = splitTaskFile(content);
  const reparsed = parseFrontmatter(rawYaml); // throws TaskParseError if object-fatal
  const afterHealth = reparsed.health;

  // Load the on-disk `before` (may not exist yet — a fresh task).
  let beforeHealth: readonly FieldHealth[] = [];
  try {
    const existing = await readFile(getTaskFilePath(locttDir, taskId), "utf-8");
    const split = splitTaskFile(existing);
    beforeHealth = parseFrontmatter(split.rawYaml).health;
  } catch (err) {
    // ENOENT (new task) or object-fatal on disk: there is no prior
    // health to preserve. A fresh write of a clean task is safe; a
    // write that itself introduces corruption is caught by rule 1.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT"
      && !(err instanceof Error && err.name === "TaskParseError")) {
      throw err;
    }
  }

  const universal = touched.has("*");
  const key = (h: FieldHealth): string => `${h.field} ${h.kind}`;
  const beforeSet = new Set(beforeHealth.map(key));
  const afterSet = new Set(afterHealth.map(key));
  // What the writer DECLARED as already-corrupt on the Task it handed us.
  // A finding it declared is intentional (e.g. restore of a corrupt
  // backup carries its health); a finding that only appears on reparse,
  // undeclared and absent before, is one the writer introduced by writing
  // a malformed value — and that is refused even for a whole-record write.
  const declaredSet = new Set((after.health ?? []).map(key));

  // Rule 1: no new finding. A finding present after the write must either
  // have existed before, or have been explicitly declared on the Task —
  // otherwise this write introduced corruption (a bad new value).
  for (const h of afterHealth) {
    if (!beforeSet.has(key(h)) && !declaredSet.has(key(h))) {
      throw new CorruptWriteError(
        `refusing to write ${taskId}: this write would introduce corruption in `
        + `"${h.field}" (${h.kind}: ${h.error})`,
        h.field,
      );
    }
  }
  // Rule 2: a finding may leave only for a touched field. A whole-record
  // writer (universal) is exempt — it authors the record fresh.
  if (!universal) {
    for (const h of beforeHealth) {
      if (afterSet.has(key(h))) continue; // still present
      if (touched.has(h.field)) continue; // repaired by a write that names it
      throw new CorruptWriteError(
        `refusing to write ${taskId}: it would drop the preserved value of `
        + `corrupt field "${h.field}" (${h.kind}) that this write does not touch`,
        h.field,
      );
    }
  }
}

/**
 * Writes a full task.md file (frontmatter + body) to disk.
 * Creates the task directory if it doesn't exist.
 *
 * `touched` names the fields this write is answerable for (§ 13.1 B1);
 * a preserved corrupt value on any *other* field must survive. Callers
 * that mutate specific fields pass exactly those names; callers that
 * write a fully-formed task (create, restore) may pass `ALL_FIELDS_TOUCHED`
 * to opt out of the monotonic check when they own the whole record.
 *
 * Drops in-process lookup negative cache entries because a write
 * may have introduced or rewritten a key (e.g. project remap loops
 * call writeTask per task with a new `project` field, and the
 * task's `key` may have changed via key_history). Cheaper than
 * trying to detect key changes here; positive lookups still go
 * through the on-disk index.
 */
export async function writeTask(
  locttDir: string,
  taskId: string,
  task: Task,
  touched: ReadonlySet<string> = ALL_FIELDS_TOUCHED,
): Promise<void> {
  await assertWriteSafe(locttDir, taskId, task, touched);
  const filePath = getTaskFilePath(locttDir, taskId);
  const content = assembleTaskFile(task);
  await writeFileAtomically(filePath, content);
  clearLookupCaches(locttDir);
}

/**
 * Sentinel `touched` set meaning "this write owns the whole record" —
 * every field is considered touched, so the monotonic check never
 * refuses a shrink. Used by whole-record writers (createTask, restore)
 * whose input is authored fresh, not a preserve-others edit.
 */
export const ALL_FIELDS_TOUCHED: ReadonlySet<string> = new Set(["*"]);


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
    // Tolerant by construction: a body write preserves frontmatter, and
    // a field-local corruption there must not take the whole write down.
    // `health` is threaded to `assembleTaskFile` so degraded/unrecognised
    // fields round-trip untouched (preserve-others).
    const { frontmatter, health } = parseFrontmatter(rawYaml);

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
    const assembled = assembleTaskFile({
      frontmatter: updated,
      body: newBody,
      ...(health.length > 0 ? { health } : {}),
    });
    await writeFileAtomically(filePath, assembled);
    clearLookupCaches(locttDir);
    // Carry the body itself (M3): without it history records *that* the
    // body changed and never *to what*, so nothing can reconstruct a
    // prior version — and the git-sync merge rule (M2) that resolves a
    // contested field by taking the later write depends on being able to.
    // One entry per write (K128): each Save is its own snapshot.
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
  // The token needs only `updated_at` and the body — both survive a
  // field-local corruption — so a wrong-typed due_date must not make the
  // token uncomputable and take the whole task detail down.
  // `parseFrontmatter` is tolerant; object-fatal corruption still throws.
  return tokenFor(parseFrontmatter(rawYaml).frontmatter.updated_at, body);
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
