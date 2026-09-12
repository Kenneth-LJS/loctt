/**
 * Crash-recovery journal for multi-step writes.
 *
 * The pattern:
 *   1. Inside `withStateLock`, append a journal entry describing the
 *      whole operation (e.g. "remap project A → B across these N
 *      tasks, then drop A from projects.yaml").
 *   2. Apply the per-task writes one by one.
 *   3. Apply the config edit.
 *   4. Remove the journal entry.
 *
 * If the process crashes at any step, the next caller that takes
 * `withStateLock` runs `recoverPendingJournal` first, which replays
 * each pending entry idempotently:
 *   - Re-reads each task and only rewrites the ones still pointing
 *     at the old value.
 *   - Re-applies the config edit only if it's still pending.
 *   - Removes the journal entry once both sides are consistent.
 *
 * The journal lives at `.loctt/local/journal.yaml` (gitignored;
 * recovery is per-machine). YAML encoding for parity with state.yaml
 * and easy human inspection during incident triage.
 */

import { readFile } from "node:fs/promises";

import { WorkflowConfigSchema } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { getJournalPath } from "../paths/index.js";
import { writeTask } from "../task/io.js";
import { lookupById, TaskNotFoundError } from "../task/lookup.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";

/**
 * Field selector for `remap_user` — which task fields to rewrite.
 * Most callers want both, but archive flows may target only one.
 */
const UserFieldSchema = z.enum(["assignee", "reporter"]);

const BaseEntry = {
  id: z.string().min(1),
  started_at: z.string().min(1),
  task_ids: z.array(z.string().min(1)),
};

/**
 * Per-op-kind schemas. `kind` is the discriminator. `task_ids` is
 * the snapshot of affected tasks taken at journal-write time —
 * recovery uses it directly so the replay scope is independent of
 * any later writes (which could themselves change `affected`).
 */
// Note: there is no `config_pending` flag on these schemas. Each
// per-kind recovery handler is required to make its config-edit
// step idempotent (typically by re-reading the config and no-op'ing
// when the entry is already absent), so a flag would be redundant
// — recovery just always retries the edit and the idempotent helper
// short-circuits when there's nothing left to do.

const RemapProjectSchema = z.object({
  ...BaseEntry,
  kind: z.literal("remap_project"),
  from: z.string().min(1),
  /**
   * The target project id, or `null` to CLEAR the field — PRU-17's
   * "clear the project field on these tasks" branch of a hard delete.
   * `project` is optional on a task, so a cleared task has no project
   * (it is not orphaned into an invalid state). Mirrors the milestone /
   * sprint remaps, which already allow `null`.
   */
  to: z.string().min(1).nullable(),
});

const RemapLabelSchema = z.object({
  ...BaseEntry,
  kind: z.literal("remap_label"),
  from: z.string().min(1),
  /** null = remove the label entirely from each task. */
  to: z.string().min(1).nullable(),
});

const RemapMilestoneSchema = z.object({
  ...BaseEntry,
  kind: z.literal("remap_milestone"),
  from: z.string().min(1),
  /** null = clear the field. */
  to: z.string().min(1).nullable(),
});

const RemapSprintSchema = z.object({
  ...BaseEntry,
  kind: z.literal("remap_sprint"),
  from: z.string().min(1),
  /** null = clear the field. */
  to: z.string().min(1).nullable(),
});

const RemapUserSchema = z.object({
  ...BaseEntry,
  kind: z.literal("remap_user"),
  from: z.string().min(1),
  /** null = unassign. */
  to: z.string().min(1).nullable(),
  /** Which task fields to remap; usually both. */
  fields: z.array(UserFieldSchema).min(1),
});

/**
 * Workflow-edit remap directive embedded in `RemapWorkflowSchema`.
 * Mirrors the in-memory `WorkflowRemap` shape used by
 * config/workflow-write.ts; redefined here as a Zod schema so the
 * journal can validate persisted entries on load.
 */
const WorkflowRemapTableSchema = z.record(z.string(), z.string().nullable());
const WorkflowRemapSchema = z.object({
  statuses: WorkflowRemapTableSchema.optional(),
  priorities: WorkflowRemapTableSchema.optional(),
  task_types: WorkflowRemapTableSchema.optional(),
  relationships: WorkflowRemapTableSchema.optional(),
  custom_fields: z.record(z.string(), WorkflowRemapTableSchema).optional(),
});

