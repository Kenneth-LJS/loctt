import type { QueriesConfig,QuerySort } from "./query.js";
import type { TaskFrontmatterPublic } from "./task.js";
import type { WorkflowConfig } from "./workflow.js";

/** Request to create a new task. */
export interface CreateTaskRequest {
  readonly title: string;
  /**
   * Optional. When omitted, the server resolves the active project
   * via the default-project resolution order (workspace default,
   * unique-single-project, etc.).
   */
  readonly project?: string;
  readonly status?: string;
  readonly task_type?: string;
  readonly priority?: string;
  readonly parent?: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly reporter?: string;
  readonly start_date?: string;
  readonly due_date?: string;
  readonly estimate?: string;
  readonly milestone?: string;
  // Custom-field payload: shape is determined by workflow config at
  // runtime, so the contract accepts arbitrary values and defers
  // type-checking to core's validation pass.
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/** Request to update task fields. */
export interface UpdateTaskRequest {
  readonly field: string;
  // Value type varies by `field`: enums are strings, dates are
  // strings, custom fields can be any JSON-serializable shape. The
  // service handler validates against the field's config; the
  // contract intentionally stays open.
  readonly value: unknown;
}

/** Request to link/unlink tasks. */
export interface LinkRequest {
  readonly type: string;
  readonly target: string;
}

/** Request to list tasks. */
export interface ListTasksRequest {
  readonly query?: string;
  readonly view?: string;
  readonly sort?: readonly QuerySort[];
  readonly limit?: number;
  /**
   * Structured project filter. Not concatenated into the query
   * string; applied as a post-query equality check on
   * `frontmatter.project`. Ignored when a saved view is in play
   * (views are respected as authored).
   */
  readonly project?: string;
  /**
   * Include archived tasks. When false/omitted, core ANDs
   * `archived != true` onto the effective query (unless the query
   * already mentions `archived`). Drives the list view's "Show
   * archived" toggle.
   */
  readonly includeArchived?: boolean;
}

/**
 * Response shape for `POST /api/tasks/:ref/attachments`. The server
 * confirms which name the upload landed under (post sanitization),
 * the resulting size, whether it overwrote an existing file, and
 * the task's user-facing key so the client can render an updated
 * task view without a second round-trip.
 */
export interface AttachResultResponse {
  readonly name: string;
  readonly size: number;
  readonly overwritten: boolean;
  readonly task_key: string;
}

/** Attachment info for API responses. */
export interface AttachmentResponse {
  readonly name: string;
  readonly size: number;
  /**
   * MIME type derived from the filename extension. Absent when the
   * extension is unknown — consumers should treat that as
   * `application/octet-stream`.
   */
  readonly mime?: string;
}

/**
 * A relationship edge with its target resolved for display.
 *
 * `target` stays the stored ULID; `resolvedKey` is the target's current
 * user-facing key. `missing` marks an edge whose target no longer
 * exists — the id is kept so the UI can say what is dangling rather
 * than dropping the row.
 *
 * Title and status are resolved per request rather than denormalized
 * onto the edge: a copy stored on the edge would go stale the moment
 * the target changed.
 */
export interface ResolvedRelationshipResponse {
  readonly type: string;
  readonly target: string;
  readonly resolvedKey?: string;
  readonly resolvedTitle?: string;
  readonly resolvedStatus?: string;
  readonly missing: boolean;
}

/** Task response for API. */
export interface TaskResponse {
  /**
   * Projected public frontmatter (known keys only). Unknown keys
   * that an author may have written into the task.md frontmatter
   * are preserved on disk but not echoed here — the API shape
   * stays a stable contract.
   */
  readonly frontmatter: TaskFrontmatterPublic;
  readonly body: string;
  /**
   * Opaque token identifying the body state this response was read
   * from (K2). A body write may carry it back as `expectedToken`; the
   * write is then refused with 409 if the task changed in between,
   * rather than silently overwriting a concurrent CLI or MCP edit.
   *
   * Derived server-side by core's `bodyToken` from `updated_at` plus a
   * body digest, so *any* write to the task invalidates it — the
   * conservative direction. A token surviving an unrelated frontmatter
   * change could let a body write through that was composed against
   * different metadata.
   *
   * Autosave is what makes this load-bearing rather than
   * nice-to-have: an explicit Save fires when the user is present and
   * looking, but a 1.5s idle autosave in a background tab would
   * re-post a stale buffer over a CLI edit made minutes ago, unattended
   * — exactly what P1 forbids.
   */
  readonly bodyToken: string;
  readonly attachments: readonly AttachmentResponse[];
  /**
   * Constructs in the body that the WYSIWYG editor cannot represent
   * (B5). Empty when the body is safe to edit visually.
   *
   * Computed server-side so every client applies the same rule. TipTap
   * drops nodes its schema does not recognise, so an editor that opens
   * one of these bodies visually and saves it deletes the content
   * silently — the user sees a successful save and loses a footnote.
   */
  readonly lossyConstructs: readonly LossyConstructResponse[];

