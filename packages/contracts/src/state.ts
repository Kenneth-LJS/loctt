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
