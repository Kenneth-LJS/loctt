import type { QueriesConfig,QuerySort } from "./query.js";
import type { TaskFrontmatter } from "./task.js";
import type { WorkflowConfig } from "./workflow.js";

/** Request to create a new task. */
export interface CreateTaskRequest {
  readonly title: string;
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
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/** Request to update task fields. */
export interface UpdateTaskRequest {
  readonly field: string;
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
}

/** Attachment info for API responses. */
export interface AttachmentResponse {
  readonly name: string;
  readonly size: number;
}

/** Task response for API. */
export interface TaskResponse {
  readonly frontmatter: TaskFrontmatter;
  readonly body: string;
  readonly attachments: readonly AttachmentResponse[];
}

/** Config response for API. */
export interface ConfigResponse {
  readonly workflow: WorkflowConfig;
  readonly queries: QueriesConfig | null;
}

/** Tracker info response for API. */
export interface TrackerInfoResponse {
  readonly exists: boolean;
  readonly taskCount: number;
  readonly keyPrefix: string | null;
  readonly nextKey: string | null;
}

/** Doctor check response for API. */
export interface DoctorCheckResponse {
  readonly name: string;
  readonly status: "ok" | "warn" | "error";
  readonly message: string;
}