/**
 * Crash-recovery entry for `applyWorkflowEdit`. Unlike the per-entity
 * remaps above, a workflow edit can touch many fields at once
 * (statuses + priorities + relationship keys + custom-field values)
 * and the affected-task set is "all tasks" — every task is read,
 * each remap applied if needed. Carrying the full target config
 * `next` rather than just a diff lets recovery operate on the
 * (old config, new config) pair regardless of which write step
 * was interrupted: if workflow.yaml hadn't been saved yet, recovery
 * still has the new config to write; if it had, the on-disk config
 * already matches and the task-rewrite pass becomes a no-op.
 */
const RemapWorkflowSchema = z.object({
  id: z.string().min(1),
  started_at: z.string().min(1),
  kind: z.literal("remap_workflow"),
  next: WorkflowConfigSchema,
  remap: WorkflowRemapSchema,
});

/**
 * A multi-file write in flight (V6).
 *
 * Written before the first file is swapped into place and cleared only
 * after the last one lands, so its presence always means "unfinished".
 * Recovery rolls back from the recorded backups — see
 * `staged-swap.ts` for why forward is not an option.
 */
const StagedSwapSchema = z.object({
  id: z.string().min(1),
  started_at: z.string().min(1),
  kind: z.literal("staged_swap"),
  swap: z.object({
    /** Holds both `staged/` and `backup/`; removed on success. */
    base_dir: z.string().min(1),
    files: z.array(z.object({
      dest: z.string().min(1),
      backup: z.string().min(1),
      /**
       * False when the destination did not exist before this op, in
       * which case rolling back means deleting it rather than
       * restoring a backup that was never taken.
       */
      had_original: z.boolean(),
    })),
  }),
});

export const JournalEntrySchema = z.discriminatedUnion("kind", [
  RemapProjectSchema,
  RemapLabelSchema,
  RemapMilestoneSchema,
  RemapSprintSchema,
  RemapUserSchema,
  RemapWorkflowSchema,
  StagedSwapSchema,
]);
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

const JournalSchema = z.object({
  entries: z.array(JournalEntrySchema),
});
export type Journal = z.infer<typeof JournalSchema>;

const EMPTY_JOURNAL: Journal = { entries: [] };

/**
 * Raised when the journal exists and could not be read.
 *
 * The journal is the record of writes already in flight. Treating an
 * unreadable one as empty means recovery never runs and the caller
 * proceeds to write over a half-applied set — the precise failure the
 * journal exists to prevent (P-11).
 */
