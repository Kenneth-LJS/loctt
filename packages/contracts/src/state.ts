/** Key allocation state for a single entity type. */
export interface KeyAllocationState {
  readonly prefix: string;
  readonly next_number: number;
}

/** The full state.yaml shape. */
export interface LocttState {
  readonly keys: Readonly<Record<string, KeyAllocationState>>;
}

/** Local sync metadata from .loctt/local/sync.yaml. */
export interface SyncState {
  readonly git: {
    readonly enabled: boolean;
    readonly branch: string;
    readonly last_synced_commit?: string;
  };
}

/** Reconciliation metadata from .loctt/local/reconcile.yaml. */
export interface ReconcileState {
  readonly mode: "publish" | "sync";
  readonly base_commit: string;
  readonly remote_commit: string;
  readonly started_at: string;
}
