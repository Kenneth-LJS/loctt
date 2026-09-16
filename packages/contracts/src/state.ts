import { z } from "zod";

/** Key allocation state for a single entity type. */
export const KeyAllocationStateSchema = z.object({
  prefix: z.string().min(1),
  next_number: z.number().int().min(1),
}).strict();
export type KeyAllocationState = z.infer<typeof KeyAllocationStateSchema>;

/**
 * The full state.yaml shape.
 *
 * `retired_keys` holds counters for deleted projects. Re-creating
 * a project with the same key restores numbering from where it
 * left off, avoiding key collisions with surviving tasks that
 * still reference the old keys (e.g. via `key_history`).
 */
export const LocttStateSchema = z.object({
  keys: z.record(z.string(), KeyAllocationStateSchema),
  retired_keys: z.record(z.string(), KeyAllocationStateSchema).optional(),
}).strict();
export type LocttState = z.infer<typeof LocttStateSchema>;

/** Local sync metadata from .loctt/local/sync.yaml. */
export const SyncStateSchema = z.object({
  git: z.object({
    enabled: z.boolean(),
    branch: z.string().min(1),
    remote: z.string().min(1),
    auto_push: z.boolean(),
    auto_fetch: z.boolean(),
    last_synced_commit: z.string().optional(),
  }).strict(),
}).strict();
export type SyncState = z.infer<typeof SyncStateSchema>;

export const DEFAULT_GIT_BRANCH = "loctt";
export const DEFAULT_GIT_REMOTE = "origin";
export const DEFAULT_GIT_AUTO_PUSH = true;
export const DEFAULT_GIT_AUTO_FETCH = true;

/** Reconciliation metadata from .loctt/local/reconcile.yaml. */
export const ReconcileStateSchema = z.object({
  mode: z.enum(["publish", "sync"]),
  base_commit: z.string().min(1),
  remote_commit: z.string().min(1),
  started_at: z.string().min(1),
  /**
   * Per-field decisions the user has made so far (GIT-6/GIT-7). Persisted
   * as they are made so the panel survives navigation, reload and a
   * browser restart (GIT-26), and so a partial Apply is resumable
   * (GIT-32). Each entry is `{ taskId, field, choice, value? }`.
   *
   * Kept structural (not the imported `ReconcileDecisionSchema`) so
   * state.ts has no dependency on reconcile.ts; the reconcile module
   * validates the richer shape where it is used.
   */
  decisions: z
    .array(
      z.object({
        taskId: z.string().min(1),
        field: z.string().min(1),
        choice: z.enum(["local", "remote", "value"]),
        value: z.unknown().optional(),
      }).strict(),
    )
    .optional(),
  /**
   * Task ids whose resolution was already written to disk (GIT-32). On a
   * partial Apply the sentinel is NOT cleared; reopening shows only the
   * rows for tasks absent from this list, and a retry re-applies only
   * those (GIT-37).
   */
  applied: z.array(z.string().min(1)).optional(),
  /**
   * Set once the merge/copy phase has applied and a key-collision rekey is
   * pending the user's confirm (GIT-8/K92). The rekey renumbers a task, so
   * unlike the auto-merge cases it waits for an explicit confirm; the web
   * UI shows the preview and the loser's key is not reissued until then.
   * The plan itself is NOT stored — it is recomputed from disk (the copies
   * are already applied) so a reload cannot drift from it (GIT-26). Absent
   * on a reconciliation that has no rekey step.
   */
  rekey_pending: z.boolean().optional(),
}).strict();
export type ReconcileState = z.infer<typeof ReconcileStateSchema>;

/**
 * Sentinel written while a project's key prefix is being changed.
 *
 * The rewrite spans `projects.yaml`, `state.yaml`, every task in the
 * project, and the key index — far more than one atomic write can cover.
 * The state lock is released when the process exits, so it cannot
 * protect a crash partway: without this file the tracker would be left
 * with some tasks on the old prefix and some on the new, and nothing to
 * say a rename was ever in flight.
 *
 * Present only mid-rename. Its existence means "finish me", and doing so
 * is idempotent — a task already carrying `to` is skipped.
 */
export const PrefixRenameStateSchema = z.object({
  project_id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  started_at: z.string().min(1),
}).strict();
export type PrefixRenameState = z.infer<typeof PrefixRenameStateSchema>;