  /**
   * Relationship edges with targets resolved to their current key,
   * title and status.
   *
   * `handleGetTask` already built this via `resolveRelationships` and
   * then discarded it, so the documented Relationships panel had no
   * data to render and B14 (each row showing its target's live status)
   * was unbuildable.
   */
  readonly relationships: readonly ResolvedRelationshipResponse[];
}

/** Config response for API. */
export interface ConfigResponse {
  readonly workflow: WorkflowConfig;
  readonly queries: QueriesConfig | null;
}

/**
 * Schema-version status surfaced to the UI so it can render a
 * read-only banner blocking writes when the on-disk schema doesn't
 * match what the running CLI/UI knows.
 *
 * Migration is reachable from every surface: `loctt migrate`, the MCP
 * `migrate_schema` tool, and `POST /api/migrate` behind the banner's
 * confirm flow. It was CLI-only when this comment was first written.
 */
export type SchemaStatusResponse =
  | { readonly kind: "current"; readonly version: number }
  | { readonly kind: "outdated"; readonly on_disk: number; readonly current: number }
  | { readonly kind: "future"; readonly on_disk: number; readonly current: number }
  | { readonly kind: "missing" }
  /**
   * A `.schema-migration-in-progress` sentinel is present: a previous
   * migration crashed part-way and the tracker may be half-rewritten.
   *
   * A distinct kind rather than a flavour of `unknown`, because
   * XS-37 requires a distinct *screen*: this is the one schema state
   * where no in-app action is safe, and where the user needs the
   * recorded backup path to recover at all. The three fields are the
   * sentinel's own contents; any may be absent if the sentinel is
   * unreadable, which is itself worth showing rather than hiding.
   */
  | {
      readonly kind: "interrupted";
      readonly from?: number;
      readonly to?: number;
      readonly backup?: string;
      readonly sentinel_path: string;
    }
  | { readonly kind: "unknown"; readonly message: string };

/** Tracker info response for API. */
export interface TrackerInfoResponse {
  readonly exists: boolean;
  readonly taskCount: number;
  readonly keyPrefix: string | null;
  readonly nextKey: string | null;
  readonly schemaStatus: SchemaStatusResponse;
  /**
   * Display-only label for the workspace the server is serving, shown
   * in the sidebar footer so the user can see which tracker they're
   * looking at. Deliberately NOT a raw absolute path: paths under the
   * user's home dir collapse to `~/…` and others to their last
   * segments, so the response never leaks the full server filesystem
   * layout. Informational — never used to drive a filesystem operation.
   */
  readonly cwd: string;
  /**
   * Today's date (`YYYY-MM-DD`) in the **workspace** timezone from
   * calendar.yaml, resolved server-side.
   *
   * The browser can't read calendar.yaml, and its own clock answers in
   * the viewer's local zone — which would make "Overdue" mean
   * something different per machine and disagree with the same query
   * run through the CLI. Sent here so every surface shares one
   * definition of today.
   *
   * A long-lived tab will see this go stale at workspace midnight; it
   * refreshes whenever tracker info is refetched.
   */
  readonly today: string;
}

/**
 * One entry in `GET /api/recents` — a recently-viewed task resolved
 * to enough frontmatter for the sidebar's "Recently viewed" group to
 * render a key + title link, plus the `at` timestamp the recents file
 * recorded. Entries whose task has since been deleted are dropped
 * server-side, so every entry here resolves to a live task.
 */
export interface RecentTaskResponse {
  readonly key: string;
  readonly title: string;
  readonly project?: string;
  /** ISO timestamp the task was last viewed (from the recents file). */
  readonly at: string;
}

/** Doctor check response for API. */
export interface DoctorCheckResponse {
  readonly name: string;
  readonly status: "ok" | "warn" | "error";
  readonly message: string;
}

/**
 * Result of a bulk operation.
 *
 * Partial success is the normal outcome, not an exception — one bad
 * ref does not abort the batch. `succeeded` and `failed` are reported
 * separately so a UI can retain exactly the failures for retry
 * (ERR-13) rather than clearing the whole selection.
 *
 * `bulk_op_id` is shared by every history entry the operation
 * produced, so an activity feed can group them as one action.
 */
export interface BulkResponse {
  readonly bulk_op_id: string;
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly taskId: string; readonly error: string }[];
  /**
   * Key changes, on the routes that cause them. Move rekeys a task, and
   * BLK-9 requires the result to *name the new keys* rather than state a
   * count — a user who just moved four tasks cannot find them again from
   * "4 tasks moved", because the keys they knew no longer exist.
   *
   * `old_key === new_key` marks a task already in the destination:
   * BLK-26 makes that a no-op success rather than a rekey, so it must
   * not consume a key number.
   *
   * Absent on routes that do not rekey.
   */
  /**
   * Tasks that were already in the requested state — an archive of a
   * task that is archived. A success, but not a change (BLK-27).
   */
  readonly unchanged?: readonly string[];
  readonly moved?: readonly {
    readonly taskId: string;
    readonly old_key: string;
    readonly new_key: string;
  }[];
}

/** One migration step in a plan or result. */
export interface MigrationStepResponse {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  /** True when the step is non-trivially destructive. */
  readonly risky?: boolean;
}

