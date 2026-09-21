import type { QueriesConfig,QuerySort } from "./query.js";
import type { FieldHealthKind, TaskFrontmatterPublic } from "./task.js";
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
  /**
   * GIT-19 precondition. The stable ULID the client believes it is
   * editing. Optional: when present, the web service refuses (409
   * `conflict`, nothing written) if the ref resolves to a different
   * task — the wrong-task write a rekey can otherwise cause. Omitted by
   * the CLI/MCP and any resolve-by-ref caller, which keep last-write-wins.
   */
  readonly expectedId?: string;
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
  /**
   * The target is corrupt, as distinct from missing (S4 / corruption
   * sweep). `missing` conflated three cases; this splits corruption out:
   *
   *   - `missing:false`, `targetCorrupt` absent — resolved & healthy.
   *   - `missing:false`, `targetCorrupt:true` — the tolerant read loaded
   *     the target but it carries `health` findings (e.g. a wrong-typed
   *     title). The row links (the task opens) and keeps its key/title,
   *     but is marked as needing attention.
   *   - `missing:true`, `targetCorrupt:true` — on disk but object-fatally
   *     unreadable (bad id/key, YAML syntax error). Corrupt, not deleted.
   *   - `missing:true`, `targetCorrupt` absent — genuinely absent (no
   *     task directory): the dangling/deleted link REL-24 renders.
   *
   * Omitted (not `false`) on the healthy path so a client that ignores
   * it behaves as before.
   */
  readonly targetCorrupt?: boolean;
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
   * Why `attachments` is empty, when it is empty *because the
   * directory could not be read* rather than because there is nothing
   * in it (REL-49).
   *
   * Absent on both common paths — no attachments, or attachments that
   * read fine — so a client that ignores it behaves as before. A
   * client that renders it can degrade the section while the rest of
   * the task stands, which is what the case asks for.
   */
  readonly attachmentsError?: string;
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

  /**
   * Field-level health findings for this task (proposal § 4.5). Absent
   * when the task is clean. Present so the detail view can render a
   * degraded field with its stored value (`rawText`) and offer repair,
   * instead of the whole task being unopenable.
   *
   * `raw` is deliberately omitted from the wire — `rawText` is the
   * one-line display form the client needs, and `raw` can be an
   * arbitrary object the client never inspects (§ 4.5, review N3: one
   * answer for every surface).
   */
  readonly health?: readonly {
    readonly field: string;
    readonly kind: FieldHealthKind;
    readonly rawText: string;
    readonly error: string;
    readonly repair: "set" | "remove" | "set_or_remove";
  }[];
}

/**
 * `GET /api/workflow/usage` — how many tasks reference each workflow
 * key, plus the absolute path of the file the panels reflect.
 *
 * SET-17 and SET-19 need the count **before** a delete is confirmed;
 * SET-3 wants the absolute path shown, so a user editing YAML by hand
 * knows which file the panel is a lens onto. Both come from the same
 * read of the tracker, so they ride one response rather than making
 * the panel issue two requests that could disagree.
 *
 * Keys absent from a table have a count of zero — the tables are
 * sparse, built from what tasks actually hold, so they also carry
 * keys that are NOT in `workflow.yaml` (SET-18 drift).
 */
