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
  readonly attachments: readonly AttachmentResponse[];
}

/** Config response for API. */
export interface ConfigResponse {
  readonly workflow: WorkflowConfig;
  readonly queries: QueriesConfig | null;
}

/**
 * Schema-version status surfaced to the UI so it can render a
 * read-only banner blocking writes when the on-disk schema doesn't
 * match what the running CLI/UI knows. Migration is CLI-only (run
 * `loctt migrate`); the UI surfaces the state but doesn't initiate
 * the migration.
 */
export type SchemaStatusResponse =
  | { readonly kind: "current"; readonly version: number }
  | { readonly kind: "outdated"; readonly on_disk: number; readonly current: number }
  | { readonly kind: "future"; readonly on_disk: number; readonly current: number }
  | { readonly kind: "missing" }
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