export class JournalUnreadableError extends Error {
  readonly name = "JournalUnreadableError" as const;
  constructor(path: string, cause: unknown) {
    super(
      `${path} could not be read, so LocTT cannot tell whether a previous `
      + `operation was interrupted. Refusing to continue: proceeding could `
      + `overwrite a half-applied write. `
      + `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/**
 * Loads the journal from disk.
 *
 * An **absent** journal is a real state — nothing has ever been in
 * flight — and returns empty. An **unreadable** or unparseable one
 * throws: it is the record of writes that may be half-applied, and
 * discarding it silently is how a crash becomes permanent corruption.
 *
 * A shape mismatch is treated the same way. The previous behaviour
 * logged and returned empty, which meant a single bad entry threw away
 * every *good* entry beside it.
 */
export async function loadJournal(locttDir: string): Promise<Journal> {
  const path = getJournalPath(locttDir);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_JOURNAL;
    throw new JournalUnreadableError(path, err);
  }
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new JournalUnreadableError(path, err);
  }
  const parsed = JournalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new JournalUnreadableError(
      path,
      new Error(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")),
    );
  }
  return parsed.data;
}

/** Persists the journal atomically. */
export async function saveJournal(locttDir: string, journal: Journal): Promise<void> {
  await writeYamlAtomically(getJournalPath(locttDir), { entries: journal.entries });
}

/**
 * Appends an entry to the journal, returning the updated journal.
 * Caller is responsible for `saveJournal`-ing the result inside
 * the same `withStateLock` body.
 */
export function appendJournalEntry(journal: Journal, entry: JournalEntry): Journal {
  return { entries: [...journal.entries, entry] };
}

/**
 * Removes an entry by id, returning the updated journal. Used by
 * the writer (after the operation completes) and by the recovery
 * path (after replay).
 */
export function removeJournalEntry(journal: Journal, id: string): Journal {
  return { entries: journal.entries.filter(e => e.id !== id) };
}

/**
 * Re-applies a single entry's task remap in place. Idempotent: a
 * task that already shows the new value is skipped, so a recovery
 * replay over a partially-completed loop catches up without
 * double-writing.
 *
 * Tasks that no longer exist (e.g. hand-deleted between the
 * journal write and recovery) are skipped silently — recovery is
 * defensive about state drift.
 *
 * Exported because domain-specific recovery handlers (registered
 * via `registerRecoveryHandler`) call this to do the bulk task
 * rewrite before applying their own config-edit completion.
 *
 * Note on `updated_at`: every actually-changed task gets a fresh
 * timestamp, so a partially-completed loop replayed by recovery
 * leaves a "split" — earlier tasks bear the original happy-path
 * timestamp, the rest bear the recovery-time timestamp. This is
 * intentional: external watchers (file-system or git) need the bump
 * on tasks recovery touched. Treating the entry as one batched
 * update would either lie about when tasks changed or skip the
 * bump on legitimately-changed tasks.
 */
/**
 * Subset of {@link JournalEntry} kinds that carry an explicit
 * `task_ids` snapshot — i.e. every entity-remap kind except the
 * config-level `remap_workflow`. `replayTaskRemap` operates only on
 * these; the workflow handler lives in `config/workflow-write.ts`
 * and walks all tasks for its own remap pass.
 */
// `staged_swap` is excluded alongside `remap_workflow`: neither is a
// per-task field remap, and both have their own recovery path.
export type TaskRemapEntry = Exclude<
  JournalEntry,
  { kind: "remap_workflow" } | { kind: "staged_swap" }
>;

/**
 * What a remap actually managed to do (PRU-34).
 *
 * `remapped` counts tasks this call rewrote. `skipped` counts tasks
 * that needed no change — already at the target value, or no longer
 * present — which is what makes a retry safe to offer: re-running a
 * partially-applied remap moves the stragglers and skips the rest.
 * `failed` names the tasks whose write did not land, **by key** where
 * one could be read, so the caller can tell the user which of their
 * tasks are still on the old value.
 */
export interface TaskRemapResult {
  readonly remapped: number;
  readonly skipped: number;
  readonly failed: readonly { readonly id: string; readonly key: string | undefined;
    readonly reason: string }[];
}

/**
 * Applies a remap entry to its tasks, returning what landed.
 *
 * **A failed task write no longer aborts the remaining tasks.** The
 * loop used to throw out on the first unwritable file, which left the
 * caller with no idea how many of its tasks had already moved — and
 * the user with a half-migrated tracker described only as an error.
 * PRU-34 requires the true split, so each task is attempted and its
 * outcome recorded.
 *
 * A caller that wants the old all-or-nothing behaviour inspects
 * `failed` and throws; `deleteProject` does exactly that, because
 * removing the project from `projects.yaml` while tasks still point
 * at it would strand them.
 */
export async function replayTaskRemap(
  locttDir: string,
  entry: TaskRemapEntry,
): Promise<TaskRemapResult> {
  let remapped = 0;
  let skipped = 0;
  const failed: { id: string; key: string | undefined; reason: string }[] = [];

  for (const taskId of entry.task_ids) {
    let task;
    try {
      task = await lookupById(locttDir, taskId);
    } catch (err) {
      if (err instanceof TaskNotFoundError) { skipped += 1; continue; }
      throw err;
    }
    const fm = task.frontmatter;
    let updated = fm;
    switch (entry.kind) {
      case "remap_project":
        if (fm.project !== entry.from) { skipped += 1; continue; }
        if (entry.to === null) {
          // PRU-17: clear the field. Drop the key so the task surfaces
          // as "no project" (frontmatter.project === undefined), the way
          // the milestone/sprint clears do, rather than an empty string.
          const { project: _drop, ...rest } = fm;
          updated = rest as typeof fm;
        } else {
          updated = { ...fm, project: entry.to };
        }
        break;
      case "remap_label": {
        const labels = fm.labels ?? [];
        if (!labels.includes(entry.from)) { skipped += 1; continue; }
        const to = entry.to;
        const next: string[] = to === null
          ? labels.filter(l => l !== entry.from)
          : labels.map(l => (l === entry.from ? to : l));
        // Dedupe in case `to` was already present.
        const deduped = Array.from(new Set(next));
        if (deduped.length === 0) {
          // Drop the labels key entirely when empty so the
          // serializer doesn't emit `labels: []` (the schema
          // allows it but downstream callers expect "no labels"
          // to surface as `frontmatter.labels === undefined`).
          const { labels: _drop, ...rest } = fm;
          updated = rest as typeof fm;
        } else {
          updated = { ...fm, labels: deduped };
        }
        break;
      }
      case "remap_milestone":
        if (fm.milestone !== entry.from) { skipped += 1; continue; }
        if (entry.to === null) {
          const { milestone: _drop, ...rest } = fm;
          updated = rest as typeof fm;
        } else {
          updated = { ...fm, milestone: entry.to };
        }
        break;
      case "remap_sprint":
        if (fm.sprint !== entry.from) { skipped += 1; continue; }
        if (entry.to === null) {
          const { sprint: _drop, ...rest } = fm;
          updated = rest as typeof fm;
        } else {
          updated = { ...fm, sprint: entry.to };
        }
        break;
      case "remap_user": {
        const next = { ...fm };
        let changed = false;
        for (const field of entry.fields) {
          if (next[field] === entry.from) {
            if (entry.to === null) {
              delete next[field];
            } else {
              next[field] = entry.to;
            }
            changed = true;
          }
        }
        if (!changed) { skipped += 1; continue; }
        updated = next;
        break;
      }
    }
    // Bump updated_at on actually-changed tasks so external watchers
    // know recovery touched them. Don't touch tasks already at the
    // target value (handled by the early-continue paths above).
    const now = new Date().toISOString();
    try {
      await writeTask(locttDir, taskId, {
        ...task,
        frontmatter: { ...updated, updated_at: now },
      });
      remapped += 1;
    } catch (err) {
      // Keep going. The point of this loop is to report the true
      // split, and stopping here would make every task after the
      // first bad file indistinguishable from one that was never
      // reached.
      failed.push({
        id: taskId,
        key: task.frontmatter.key,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { remapped, skipped, failed };
}

/**
 * `replayTaskRemap`, but preserving the pre-2026-09-04 all-or-nothing
 * contract: if any task's write did not land, throw rather than
 * returning the split.
 *
 * `replayTaskRemap` was changed to collect every task's outcome so
 * `deleteProject` could report a partial remap (PRU-34). But the
 * sprint, label, user and milestone deletes call it and then delete
 * their config unconditionally — so with the collecting version a
 * failed task write would be *swallowed*, the config removed, and the
 * journal cleared while tasks still referenced the old value. That is
 * the exact stranding PRU-34 fixed for projects, reintroduced for the
 * other four. This restores the throw for callers that have not opted
 * into the split, so those deletes still abort before touching config.
 *
 * A project delete does NOT use this — it inspects `failed` itself and
 * raises `PartialRemapError` with the real numbers.
 */
export async function replayTaskRemapStrict(
  locttDir: string,
  entry: TaskRemapEntry,
): Promise<void> {
  const result = await replayTaskRemap(locttDir, entry);
  if (result.failed.length > 0) {
    const keys = result.failed.map(f => f.key ?? f.id).join(", ");
    throw new Error(
      `remap could not write ${String(result.failed.length)} task(s) `
      + `(${keys}); config was not changed and can be retried`,
    );
  }
}

/**
 * Recovery handler for one journal entry kind. Receives the entry
 * and is responsible for completing the WHOLE op idempotently:
 *   - Re-apply the task remap (typically by calling
 *     `replayTaskRemap`).
 *   - Re-apply the config edit (e.g. remove the project from
 *     projects.yaml).
 *   - Clear the entry from the journal via `clearJournalEntry`.
 *
 * Each step must be idempotent — recovery may run more than once
 * if the process crashes mid-recovery.
 *
 * Domain modules register their handler at module load via
 * `registerRecoveryHandler`. The journal module stays
 * dependency-free; this indirection breaks what would otherwise be
 * a layering cycle (journal needs to call domain writers; domain
 * writers need to write to the journal).
 */
export type RecoveryHandler = (locttDir: string, entry: JournalEntry) => Promise<void>;

const recoveryHandlers = new Map<JournalEntry["kind"], RecoveryHandler>();

/**
 * Registers a recovery handler for one journal entry kind.
 * Re-registering replaces. Pass `null` to clear (used by tests).
 */
export function registerRecoveryHandler(
  kind: JournalEntry["kind"],
  handler: RecoveryHandler | null,
): void {
  if (handler === null) {
    recoveryHandlers.delete(kind);
  } else {
    recoveryHandlers.set(kind, handler);
  }
}

/**
 * Public hook called by `withStateLock` at the start of every
 * critical section. Reads the journal and dispatches each pending
 * entry to its registered handler. If no handler is registered
 * for a kind (which shouldn't happen at runtime — the manage
 * modules register at load), the entry is skipped and a warning
 * is logged so a human can investigate.
 *
 * If recovery itself crashes, the next caller starts over from a
 * fresh journal load — every handler is required to be
 * idempotent, so partial replays are safe to repeat.
 *
 * Each successful replay logs an info-level audit line so operators
 * can correlate post-crash state changes with the originating
 * interrupted operation.
 *
 * MUST be called inside `withStateLock` so concurrent processes
 * don't race the dispatch + clear-entry steps.
 */
/**
 * In-process set of journal-entry ids we've already logged as
 * "no recovery handler for kind ..." . The recovery hook fires on
 * every `withStateLock` call, so without dedupe a single stranded
 * entry would spam the error log on every mutation for the rest
 * of the process's lifetime. Process-scoped is enough — the
 * stranded entry's id is stable across calls.
 */
const loggedMissingHandlerIds = new Set<string>();

export async function recoverPendingJournal(locttDir: string): Promise<void> {
  const journal = await loadJournal(locttDir);
  if (journal.entries.length === 0) return;

  for (const entry of journal.entries) {
    const handler = recoveryHandlers.get(entry.kind);
    if (!handler) {
      // Escalated to error: a stranded entry means a multi-step
      // write was interrupted and nobody can finish it. The entry
      // sits forever and may leave the tracker in a half-applied
      // state. Surfaced loudly so it's visible in logs/CI rather
      // than buried as a benign warning — but deduped per entry-id
      // so the recovery hook firing on every withStateLock doesn't
      // spam the log.
      if (!loggedMissingHandlerIds.has(entry.id)) {
        loggedMissingHandlerIds.add(entry.id);
        console.error(
          `[loctt] no recovery handler for journal entry kind '${entry.kind}'; ` +
          `entry ${entry.id} (started_at=${entry.started_at}) left in place. ` +
          `This indicates the manage module that owns this kind was not loaded ` +
          `before withStateLock ran — investigate import order.`,
        );
      }
      continue;
    }
    await handler(locttDir, entry);
    // Audit log: a successful replay means we recovered from a crash
    // partway through a multi-step write. Emitting one line per entry
    // gives operators a forensic trail (when, what kind, which id)
    // without spamming the happy path — the loop body only runs when
    // entries are pending.
    console.info(
      `[loctt] journal recovery replayed entry ${entry.id} ` +
      `kind='${entry.kind}' started_at=${entry.started_at}`,
    );
  }
}

/**
 * Convenience for "I'm done with this op, drop its entry."
 * Loads, removes, saves — all in one place so callers don't
 * repeat the read-modify-write boilerplate. Caller is
 * responsible for the surrounding `withStateLock`.
 */
export async function clearJournalEntry(locttDir: string, id: string): Promise<void> {
  const journal = await loadJournal(locttDir);
  const next = removeJournalEntry(journal, id);
  if (next.entries.length === journal.entries.length) return;
  await saveJournal(locttDir, next);
}
