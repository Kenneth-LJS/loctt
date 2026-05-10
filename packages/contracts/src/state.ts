/** Key allocation state for a single entity type. */
export interface KeyAllocationState {
  readonly prefix: string;
  readonly next_number: number;
}

/** The full state.yaml shape. */
export interface LocttState {
  readonly keys: Readonly<Record<string, KeyAllocationState>>;
  /**
   * Counters for projects that were deleted. Preserved so that
   * re-creating a project with the same key resumes numbering from
   * where it left off, avoiding key collisions with surviving tasks
   * that still carry the old keys (e.g. via `key_history`).
   *
   * Keyed by the original project key. Entries are restored back
   * into `keys` on createProject when a matching key is requested.
   */
  readonly retired_keys?: Readonly<Record<string, KeyAllocationState>>;
}

/** Local sync metadata from .loctt/local/sync.yaml. */
export interface SyncState {
  readonly git: {
    readonly enabled: boolean;
    readonly branch: string;
    readonly remote: string;
    readonly auto_push: boolean;
    readonly auto_fetch: boolean;
    readonly last_synced_commit?: string;
  };
}

export const DEFAULT_GIT_BRANCH = "loctt";
export const DEFAULT_GIT_REMOTE = "origin";
export const DEFAULT_GIT_AUTO_PUSH = true;
export const DEFAULT_GIT_AUTO_FETCH = true;

/** Reconciliation metadata from .loctt/local/reconcile.yaml. */
export interface ReconcileState {
  readonly mode: "publish" | "sync";
  readonly base_commit: string;
  readonly remote_commit: string;
  readonly started_at: string;
}