export interface WorkflowUsageResponse {
  readonly path: string;
  readonly statuses: Readonly<Record<string, number>>;
  readonly priorities: Readonly<Record<string, number>>;
  readonly task_types: Readonly<Record<string, number>>;
  readonly relationships: Readonly<Record<string, number>>;
  /** Field key → value key → task count (enum values only). */
  readonly custom_field_values: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * Field key → count of tasks holding any value for the field, whatever
   * its type. This is the blast radius of a whole-field delete: a number
   * or boolean field has no enum values, so `custom_field_values` sums to
   * zero for it even when tasks store data under it.
   */
  readonly custom_fields: Readonly<Record<string, number>>;
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
/**
 * Whether a `.loctt/` directory is usable, and if not, why.
 *
 *  - `ready`: core files all present; normal operation.
 *  - `absent`: no `.loctt/` at all.
 *  - `empty`: `.loctt/` exists but holds no core files and no tasks —
 *    a leftover shell. Safe to initialize into.
 *  - `damaged`: core files missing but tasks or config survive.
 *    Initializing over this would destroy data.
 *
 * Mirrors core's `InitState`, the way `SchemaStatusResponse` mirrors
 * `SchemaStatus`: contracts is the lower layer and cannot import core.
 */
export type InitState = "ready" | "absent" | "empty" | "damaged";

export interface TrackerInfoResponse {
  readonly exists: boolean;
  /**
   * Whether the tracker is usable, and if not, why — `ready`,
   * `absent`, `empty`, or `damaged`.
   *
   * `exists` is set from the `.loctt/` directory being *present*, so
   * it cannot tell an empty shell from a tracker full of tasks whose
   * `.schema-version` went missing. ONB-16 needs the first offered the
   * init wizard; SET-30 needs the second never offered it. Any client
   * decision about offering initialization reads this, not `exists`.
   */
  readonly initState: InitState;
  readonly taskCount: number;
  readonly keyPrefix: string | null;
  readonly nextKey: string | null;
  readonly schemaStatus: SchemaStatusResponse;
  /**
   * A prefix rename that was interrupted and has since been completed
   * by the server, reported once so the user learns their keys changed
   * (K16, PRU-46).
   *
   * Present only on the response that performed the recovery. The
   * server finishes an interrupted rename ahead of every handler, so
   * there is no mid-rename state to expose and nothing for the user to
   * do — this is a notice, not a prompt. Absent on every subsequent
   * request.
   */
  readonly completedPrefixRename?: {
    readonly from: string;
    readonly to: string;
    readonly renamed: number;
  };
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
   * Display name of the user init would create, derived server-side
   * from `$USER` (falling back to `$USERNAME`, then `you`).
   *
   * Sent so the init wizard can *name* the identity it is about to
   * create (ONB-5) rather than describing it in the abstract. The
   * fallback is applied here rather than left to the client, because
   * ONB-21 requires the note never render an empty name or
   * `undefined` when the environment has neither variable — and a
   * client-side fallback would be a second, drifting copy of the rule
   * core already applies when it actually creates the user.
   */
  readonly defaultUserName: string;
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
  /**
   * The IANA zone `today` was resolved in — the workspace's
   * `calendar.yaml` timezone, or `"UTC"` when there is no config or it
   * could not be read.
   *
   * VUE-19 requires the resolved date to be *discoverable*: "the UI
   * states the resolved date (and which timezone it used) rather than
   * leaving an off-by-one-day result unexplained". `today` alone
   * cannot satisfy that — a user seeing a date one day off the one on
   * their wall clock needs to know which zone produced it before they
   * can tell a bug from a correctly-configured workspace.
   */
  readonly timezone: string;
  /**
   * XS-50: present when the tracker's directory sits on a filesystem
   * where POSIX advisory locks are unreliable (iCloud Drive, Dropbox,
   * OneDrive, NFS, SMB). Computed best-effort at `loctt ui` boot for
   * **any** tracker — independent of whether git sync is enabled — because
   * the concurrency hazard the advisory names is a property of the
   * filesystem, not of git. Absent means a local disk or a class the probe
   * could not determine (no false warning). Mirrors core's
   * `SyncFsAdvisory`. Informational and non-blocking; the client surfaces
   * it as a dismissible boot banner naming the class and the `cwd`.
   */
  readonly fstypeAdvisory?: {
    readonly fsClass: string;
    readonly label: string;
    readonly message: string;
  };
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
  /**
   * The programmatic repair for this finding, when one exists — mirrors
   * core's `DiagnosticCheck.fix` (K-diagnostics-repair). The Diagnostics
   * panel gates its repair buttons on this rather than parsing `message`.
   */
  readonly fix?: "rebuild-index" | "restore-missing";
}

/** Response for `POST /api/doctor/repair`. */
export interface DoctorRepairResponse {
  readonly action: "rebuild-index" | "restore-missing";
  /** rebuild-index: the number of key-index entries after the rebuild. */
  readonly entries?: number;
  /** restore-missing: the number of files recreated. */
  readonly created?: number;
}

/**
 * Response for `GET /api/integrity` — a tiny, FIXED-SIZE count of the
 * tracker's data-integrity problems for the global integrity badge
 * (DEG-31). Never a list: `total === 0` means clean, and any other number
 * is the count the badge shows and Diagnostics explains. Computed cheaply
 * (one shared task load + the config `broken` counts), never a full doctor
 * run per page load. Mirrors core's `IntegritySummary`.
 */
export interface IntegritySummaryResponse {
  readonly ok: boolean;
  readonly counts: {
    readonly tasks: number;
    readonly config: number;
  };
  readonly total: number;
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
  /**
   * Present on `reconcile_needed` (GIT-6, GIT-15): the full per-field
   * conflict plan, so the panel renders rows without a second fetch.
   * Typed as `ReconcilePlan` at the call site; kept `unknown` here to
   * avoid service.ts importing reconcile.ts.
   */
  readonly reconcile?: unknown;
  /**
   * Present on `reconcile_in_progress` (GIT-18, GIT-31): the sentinel
   * state (mode, commits, started_at) so the block can name what is in
   * flight.
   */
  readonly reconcile_state?: unknown;
  /**
   * Present on `history_rewritten` (GIT-21, K93): the last-synced base the
   * remote head no longer contains, the current remote head, the branch,
   * and the remote name (or null). Carried so the panel can name the
   * rewritten branch and the missing commit without a second fetch — the
   * refusal is `recovery: none`, and recovery is the user's, done in git.
   */
  readonly history_rewritten?: {
    readonly missing_commit: string;
    readonly remote_head: string;
    readonly branch: string;
    readonly remote: string | null;
  };
  /**
   * Present on `schema_remote_newer` (GIT-35, K94): the branch was written
   * by a newer LocTT than this build understands. Carries the branch's
   * `.schema-version` and this build's `CURRENT_SCHEMA_VERSION` so the
   * panel can name both without a second fetch. The refusal is
   * `recovery: none`; the fix is to upgrade LocTT (not migrate). A
   * malformed remote version surfaces as `remote_version: null` — unknown,
   * treated as ahead.
   */
  readonly schema_remote_newer?: {
    readonly remote_version: number | null;
    readonly local_version: number;
    readonly branch: string;
  };
  /**
   * Present on `rekey_needed` (GIT-8, K92): a divergent sync merged, but two
   * tasks now share a key and one must be renumbered. Carries the
   * {@link RekeyPlan} preview (keeper vs loser, both timestamps, both ULIDs,
   * the tiebreak, the planned new key) so the panel shows it and waits for a
   * confirm before the rekey is applied. Typed as `RekeyPlan` at the call
   * site; kept `unknown` here to avoid service.ts importing reconcile.ts.
   */
  readonly rekey?: unknown;
  /**
   * Present on `git_worktree_missing` (GIT-36): LocTT's temporary
   * publish/sync worktree is registered by git but its directory is gone
   * and could not be re-created. Carries the worktree path and which
   * operation hit it so the panel names the exact worktree and offers the
   * repair path without a second fetch. The refusal is `recovery: none`
   * (the repair is a deliberate git/CLI step, not a retry) and
   * `data_state: not_saved` — the operation never reached a local write.
   */
  readonly worktree_missing?: {
    readonly worktree: string;
    readonly operation: "publish" | "sync";
  };
  /**
   * Present on `branch_adopt_needed` (GIT-25): enable found a `loctt`
   * branch that already exists and was written by LocTT (a previous
   * setup), and the request did not confirm adopting it. Carries the
   * branch and its head commit so the panel can state the branch was
   * found and show the head before offering adopt-or-stop, without a
   * second fetch. `data_state: not_saved` — nothing was written; the
   * user re-enables with adopt confirmed to proceed.
   */
  readonly branch_adopt_needed?: {
    readonly branch: string;
    readonly branch_head: string;
  };
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
  | "reconcile_needed"
  | "reconcile_in_progress"
  | "sync_needed"
  | "history_rewritten"
  | "schema_remote_newer"
  | "rekey_needed"
  | "git_worktree_missing"
  | "branch_adopt_needed"
  | "io_failed"
  | "partial_failure"
  | "unknown";