/**
 * `GET /api/migrate/plan` — what a migration would do, without doing
 * it.
 *
 * Exists so the UI can show preview-then-confirm rather than a bare
 * button: migration rewrites task frontmatter across the whole
 * tracker, and `steps` is where a `risky` step becomes visible before
 * the user commits.
 */
export interface MigrationPlanResponse {
  readonly from: number;
  readonly to: number;
  readonly steps: readonly MigrationStepResponse[];
  /** Number of task files the migration would rewrite. */
  readonly taskCount: number;
}

/** `POST /api/migrate` — what a migration actually did. */
export interface MigrateResponse {
  readonly from: number;
  readonly to: number;
  readonly steps: readonly MigrationStepResponse[];
  /**
   * Where the pre-migration backup was written. Absent only when no
   * steps ran (already current). The framework never deletes backups,
   * so this is the user's rollback path.
   */
  readonly backupPath?: string;
}


/** A body construct the visual editor cannot represent (B5). */
export interface LossyConstructResponse {
  readonly kind: "footnote" | "raw_html";
  /** 1-based line number. */
  readonly line: number;
  readonly excerpt: string;
}

/** A comment as returned by the API. */
export interface CommentResponse {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at?: string;
  readonly edited?: true;
  readonly mentions?: readonly string[];
  /**
   * Users other than `author` who have edited this comment. Anyone may
   * edit anyone's comment — LocTT has no roles — so this is the
   * provenance trail rather than a permission record. Renderers show
   * the author primarily and these as "Edited by X".
   */
  readonly editors?: readonly string[];
}

/**
 * What the user's data looks like after a failed request.
 *
 * `flow-error-handling.md` ERR-18 requires every write-path failure to
 * make this claim explicitly: a user who cannot tell whether their edit
 * landed has to go and check the file, and one who assumes wrongly walks
 * away having lost work. `unknown` is a legitimate answer — ERR-4 asks
 * for it by name when a request is cut off mid-flight — but silence is
 * not.
 */
export type ErrorDataState = "saved" | "not_saved" | "unknown";

/** How the user can recover, rendered as a control rather than prose (ERR-15). */
export type ErrorRecoveryKind = "retry" | "reload" | "command" | "none";

export interface ErrorRecovery {
  readonly kind: ErrorRecoveryKind;
  /**
   * For `command`: the exact shell command to run, e.g. `loctt migrate`.
   * Rendered copyable, because the user has to retype it into a terminal.
   */
  readonly command?: string;
}

/** One item's failure within a partially-successful operation (ERR-13). */
export interface ErrorItemFailure {
  /** The user-facing key (`T-12`), never the ULID — ERR-16. */
  readonly ref: string;
  readonly message: string;
}

/**
 * The API's error envelope.
 *
 * A bare `{error: string}` cannot satisfy P4: the UI has to know *where*
 * to render a failure (ERR-14 puts field errors at the field), *what to
 * tell the user about their data* (ERR-18), and *what control to offer*
 * (ERR-15) — none of which survive being flattened into prose.
 *
 * `message` is the headline and is written for the user: no ZodError, no
 * ENOENT, no stack traces (ERR-16). `detail` carries the technical text
 * for a "Show details" affordance, which is where such things are
 * allowed to appear.
 */
export interface ErrorResponse {
  /**
   * Stable machine-readable cause. The UI branches on this rather than
   * matching message text, so copy can be reworded without breaking
   * behaviour.
   */
  readonly code: ErrorCode;
  /** User-facing headline: what failed and why, in the user's terms. */
  readonly message: string;
  /**
   * The field the failure belongs to, when it belongs to one — so the UI
   * can render it at the input rather than only in a toast (ERR-14).
   */
  readonly field?: string;
  /** Present on write paths. Omitted on reads, where nothing was at stake. */
  readonly data_state?: ErrorDataState;
  readonly recovery?: ErrorRecovery;
  /** Per-item failures, so a bulk result can name each one (ERR-13). */
  readonly failures?: readonly ErrorItemFailure[];
  /** Technical detail for a "Show details" affordance — never the headline. */
  readonly detail?: string;
  /**
   * Present on a `schema_mismatch`: which of the four schema states
   * the tracker is in.
   *
   * The boot guard refuses `/api/info` along with everything else, so
   * the surface cannot read the status from the payload it just
   * blocked — and each state has a different remedy, which P4 forbids
   * collapsing into one generic message. Carried here so the client
   * branches on a kind rather than on the message text.
   */
  readonly schema_status?: SchemaStatusResponse;
}

/**
 * Error causes the UI branches on.
 *
 * `unknown` is the P4 exception: permitted only when the cause genuinely
 * cannot be determined, and still required to carry `data_state` and a
 * recovery. If it shows up on a routine path that is a bug in the error
 * handling, not an acceptable outcome.
 */
export type ErrorCode =
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "archived_reference"
  | "config_invalid"
  | "schema_mismatch"
  | "git_failed"
  | "io_failed"
  | "partial_failure"
  | "unknown";
