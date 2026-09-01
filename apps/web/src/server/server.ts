import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat as fsLstat, mkdtemp, rm, stat as fsStat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join as pathJoin, normalize as pathNormalize, resolve as pathResolve, sep as pathSep } from "node:path";
import { pipeline } from "node:stream/promises";

import type {
  BulkResponse,
  CommentResponse,
  ConfigResponse,
  CreateTaskRequest,
  DoctorCheckResponse,
  ErrorCode,
  ErrorResponse,
  LinkRequest,
  ListTasksRequest,
  MigrateResponse,
  MigrationPlanResponse,
  PrefixRenameState,
  RecentTaskResponse,
  TaskResponse,
  TrackerInfoResponse,
  UpdateTaskRequest,
  WorkflowUsageResponse,
} from "@loctt/contracts";
import {
  BulkArchiveRequestSchema,
  BulkDeleteRequestSchema,
  BulkLinkRequestSchema,
  BulkMoveRequestSchema,
  BulkSetRequestSchema,
  CalendarConfigSchema,
  CreateViewRequestSchema,
  EditCommentRequestSchema,
  EditViewRequestSchema,
  InitRequestSchema,
  isSortableTaskField,
  ListViewConfigSchema,
  PostCommentRequestSchema,
  projectTaskFrontmatter,
  PutWorkflowRequestSchema,
  ValidateQueryRequestSchema,
} from "@loctt/contracts";
import {
  appendTaskBody,
  applyWorkflowEdit,
  ArchivedReferenceError,
  archiveLabel,
  archiveProject,
  archiveTask,
  archiveUser,
  assertSafeBasename,
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  boardMove,
  bodyToken,
  buildListContext,
  buildMentionResolver,
  buildShowModel,
  bulkArchive,
  bulkDelete,
  bulkLink,
  bulkMoveTasksToProject,
  bulkSetFields,
  BurndownError,
  completeInterruptedPrefixRename,
  computeSchemaStatus,
  computeWorkflowKeyCounts,
  ConfigRouterError,
  countTasksByReferences,
  createLabel,
  createMilestone,
  createProject,
  createSprint,
  createTask,
  createUser,
  createView,
  deleteComment,
  deleteLabel,
  deleteMilestone,
  deleteProject,
  deleteSprint,
  deleteTask,
  deleteUser,
  deleteView,
  detachFile,
  disableGit,
  duplicateTask,
  editComment,
  editLabel,
  editMilestone,
  editProject,
  editSprint,
  editView,
  enableGit,
  exportTasksToCSV,
  exportTasksToJSON,
  filterForExport,
  findLossyConstructs,
  findProjectBySlug,
  FsAccessError,
  getAttachmentPath,
  getCurrentUser,
  getGitStatus,
  getTrackerInfo,
  getWorkflowConfigPath,
  GitConflictError,
  initLoctt,
  isMalformedHistoryEntry,
  LabelError,
  linkTask,
  listComments,
  listTasks,
  loadAllTasks,
  loadAllTasksDetailed,
  loadAllUsers,
  loadArchivedGuardConfigs,
  loadCalendarConfig,
  loadLabelsConfig,
  loadListViewConfig,
  loadMilestonesConfig,
  loadOptionalConfigs,
  loadProjectsConfig,
  loadQueriesConfig,
  loadSprintsConfig,
  loadState,
  loadUserSettings,
  loadWorkflowConfig,
  LocttError,
  lookupById,
  lookupTask,
  MAX_AVATAR_BYTES,
  migrateToCurrent,
  MilestoneError,
  milestoneProgress,
  ParseError,
  parseQuery,
  planMigration,
  postComment,
  type Progress,
  ProjectError,
  publish,
  pushRecent,
  QueriesConfigError,
  QueryValidationError,
  readBurndownSeries,
  readHistoryRows,
  readPrefixRenameState,
  readRecents,
  recoverInterruptedPrefixRename,
  reorderBoardRank,
  ReorderError,
  reorderRelationship,
  requireSupportedSchema,
  resolveLocttDir,
  resolveProjectIdForUser,
  resolveUserRef,
  runDoctor,
  saveCalendarConfig,
  saveListViewConfig,
  saveState,
  saveUserSettings,
  SchemaTooNewError,
  SchemaUnmigratableError,
  SchemaVersionError,
  setConfigValue,
  setDefaultProject,
  setField,
  setFields,
  setProjectPrefix,
  SprintError,
  sprintProgress,
  StaleBodyWriteError,
  switchCurrentUser,
  sync,
  TaskNotFoundError,
  type TaskReferenceKind,
  TaskUpdateError,
  todayInZone,
  tokenize,
  TokenizeError,
  unarchiveLabel,
  unarchiveProject,
  unarchiveTask,
  unarchiveUser,
  unarchiveView,
  unlinkTask,
  unsetConfigValue,
  unsetField,
  updateUser,
  UserError,
  validateQuery,
  validHistory,
  ViewError,
  withStateLock,
  writeTaskBody,
} from "@loctt/core";
import { ZodError } from "zod";

import { contentDispositionAttachment } from "./content-disposition.js";
import type { ParsedFilePart } from "./multipart.js";
import { parseMultipartFile } from "./multipart.js";

const DEFAULT_PORT = 4321;

/**
 * Today's date (`YYYY-MM-DD`) in the workspace timezone from
 * calendar.yaml. Falls back to UTC when the config is missing or
 * unreadable, matching `loadCalendarConfig`'s own default.
 */
/**
 * `today` together with the zone that produced it (VUE-19).
 *
 * Split out rather than resolving the zone a second time at the call
 * site: reading `calendar.yaml` twice could straddle workspace
 * midnight and report a date and a zone that never went together.
 */
async function workspaceTodayWithZone(
  locttDir: string,
): Promise<{ today: string; timezone: string }> {
  try {
    const { timezone } = await loadCalendarConfig(locttDir);
    return { today: todayInZone(timezone), timezone };
  } catch {
    // Matches `loadCalendarConfig`'s own default, and is what
    // `todayInZone()` with no argument resolves in.
    return { today: todayInZone(), timezone: "UTC" };
  }
}

/**
 * Renders a workspace root for *display* in the UI footer without
 * leaking a raw absolute server path into the API response. Paths
 * under the user's home dir collapse to a `~/…`-prefixed form (what
 * the mockup shows); anything outside home is reduced to its last two
 * path segments with a leading `…/` to signal the truncation. Either
 * way the result never starts with `/`, so it can't be mistaken for —
 * or used as — an absolute filesystem path by a client.
 */
function displayPath(absPath: string): string {
  const home = homedir();
  if (home && (absPath === home || absPath.startsWith(home + pathSep))) {
    const rest = absPath.slice(home.length).replace(/^[/\\]/, "");
    return rest.length > 0 ? `~${pathSep}${rest}` : "~";
  }
  const segments = absPath.split(/[/\\]+/).filter(Boolean);
  if (segments.length === 0) return absPath.replace(/^[/\\]+/, "");
  const tail = segments.slice(-2).join(pathSep);
  return segments.length > 2 ? `…${pathSep}${tail}` : tail;
}

async function trackerDirExists(locttDir: string): Promise<boolean> {
  try {
    const s = await fsStat(locttDir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Thrown when an incoming request body exceeds the configured byte
 * cap. Surfaces to the top-level handler as HTTP 413 so clients
 * can distinguish "too big" from a generic 500.
 */
class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

async function readBody(req: import("node:http").IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let aborted = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        // Stop accumulating but DON'T destroy the socket here — the
        // top-level handler still needs to write a 413 response
        // through it. We `pause` so further data chunks don't
        // accumulate, drain the request to its end event, then
        // reject. The handler writes the 413, and the response
        // close cleans up the socket.
        aborted = true;
        chunks.length = 0;
        req.pause();
        reject(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}

function json(res: import("node:http").ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Last-resort cause for a status code.
 *
 * A **guess**, and only correct by coincidence: an archived-reference
 * rejection arrives as a 400 and becomes `validation_failed`, which is
 * indistinguishable from a bad enum value even though the recovery is
 * entirely different — unarchive the entity, versus pick a valid value.
 *
 * Since V1, core states its own cause and `errorFromThrown` reads it.
 * This remains for the ~100 call sites that pass a bare string, where a
 * status-shaped guess still beats defaulting everything to `unknown` —
 * P4 reserves that for causes that genuinely cannot be determined, and
 * a UI seeing it on a routine 404 learns nothing.
 */
function codeForStatus(status: number): ErrorCode {
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation_failed";
  if (status >= 500) return "io_failed";
  return "unknown";
}

/**
 * Writes the API error envelope.
 *
 * `message` stays the first parameter and the only required one, so the
 * ~100 existing call sites keep working while carrying a `code` inferred
 * from their status. Anything a call site can say more precisely — the
 * field at fault, whether the write landed, how to recover — it passes in
 * `extra`, and those are the parts P4 needs that prose cannot carry.
 *
 * `error` is still emitted alongside `message` because the client's
 * `errorMessage()` reads it; dropping it would silently degrade every
 * message the UI shows today.
 */
function error(
  res: import("node:http").ServerResponse,
  message: string,
  status = 400,
  extra: Omit<Partial<ErrorResponse>, "message"> = {},
): void {
  const envelope: ErrorResponse & { readonly error: string } = {
    code: extra.code ?? codeForStatus(status),
    message,
    // Retained for the existing client error path, which reads `error`.
    error: message,
    ...(extra.field !== undefined ? { field: extra.field } : {}),
    ...(extra.data_state !== undefined ? { data_state: extra.data_state } : {}),
    ...(extra.recovery !== undefined ? { recovery: extra.recovery } : {}),
    ...(extra.failures !== undefined ? { failures: extra.failures } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra.schema_status !== undefined ? { schema_status: extra.schema_status } : {}),
  };
  json(res, envelope, status);
}

/**
 * Turns a thrown git error into a status and envelope (GIT-C5).
 *
 * A merge conflict is not a server fault and not an unknown outcome, but
 * it used to be reported as both: status 500 with
 * `data_state: "unknown"`, identical to a failed push. The two need
 * opposite things from the user — a conflict needs them to go reconcile
 * two versions of a file, a failed push needs them to try again — and a
 * `recovery: retry` button on a conflict actively points the wrong way,
 * since retrying reproduces it exactly.
 *
 * `GitConflictError` also carries the conflicting paths, which the old
 * handler dropped on the floor. They go out as `failures` so the UI can
 * list the files instead of asking the user to find them.
 */
function gitErrorResponse(err: unknown): {
  status: number;
  extra: Omit<Partial<ErrorResponse>, "message">;
  message: string;
} {
  if (err instanceof GitConflictError) {
    return {
      status: 409,
      message: err.message,
      extra: {
        code: "conflict",
        // The conflict path aborts before writing anything — the error's
        // own message promises "your local files are untouched", so
        // saying "unknown" here would contradict it.
        data_state: "not_saved",
        // Retrying re-runs the same comparison and conflicts again.
        // There is nothing to offer but the manual reconciliation the
        // message describes.
        recovery: { kind: "none" },
        failures: err.paths.map((path: string) => ({
          ref: path,
          message: "changed on both sides",
        })),
      },
    };
  }
  return {
    status: 500,
    message: (err as Error).message,
    extra: {
      code: "git_failed",
      data_state: "unknown",
      recovery: { kind: "retry" },
    },
  };
}

/**
 * The envelope fields shared by every write rejected before it reached
 * disk: a validation failure, stated as not-saved (ERR-18), with retry
 * offered as a control (ERR-15). Spread it and add `field` wherever the
 * failure belongs to one, so the UI can place it at the input (ERR-14).
 */
const REJECTED_WRITE = {
  code: "validation_failed",
  data_state: "not_saved",
  recovery: { kind: "retry" },
} as const satisfies Omit<Partial<ErrorResponse>, "message">;

/**
 * As {@link REJECTED_WRITE}, but for a rejection retrying cannot fix —
 * a guard on the value itself, where re-sending the same request gets
 * the same answer. ERR-15 says not to offer a control that cannot help.
 */
const REJECTED_WRITE_NO_RETRY = {
  code: "validation_failed",
  data_state: "not_saved",
  recovery: { kind: "none" },
} as const satisfies Omit<Partial<ErrorResponse>, "message">;

/**
 * No user is registered yet, which every user-scoped route depends on.
 *
 * The remedy is a CLI command, so ERR-15 wants the exact string carried
 * for the UI to render copyable rather than told to the user in prose.
 */
const NO_USERS_MESSAGE = "No user is set up yet, so there is nobody to act as.";
const NO_USERS_ENVELOPE = {
  code: "not_found",
  recovery: { kind: "command", command: 'loctt user create "Your Name"' },
} as const satisfies Omit<Partial<ErrorResponse>, "message">;

/**
 * A bulk request that aborted before any task was touched.
 *
 * ERR-25 requires this to read differently from a partial success, which
 * core returns in the 200 body as a `succeeded`/`failed` split. Reaching
 * `error()` at all means zero of the batch was applied.
 */
/**
 * Whether `field` names something a task can be sorted by.
 *
 * Derived from the frontmatter schema rather than a hand-kept list, so
 * a new field is sortable the moment it exists — the alternative rots
 * silently, and rejecting a *valid* field is worse than the bug this
 * check fixes. Custom fields arrive as `fields.<key>` and are accepted
 * on shape: their vocabulary lives in workflow.yaml, and a task that
 * does not carry one sorts as absent, which is correct.
 */

const BULK_ABORTED = {
  code: "validation_failed",
  data_state: "not_saved",
  recovery: { kind: "retry" },
} as const satisfies Omit<Partial<ErrorResponse>, "message">;

/**
 * Reports a batch that aborted outright.
 *
 * Most causes are the user's input and map to `validation_failed`, but
 * lock contention is not: another process is writing, nothing was
 * attempted, and the fix is to wait rather than to change anything
 * (BLK-42). Core states that itself via `LocttError`, so the envelope
 * is taken from the error rather than re-derived here (V1, V8).
 */
/**
 * HTTP status for an error core attributed.
 *
 * 400 is only right when the *request* was wrong. A held lock is a
 * conflict, a schema mismatch or an unreadable file is the server's
 * problem, and reporting either as "Bad Request" blames the user for
 * something they did not do (ERR-31).
 */
function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "not_found": return 404;
    case "conflict": return 409;
    case "io_failed":
    case "schema_mismatch":
    case "git_failed":
    case "unknown": return 500;
    default: return 400;
  }
}

function bulkAborted(res: Parameters<typeof error>[0], err: unknown): void {
  if (err instanceof LocttError) {
    const env = err.toEnvelope();
    error(res, env.message, statusForCode(err.code), env);
    return;
  }
  error(res, (err as Error).message, 400, BULK_ABORTED);
}

/** A user simply has no avatar — a fact, not something the app can fix. */
const NO_AVATAR = {
  code: "not_found",
  recovery: { kind: "none" },
} as const satisfies Omit<Partial<ErrorResponse>, "message">;

/**
 * Internal sentinel: a handler that throws this signals the
 * request loop to stop processing. We've already written a 400
 * response by the time this is thrown.
 */
class HandledRequestError extends Error {
  constructor() {
    super("__handled_request__");
    this.name = "HandledRequestError";
  }
}

/**
 * Reads the request body and parses it as JSON. On parse failure
 * writes a 400 with a clear error message and throws
 * HandledRequestError so the surrounding handler can early-exit
 * via try/catch. Keeps the per-route boilerplate small while
 * mapping bad JSON to 400 instead of letting it bubble to 500.
 *
 * An empty body is treated as `{}` — convenient for routes whose
 * fields are all optional. Routes that *require* fields should
 * still validate after parsing.
 */
async function parseJsonBody<T = unknown>(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<T> {
  const body = await readBody(req);
  if (body.length === 0) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    // Only ever reached on a write (no GET route parses a body), so the
    // not-saved claim is safe: nothing was attempted against disk. The
    // parser's own text is jargon, so it goes in `detail` (ERR-16).
    error(res, "The request could not be read.", 400, {
      ...REJECTED_WRITE,
      detail: (err as Error).message,
    });
    throw new HandledRequestError();
  }
}

/**
 * Reads a JSON body and validates it against a zod schema. On
 * shape failure writes a 400 with the field path and throws
 * `HandledRequestError` so the handler returns without further
 * work. On success returns the typed, parsed result.
 *
 * Use for any endpoint whose request body is a documented
 * structured shape — closes the gap where the old
 * `parseJsonBody<T>(...)` cast accepted whatever JSON came in
 * regardless of declared TypeScript shape.
 */
async function parseJsonBodyWithSchema<S extends import("zod").ZodTypeAny>(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  schema: S,
): Promise<import("zod").infer<S>> {
  const raw = await parseJsonBody<unknown>(req, res);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // ERR-22: a shape rejection is a field problem, not a protocol one.
    // When every issue names the same top-level field the UI can place
    // it at that input (ERR-14); a multi-field rejection has no single
    // home, so it goes unplaced rather than pointing at an arbitrary one.
    const field = zodSingleField(parsed.error);
    error(res, zodIssueSummary(parsed.error), 400, {
      ...REJECTED_WRITE,
      ...(field !== undefined ? { field } : {}),
    });
    throw new HandledRequestError();
  }
  return parsed.data;
}

/**
 * Renders zod issues as prose: `due_date: must be YYYY-MM-DD`.
 *
 * ERR-16 keeps validator jargon out of user-facing copy, so the issue
 * *messages* are joined and the surrounding `ZodError` structure — codes,
 * paths as arrays, the JSON dump — is dropped.
 */
function zodIssueSummary(err: ZodError): string {
  return err.issues
    .map(i => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`)
    .join("; ");
}

/**
 * The single top-level field every issue in `err` belongs to, or
 * `undefined` when they span more than one (or none).
 *
 * ERR-14 places a field error at its input, which needs exactly one
 * field to place it at — a rejection naming three fields has no such
 * home and is better left for the view-level surface.
 */
function zodSingleField(err: ZodError): string | undefined {
  const roots = new Set(
    err.issues.map(i => i.path[0]).filter((p): p is string => typeof p === "string"),
  );
  if (roots.size !== 1) return undefined;
  return [...roots][0];
}

/** Default page size when a list endpoint is called without `?limit`. */
const DEFAULT_PAGE_LIMIT = 100;
/** Hard cap on page size; clients can request smaller but not larger. */
const MAX_PAGE_LIMIT = 1000;

/**
 * Parses `?limit` and `?offset` from a URL into a validated tuple.
 * Returns `null` (after writing a 400) if either is malformed.
 *
 * - `limit` defaults to {@link DEFAULT_PAGE_LIMIT} and may not exceed
 *   {@link MAX_PAGE_LIMIT}. Exceeding the cap returns 400 rather than
 *   silently clamping, so the client knows it didn't get everything.
 * - `offset` defaults to 0.
 * - Both must be non-negative integers when present.
 */
function parsePagination(
  url: URL,
  res: import("node:http").ServerResponse,
): { offset: number; limit: number } | null {
  let limit = DEFAULT_PAGE_LIMIT;
  let offset = 0;
  // Pagination only guards read routes, so no data_state claim applies
  // (ERR-18 scopes it to write paths — nothing was at stake here). The
  // params come from the URL the app itself built, so retry is the only
  // control that can help.
  const badParam = {
    code: "validation_failed",
    recovery: { kind: "retry" },
  } as const satisfies Omit<Partial<ErrorResponse>, "message">;
  if (url.searchParams.has("limit")) {
    const raw = url.searchParams.get("limit") ?? "";
    const n = Number(raw);
    if (raw.length === 0 || !Number.isInteger(n) || n < 0) {
      error(res, "limit must be a non-negative integer", 400, { ...badParam, field: "limit" });
      return null;
    }
    if (n > MAX_PAGE_LIMIT) {
      error(res, `limit must be at most ${MAX_PAGE_LIMIT}`, 400, { ...badParam, field: "limit" });
      return null;
    }
    limit = n;
  }
  if (url.searchParams.has("offset")) {
    const raw = url.searchParams.get("offset") ?? "";
    const n = Number(raw);
    if (raw.length === 0 || !Number.isInteger(n) || n < 0) {
      error(res, "offset must be a non-negative integer", 400, { ...badParam, field: "offset" });
      return null;
    }
    offset = n;
  }
  return { offset, limit };
}

/**
 * Builds a paginated response envelope. Slices `items` by the
 * provided offset+limit and reports the unsliced total so clients
 * can render `Page X of Y` without a follow-up count call.
 */
function paginated<T>(items: readonly T[], offset: number, limit: number): {
  items: T[];
  total: number;
  offset: number;
  limit: number;
} {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit,
  };
}

/**
 * Asserts that an entity we just wrote can still be read back. The
 * create/update handlers re-load the config and find the entry by
 * key so they can return the persisted resource. If the find fails,
 * something raced (delete during request) or wrote silently — either
 * way the client should not get a degraded `{key}` shape.
 */
function assertPersisted<T>(entity: T | undefined, kind: string, key: string): T {
  if (entity === undefined) {
    throw new Error(`${kind} ${key} was just written but could not be read back`);
  }
  return entity;
}

const VALID_REF_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Renders a filter value as a DSL atom.
 *
 * Identifiers that **start with a letter or underscore** pass through
 * unquoted; everything else is double-quoted with `"`/`\` escaped, so
 * a value can never break out of its atom and inject query structure.
 * This is the single chokepoint that makes
 * {@link buildStructuredQuery} injection-safe.
 *
 * The leading-character rule is load-bearing, and the previous
 * `[A-Za-z0-9_.-]+` was not: **every ULID begins with a digit**, so the
 * tokenizer read `01M0TC…` as the number `01` followed by a stray
 * identifier and rejected the query. That broke every ULID-valued
 * filter — project, assignee, reporter, milestone, sprint, labels —
 * on every request, while the UI still displayed a chip claiming the
 * filter was applied.
 */
function dslAtom(value: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The structured list filters, mapping a URL search-param name to the
 * task field its values constrain. Each param is a comma-separated
 * list; multiple values on one field are OR-ed (`field in (a, b)`),
 * and fields are AND-ed together. Custom fields arrive as
 * `field.<key>` and map to `fields.<key>`.
 */
const STRUCTURED_FILTER_FIELDS: Readonly<Record<string, string>> = {
  project: "project",
  status: "status",
  priority: "priority",
  type: "task_type",
  assignee: "assignee",
  reporter: "reporter",
  labels: "labels",
  milestone: "milestone",
  sprint: "sprint",
};

/**
 * Combines the free-text `query` param with the structured filter
 * params into a single DSL query string, AND-ing every active filter.
 * Returns `undefined` when nothing is set (so the caller passes no
 * query at all and core's defaults apply).
 *
 * Multi-value fields become `field in (a, b)`; a single value becomes
 * `field = a`. Custom-field params (`field.<key>=…`) map to
 * `fields.<key>`. All values flow through {@link dslAtom}, so
 * user-supplied ids/keys can't inject query structure.
 */
/**
 * Rewrites a `?project=` slug in place to the project's id.
 *
 * K3 rules that URLs carry a slug, not a ULID, and PRU-6's last bullet
 * requires `?project=backend` to keep resolving after a rename. Core's
 * `findProjectBySlug` existed and was called nowhere, so a slug
 * silently produced an empty list: the task was there, a ULID filter
 * found it, the slug found nothing — an empty result reads as "no
 * matches", not as "this filter does not work".
 *
 * A value that is not a known slug is left untouched, so ids and names
 * keep working exactly as before.
 */
async function resolveProjectSlugParam(url: URL, locttDir: string): Promise<void> {
  const raw = url.searchParams.get("project");
  if (raw === null || raw === "") return;
  try {
    const cfg = await loadProjectsConfig(locttDir);
    const bySlug = findProjectBySlug(cfg, raw);
    if (bySlug !== undefined) url.searchParams.set("project", bySlug.id);
  } catch {
    // An unreadable projects.yaml is reported by the routes that need
    // it; a filter is not the place to fail the whole request.
  }
}

function buildStructuredQuery(url: URL, baseQuery: string | undefined): string | undefined {
  const clauses: string[] = [];
  if (baseQuery !== undefined && baseQuery.trim().length > 0) {
    clauses.push(`(${baseQuery})`);
  }

  const addClause = (field: string, raw: string): void => {
    const values = raw.split(",").map(v => v.trim()).filter(Boolean);
    const first = values[0];
    if (first === undefined) return;
    if (values.length === 1) {
      clauses.push(`${field} = ${dslAtom(first)}`);
    } else {
      clauses.push(`${field} in (${values.map(dslAtom).join(", ")})`);
    }
  };

  for (const [param, field] of Object.entries(STRUCTURED_FILTER_FIELDS)) {
    const raw = url.searchParams.get(param);
    if (raw !== null) addClause(field, raw);
  }
  // Custom-field filters arrive as `field.<key>=v1,v2`.
  for (const [key, raw] of url.searchParams.entries()) {
    if (key.startsWith("field.") && key.length > "field.".length) {
      addClause(`fields.${key.slice("field.".length)}`, raw);
    }
  }

  if (clauses.length === 0) return undefined;
  return clauses.join(" and ");
}

/**
 * Validates a captured ref / key / id from a route capture.
 * Returns the ref string when valid, or null when it isn't — in
 * which case the helper has already written a 400 to `res`, so
 * the caller just needs to `return` from the handler.
 *
 * Folds in the ~15 repeated
 *   if (!VALID_REF_RE.test(ref)) { error(res, ...); return; }
 * blocks into one place.
 */
function requireValidRef(
  captures: readonly string[],
  res: import("node:http").ServerResponse,
  index: number = 0,
  req?: import("node:http").IncomingMessage,
): string | null {
  const ref = captures[index] ?? "";
  if (!VALID_REF_RE.test(ref)) {
    // The ref is in the route, not a form field, so there is no input to
    // place this at (ERR-14 does not apply). On a write the rejection
    // happens before anything is read, let alone written — ERR-18's
    // claim is not-saved. Reads put nothing at stake, so they omit it.
    const isWrite = req !== undefined && req.method !== "GET" && req.method !== "HEAD";
    error(res, "That task reference is not a valid task key.", 400, {
      code: "validation_failed",
      ...(isWrite ? { data_state: "not_saved" as const } : {}),
      recovery: { kind: "reload" },
    });
    return null;
  }
  return ref;
}
const TASK_REF_RE = /^\/api\/tasks\/([^/]+)$/;
const PROJECT_KEY_RE = /^\/api\/projects\/([^/]+)$/;
const PROJECT_PREFIX_RE = /^\/api\/projects\/([^/]+)\/prefix$/;
const LABEL_KEY_RE = /^\/api\/labels\/([^/]+)$/;
const MILESTONE_KEY_RE = /^\/api\/milestones\/([^/]+)$/;
const SPRINT_KEY_RE = /^\/api\/sprints\/([^/]+)$/;
const VIEW_REF_RE = /^\/api\/views\/([^/]+)$/;
const VIEW_UNARCHIVE_RE = /^\/api\/views\/([^/]+)\/unarchive$/;
const USER_REF_RE = /^\/api\/users\/([^/]+)$/;
const LABEL_ARCHIVE_RE = /^\/api\/labels\/([^/]+)\/archive$/;
const LABEL_UNARCHIVE_RE = /^\/api\/labels\/([^/]+)\/unarchive$/;
const USER_ARCHIVE_RE = /^\/api\/users\/([^/]+)\/archive$/;
const USER_UNARCHIVE_RE = /^\/api\/users\/([^/]+)\/unarchive$/;
const USER_AVATAR_RE = /^\/api\/users\/([^/]+)\/avatar$/;
const TASK_ACTIVITY_RE = /^\/api\/tasks\/([^/]+)\/activity$/;
const TASK_COMMENTS_RE = /^\/api\/tasks\/([^/]+)\/comments$/;
const TASK_COMMENT_ID_RE = /^\/api\/tasks\/([^/]+)\/comments\/([^/]+)$/;
const TASK_SET_RE = /^\/api\/tasks\/([^/]+)\/set$/;
const TASK_UNSET_RE = /^\/api\/tasks\/([^/]+)\/unset$/;
const TASK_ARCHIVE_RE = /^\/api\/tasks\/([^/]+)\/archive$/;
const TASK_DUPLICATE_RE = /^\/api\/tasks\/([^/]+)\/duplicate$/;
const TASK_UNARCHIVE_RE = /^\/api\/tasks\/([^/]+)\/unarchive$/;
const TASK_LINK_RE = /^\/api\/tasks\/([^/]+)\/link$/;
const TASK_UNLINK_RE = /^\/api\/tasks\/([^/]+)\/unlink$/;
const TASK_ATTACHMENTS_RE = /^\/api\/tasks\/([^/]+)\/attachments$/;
const TASK_ATTACHMENT_ITEM_RE = /^\/api\/tasks\/([^/]+)\/attachments\/([^/]+)$/;
const TASK_BOARD_RERANK_RE = /^\/api\/tasks\/([^/]+)\/board-rerank$/;
const TASK_BOARD_MOVE_RE = /^\/api\/tasks\/([^/]+)\/board-move$/;
const TASK_SET_DATES_RE = /^\/api\/tasks\/([^/]+)\/set-dates$/;

const TASK_RELATIONSHIP_RERANK_RE = /^\/api\/tasks\/([^/]+)\/relationships\/([^/]+)\/([^/]+)\/rerank$/;
const TASK_BODY_RE = /^\/api\/tasks\/([^/]+)\/body$/;
const TASK_BODY_APPEND_RE = /^\/api\/tasks\/([^/]+)\/body\/append$/;
const CONFIG_KEY_RE = /^\/api\/config\/([^/]+)$/;
const SPRINT_BURNDOWN_RE = /^\/api\/sprints\/([^/]+)\/burndown$/;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RouteHandlerParams {
  req: import("node:http").IncomingMessage;
  res: import("node:http").ServerResponse;
  url: URL;
  locttDir: string;
  captures: readonly string[];
}

type RouteHandler = (params: RouteHandlerParams) => Promise<void>;

interface Route {
  method: HttpMethod;
  pattern: string | RegExp;
  handler: RouteHandler;
}

function matchPattern(pattern: string | RegExp, path: string): readonly string[] | null {
  if (typeof pattern === "string") {
    return pattern === path ? [] : null;
  }
  const m = pattern.exec(path);
  if (!m) return null;
  return m.slice(1);
}

export interface WebAppOptions {
  readonly root: string;
  readonly port?: number;
  /**
   * Absolute path to a directory containing the built client SPA
   * (index.html + assets). When set, GET requests that don't match an
   * API route are served from this directory, with `index.html` returned
   * for any unmatched path so client-side routing works. When unset,
   * non-API requests get a 404 — useful for headless/API-only use.
   */
  readonly clientDir?: string;
}

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return STATIC_MIME[filePath.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

async function tryServeStatic(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  clientDir: string,
  urlPath: string,
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const root = pathResolve(clientDir);
  // Malformed percent-encoding (e.g. `%E0` without a follow-up byte)
  // throws URIError. Bail out as "not a static file" rather than
  // letting it propagate to the request handler and 500.
  let requested: string;
  try {
    requested = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  } catch {
    return false;
  }
  const candidate = pathNormalize(pathJoin(root, requested));
  if (!candidate.startsWith(root + pathSep) && candidate !== root) {
    return false;
  }

  let target: string | null = null;
  try {
    const s = await fsStat(candidate);
    if (s.isFile()) target = candidate;
  } catch { /* fall through */ }

  if (!target) {
    // Asset paths (anything with a recognizable extension) should
    // 404 cleanly instead of getting the SPA's index.html — that
    // breaks JS module loading silently and confuses the browser
    // dev tools. Only fall back to index.html for paths that look
    // like client-routed pages.
    const lastSegment = requested.slice(requested.lastIndexOf("/") + 1);
    const dot = lastSegment.lastIndexOf(".");
    if (dot !== -1 && dot < lastSegment.length - 1) {
      const ext = lastSegment.slice(dot).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(STATIC_MIME, ext)) {
        return false;
      }
    }
    const indexHtml = pathJoin(root, "index.html");
    try {
      const s = await fsStat(indexHtml);
      if (s.isFile()) target = indexHtml;
    } catch { /* no client built */ }
  }

  if (!target) return false;

  res.writeHead(200, { "Content-Type": mimeFor(target) });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  // pipeline() handles backpressure, propagates errors from either
  // end, and waits for the writer to finish. On stream-side error
  // (disk EIO, file truncated mid-read) we can't recover the
  // already-sent 200 headers — destroy the socket so the client
  // sees a truncated transfer instead of a silent stall. Logged
  // under LOCTT_DEBUG so an operator can correlate.
  try {
    await pipeline(createReadStream(target), res);
  } catch (err) {
    if (process.env["LOCTT_DEBUG"] === "1") {
      console.error(`[web] static-stream error for ${target}:`, err);
    }
    if (!res.writableEnded) {
      res.destroy();
    }
  }
  return true;
}

/**
 * CSRF guard for state-changing requests.
 * Requires the X-Loctt-Client header on non-GET methods.
 * Browsers cannot send custom headers on simple cross-origin requests
 * without a CORS preflight, and since we set no Access-Control-Allow-*
 * headers, the preflight will be denied — blocking cross-site requests.
 */
function requireCsrfHeader(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return true;
  }
  if (!req.headers["x-loctt-client"]) {
    // Only reachable from something other than the LocTT UI, which always
    // sends the header. Rejected before any handler ran, so nothing was
    // written. The header name is machinery, not user copy (ERR-16), so
    // it goes in `detail`.
    error(res, "That request did not come from the LocTT app, so it was refused.", 403, {
      code: "validation_failed",
      data_state: "not_saved",
      recovery: { kind: "reload" },
      detail: "Missing X-Loctt-Client header",
    });
    return false;
  }
  return true;
}

export function createWebApp(options: WebAppOptions) {
  const root = options.root;
  const port = options.port ?? DEFAULT_PORT;
  const clientDir = options.clientDir ?? null;

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  const handleInfo: RouteHandler = async ({ res, locttDir }) => {
    const info = await getTrackerInfo(root);
    // Pick the "primary" counter to summarize the tracker. If a
    // workspace default project exists, use its counter; otherwise
    // fall back to whatever single counter is configured (or none).
    let primaryEntry: { prefix: string; next_number: number } | undefined;
    if (info.exists && info.state) {
      try {
        const projects = await loadProjectsConfig(locttDir);
        const primaryId = projects.default ?? projects.projects[0]?.id;
        if (primaryId !== undefined) {
          primaryEntry = info.state.keys[primaryId];
        }
      } catch {
        // No projects.yaml — pre-multi-project tracker (shouldn't happen
        // with current init, but stay graceful).
      }
    }
    const response: TrackerInfoResponse = {
      exists: info.exists,
      taskCount: info.taskCount,
      keyPrefix: primaryEntry?.prefix ?? info.workflowConfig?.key.prefix ?? null,
      nextKey: primaryEntry
        ? `${primaryEntry.prefix}${primaryEntry.next_number}`
        : null,
      schemaStatus: info.schemaStatus,
      cwd: displayPath(root),
      // Workspace-timezone today, so the client's date-dependent
      // filters ("Overdue", "Due this week") agree with what the same
      // query returns through the CLI rather than following the
      // viewer's browser zone.
      // VUE-19: the zone travels with the date, so the UI can state
      // *why* today is what it is rather than leaving an off-by-one
      // result unexplained.
      ...(await workspaceTodayWithZone(locttDir)),
    };
    json(res, response);
  };

  const handleDoctor: RouteHandler = async ({ res }) => {
    const checks = await runDoctor(root);
    json(res, checks as DoctorCheckResponse[]);
  };

  const handleListViews: RouteHandler = async ({ res, locttDir }) => {
    try {
      const cfg = await loadQueriesConfig(locttDir);
      json(res, cfg);
    } catch (err) {
      // VUE-36 / XS-66: a queries.yaml that will not parse must reach
      // the sidebar as a *named* failure, not as the generic 500
      // "The server failed while handling GET /api/views" with
      // `recovery: retry`. Retry is actively wrong advice for a
      // malformed file — the file has to be edited — and a Views group
      // that renders empty on this reads as "your saved views were
      // deleted". `QueriesConfigError`'s own message carries the file
      // name and the offending entry (`queries[0].query is required`,
      // `duplicate query id: <id>`), so it is the headline verbatim
      // per ERR-6.
      if (err instanceof QueriesConfigError) {
        error(res, err.message, 400, {
          code: "config_invalid",
          data_state: "not_saved",
          recovery: { kind: "none" },
        });
        return;
      }
      throw err;
    }
  };

  /**
   * `POST /api/query/validate` — parse and validate a DSL string
   * without running or saving it (VUE-8, VUE-31..34, A11Y-53).
   *
   * The advanced editor needs to mark errors *while the user types*,
   * which neither `GET /api/tasks` nor `POST /api/views` can serve: one
   * runs the query, the other writes it. Both also flatten the failure
   * into a message string, discarding the `position` and `suggestions`
   * that `validate.ts` deliberately carries (LST-44/LST-45). A marker
   * cannot be placed from prose, so this route returns them as fields.
   *
   * `kind` is the discriminator the four error cases turn on, and it is
   * derived from the error *class*, not from matching message text:
   *
   *  - `syntax`       — TokenizeError/ParseError (VUE-31, VUE-34)
   *  - `unknown_field` — parses, names a field that does not exist (VUE-32)
   *  - `unknown_value` — parses, names a value outside the config (VUE-33)
   *
   * The last two are both `QueryValidationError`, so they are split on
   * whether the offending token is a known field — see `classify`.
   * Reporting a valid query as 200 with `valid: true` rather than an
   * empty error keeps VUE-28's legitimate-empty-result distinct from
   * every failure: a query that matches nothing is still *valid*.
   */
  const handleValidateQuery: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBodyWithSchema(req, res, ValidateQueryRequestSchema);
    const { workflowConfig } = await loadOptionalConfigs(locttDir);

    try {
      validateQuery(
        parseQuery(tokenize(r.query)),
        workflowConfig ? { workflow: workflowConfig } : {},
      );
    } catch (err) {
      if (err instanceof TokenizeError || err instanceof ParseError) {
        json(res, {
          valid: false,
          kind: "syntax",
          message: err.message,
          position: err.position,
          suggestions: [],
        });
        return;
      }
      if (err instanceof QueryValidationError) {
        json(res, {
          valid: false,
          // `unknown field "x"` is the only phrasing validate.ts uses
          // for a field it does not recognise; everything else it
          // raises is about a *value*. Matched on the structured
          // message it builds itself, not on user text.
          kind: err.message.startsWith("unknown field")
            ? "unknown_field"
            : "unknown_value",
          message: err.message,
          position: err.position,
          suggestions: err.suggestions,
        });
        return;
      }
      throw err;
    }

    json(res, { valid: true });
  };

  const handleCreateView: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBodyWithSchema(req, res, CreateViewRequestSchema);
    try {
      const created = await createView(locttDir, r);
      json(res, created, 201);
    } catch (err) {
      // ViewError is core's own user-facing text (a bad query, a
      // duplicate name), so it is the headline verbatim per ERR-6.
      if (err instanceof ViewError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "query" });
        return;
      }
      throw err;
    }
  };

  const handleUpdateView: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const r = await parseJsonBodyWithSchema(req, res, EditViewRequestSchema);
    try {
      // Drop explicitly-`undefined` keys so we're passing
      // EditViewInput (T?: shape) not zod's `T | undefined` shape
      // — exactOptionalPropertyTypes treats them as different. The
      // sort: null case ("clear sort") is preserved.
      const updated = await editView(locttDir, ref, {
        ...(r.name !== undefined ? { name: r.name } : {}),
        ...(r.query !== undefined ? { query: r.query } : {}),
        ...(r.sort !== undefined ? { sort: r.sort } : {}),
      });
      json(res, updated);
    } catch (err) {
      if (err instanceof ViewError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "query" });
        return;
      }
      throw err;
    }
  };

  const handleDeleteView: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    // Same contract as labels and milestones: DELETE means delete.
    // `deleteView`'s `hard` also defaults to false, so this route
    // archived the view while answering `{"deleted": ref}` — the view
    // stayed in queries.yaml and kept resolving by id. `?soft=true`
    // is the way to archive (VUE-25), which is a different intent.
    const soft = url.searchParams.get("soft") === "true";
    try {
      await deleteView(locttDir, ref, { hard: !soft });
      json(res, { deleted: ref });
    } catch (err) {
      // A delete names no field, and re-issuing it gets the same answer
      // (the view is gone, or was never there), so retry cannot help.
      if (err instanceof ViewError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  /**
   * VUE-25: an archived view is hidden from the sidebar but still
   * runnable by id, and unarchiving restores it with the same id.
   * `unarchiveView` is exported from core and — until now — called by
   * nothing at all, so there was no way back from an archive.
   */
  const handleUnarchiveView: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    try {
      await unarchiveView(locttDir, ref);
      json(res, { unarchived: ref });
    } catch (err) {
      if (err instanceof ViewError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleGetWorkflow: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadWorkflowConfig(locttDir);
    json(res, cfg);
  };

  const handlePutWorkflow: RouteHandler = async ({ req, res, locttDir }) => {
    const payload = await parseJsonBodyWithSchema(req, res, PutWorkflowRequestSchema);
    try {
      // Spread-narrow the remap to drop explicitly-undefined keys —
      // core's WorkflowRemap uses T?: shape, zod's optional() emits
      // T | undefined; exactOptionalPropertyTypes treats them as
      // different.
      const remap = payload.remap === undefined ? {} : {
        ...(payload.remap.statuses !== undefined ? { statuses: payload.remap.statuses } : {}),
        ...(payload.remap.priorities !== undefined ? { priorities: payload.remap.priorities } : {}),
        ...(payload.remap.task_types !== undefined ? { task_types: payload.remap.task_types } : {}),
        ...(payload.remap.relationships !== undefined ? { relationships: payload.remap.relationships } : {}),
        ...(payload.remap.custom_fields !== undefined ? { custom_fields: payload.remap.custom_fields } : {}),
      };
      const result = await applyWorkflowEdit(locttDir, payload.workflow, remap);
      json(res, result);
    } catch (err) {
      // applyWorkflowEdit validates the whole document and rewrites task
      // frontmatter; it either commits or rejects, so the write did not
      // land. `config_invalid` rather than a generic validation failure —
      // ERR-31 wants the cause named where it is known.
      error(res, (err as Error).message, 400, {
        code: "config_invalid",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      });
    }
  };

  /**
   * SET-17 / SET-19: the reference count a delete confirm needs, and
   * SET-3's absolute path, from one read.
   *
   * Deliberately NOT folded into `GET /api/workflow`. That response is
   * the config document itself — the same shape `workflow.yaml` holds —
   * and several consumers (the list view, every status dropdown) read it
   * on every render. Walking every task on disk to answer them would put
   * a full tracker scan behind a config fetch. The panels that need
   * counts ask for them separately.
   */
  const handleWorkflowUsage: RouteHandler = async ({ res, locttDir }) => {
    const tasks = await loadAllTasks(locttDir);
    const counts = computeWorkflowKeyCounts(tasks);
    const response: WorkflowUsageResponse = {
      path: getWorkflowConfigPath(locttDir),
      ...counts,
    };
    json(res, response);
  };

  const handleConfig: RouteHandler = async ({ res, locttDir }) => {
    const workflow = await loadWorkflowConfig(locttDir);
    let queries = null;
    try { queries = await loadQueriesConfig(locttDir); } catch { /* ok */ }
    const response: ConfigResponse = { workflow, queries };
    json(res, response);
  };

  const handleListProjects: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const cfg = await loadProjectsConfig(locttDir);
    // A sentinel surviving to here means boot recovery could not finish
    // it. The panel has to say so rather than render a healthy tracker
    // whose task keys may be half-migrated (PRU-46).
    let pendingPrefixRename: PrefixRenameState | undefined;
    try {
      pendingPrefixRename = await readPrefixRenameState(locttDir);
    } catch {
      // An unreadable sentinel is itself reported by doctor; it must not
      // take down the projects list, which is where the user would go
      // to understand the problem.
    }
    // SHL-5 marks the *active* project, which is where a new task
    // actually lands — and that is the per-user default when one is
    // set, not the workspace default. Reporting only `cfg.default`
    // stars a project the user's own writes would not go to. Carried
    // as a separate field so `default` keeps meaning "the workspace
    // default" for the settings panel that edits it.
    let effectiveDefault: string | null = cfg.default ?? null;
    try {
      effectiveDefault = await resolveProjectIdForUser(locttDir);
    } catch {
      // Ambiguous (several projects, no default anywhere) or empty.
      // Neither is an error for a *list* — the group renders with no
      // project starred, which is honest about there being no answer.
    }
    // PRU-17: the panel shows a reference count *before* the delete
    // dialog is opened, so it ships with the list rather than behind a
    // second round-trip. Counted from the same source the delete
    // guard uses, so the badge and the dialog cannot disagree.
    const taskCounts: Record<string, number> = {};
    try {
      for (const task of await loadAllTasks(locttDir)) {
        const proj = task.frontmatter.project;
        if (typeof proj === "string" && proj.length > 0) {
          taskCounts[proj] = (taskCounts[proj] ?? 0) + 1;
        }
      }
    } catch {
      // An unreadable task must not take down the projects panel; the
      // badge is omitted rather than shown as a wrong number.
    }
    json(res, {
      ...paginated(cfg.projects, page.offset, page.limit),
      default: cfg.default ?? null,
      effective_default: effectiveDefault,
      task_counts: taskCounts,
      ...(pendingPrefixRename !== undefined
        ? { pending_prefix_rename: pendingPrefixRename }
        : {}),
    });
  };

  /**
   * Completes a prefix rename that boot recovery could not finish, so
   * the user has a control in the panel and is not sent to the CLI
   * (PRU-46).
   */
  const handleCompletePrefixRename: RouteHandler = async ({ res, locttDir }) => {
    try {
      const result = await completeInterruptedPrefixRename(locttDir);
      if (!result) {
        json(res, { completed: false });
        return;
      }
      json(res, {
        completed: true,
        from: result.from,
        to: result.to,
        renamed: result.renamed,
      });
    } catch (err) {
      if (err instanceof ProjectError) {
        error(res, err.message, 400, REJECTED_WRITE);
        return;
      }
      throw err;
    }
  };

  const handleCreateProject: RouteHandler = async ({ req, res, locttDir }) => {
    const request = await parseJsonBody<{
      name: string;
      prefix: string;
      slug?: string;
      make_default?: boolean;
    }>(req, res);
    try {
      const created = await createProject(locttDir, {
        name: request.name,
        prefix: request.prefix,
        ...(typeof request.slug === "string" && request.slug.length > 0
          ? { slug: request.slug }
          : {}),
      });
      if (request.make_default === true) {
        await setDefaultProject(locttDir, created.id);
      }
      json(res, created, 201);
    } catch (err) {
      // Blame the field that actually conflicts (PRU-35, PRU-36,
      // ERR-14): a slug rejection marked as a prefix problem points the
      // user at an input that is perfectly fine.
      if (err instanceof ProjectError) {
        const field = /slug/i.test(err.message) ? "slug" : "prefix";
        error(res, err.message, 400, { ...REJECTED_WRITE, field });
        return;
      }
      throw err;
    }
  };

  const handleUpdateProject: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const request = await parseJsonBody<{
      name?: string;
      default?: boolean;
      archived?: boolean;
    }>(req, res);
    try {
      if (request.name !== undefined) {
        await editProject(locttDir, id, { name: request.name });
      }
      // PRU-7: archive/unarchive. Core has had `archiveProject` and
      // `unarchiveProject` all along with no caller on any surface;
      // without this the field was accepted and silently dropped.
      if (request.archived === true) {
        await archiveProject(locttDir, id);
      } else if (request.archived === false) {
        await unarchiveProject(locttDir, id);
      }
      if (request.default === true) {
        await setDefaultProject(locttDir, id);
      } else if (request.default === false) {
        const cfg = await loadProjectsConfig(locttDir);
        if (cfg.default === id) await setDefaultProject(locttDir, null);
      }
      const cfg = await loadProjectsConfig(locttDir);
      const updated = assertPersisted(
        cfg.projects.find(p => p.id === id),
        "project",
        id,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof ProjectError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "name" });
        return;
      }
      throw err;
    }
  };

  /**
   * Prefix changes get their own endpoint rather than riding along with
   * `PUT /api/projects/:id`. The name field saves on blur; a prefix
   * change rewrites every task in the project, so it must be a
   * deliberate, separately-confirmed request (PRU-44) — not something a
   * stray blur can trigger.
   */
  const handleSetProjectPrefix: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const request = await parseJsonBody<{ prefix?: string }>(req, res);
    if (typeof request.prefix !== "string" || request.prefix.length === 0) {
      error(res, `A prefix is required.`, 400, {
        ...REJECTED_WRITE,
        field: "prefix",
      });
      return;
    }
    try {
      const result = await setProjectPrefix(locttDir, id, request.prefix);
      json(res, {
        id,
        from: result.from,
        to: result.to,
        renamed: result.renamed,
      });
    } catch (err) {
      if (err instanceof ProjectError) {
        // field: "prefix" so the client renders this at the input that
        // caused it rather than only in a toast (PRU-45, ERR-14).
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "prefix" });
        return;
      }
      throw err;
    }
  };

  const handleDeleteProject: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    // A DELETE that only archived was the whole endpoint until now:
    // `hard` was never passed, so PRU-17's remap flow had no way to
    // run and a "delete" silently left the project in projects.yaml.
    // Archive keeps its own route (`PUT` with `archived: true`), so
    // DELETE means delete unless explicitly asked to soft-delete.
    const hard = url.searchParams.get("soft") !== "true";
    try {
      const result = await deleteProject(locttDir, id, {
        ...(hard ? { hard: true } : {}),
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: id, remappedTaskCount: result.remappedTaskCount });
    } catch (err) {
      // Delete guards (project still has tasks, remap target missing)
      // reject the whole operation before anything is rewritten.
      if (err instanceof ProjectError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleGetCalendar: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadCalendarConfig(locttDir);
    json(res, cfg);
  };

  const handlePutCalendar: RouteHandler = async ({ req, res, locttDir }) => {
    const raw = await parseJsonBody<unknown>(req, res);
    const parsed = CalendarConfigSchema.safeParse(raw);
    if (!parsed.success) {
      // ERR-10: name the failing field and what was expected. The issue
      // messages carry the expectation; the ZodError structure does not
      // reach the headline (ERR-16).
      const field = zodSingleField(parsed.error);
      error(res, zodIssueSummary(parsed.error), 400, {
        code: "config_invalid",
        data_state: "not_saved",
        recovery: { kind: "retry" },
        ...(field !== undefined ? { field } : {}),
      });
      return;
    }
    try {
      await saveCalendarConfig(locttDir, parsed.data);
      json(res, parsed.data);
    } catch (err) {
      // The document validated, so a failure here is the write itself
      // failing — a filesystem problem, not the user's input.
      error(res, "calendar.yaml could not be saved.", 500, {
        code: "io_failed",
        data_state: "not_saved",
        recovery: { kind: "retry" },
        detail: (err as Error).message,
      });
    }
  };

  const handleGetListView: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadListViewConfig(locttDir);
    json(res, cfg);
  };

  const handleSprintBurndown: RouteHandler = async ({ res, locttDir, captures }) => {
    const key = decodeURIComponent(captures[0] ?? "");
    try {
      const series = await readBurndownSeries(locttDir, key);
      json(res, series);
    } catch (err) {
      // A read: no data was at stake, so no data_state claim (ERR-18).
      if (err instanceof BurndownError) {
        error(res, err.message, 404, { code: "not_found", recovery: { kind: "reload" } });
        return;
      }
      throw err;
    }
  };

  const handlePutListView: RouteHandler = async ({ req, res, locttDir }) => {
    const raw = await parseJsonBody<unknown>(req, res);
    const parsed = ListViewConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const field = zodSingleField(parsed.error);
      error(res, zodIssueSummary(parsed.error), 400, {
        code: "config_invalid",
        data_state: "not_saved",
        recovery: { kind: "retry" },
        ...(field !== undefined ? { field } : {}),
      });
      return;
    }
    try {
      await saveListViewConfig(locttDir, parsed.data);
      json(res, parsed.data);
    } catch (err) {
      error(res, "The list view settings could not be saved.", 500, {
        code: "io_failed",
        data_state: "not_saved",
        recovery: { kind: "retry" },
        detail: (err as Error).message,
      });
    }
  };

  /**
   * Attaches `taskCount` to config entities when `?counts=true`.
   *
   * Opt-in rather than always-on: counting scans every task, and the
   * sidebar renders these lists on every page load. Settings panels
   * that show "3 tasks use this label" ask for it; the sidebar does
   * not. `countTasksByReferences` batches the whole list into one
   * scan rather than one per entity.
   */
  async function withCounts<T extends { readonly id: string }>(
    locttDir: string,
    url: URL,
    kind: TaskReferenceKind,
    items: readonly T[],
  ): Promise<readonly (T | (T & { taskCount: number }))[]> {
    if (url.searchParams.get("counts") !== "true") return items;
    const counts = await countTasksByReferences(locttDir, kind, items.map(i => i.id));
    return items.map(i => ({ ...i, taskCount: counts[i.id] ?? 0 }));
  }

  /**
   * Attaches `progress` to milestones or sprints when `?progress=true`.
   *
   * Opt-in for the same reason as counts: it scans every task, and the
   * sidebar lists these on every page load without needing it.
   *
   * The shape comes from core's `computeProgress` rather than being
   * derived here, so the Milestones view, the milestone detail and any
   * sidebar readout cannot show three different denominators for one
   * milestone (MSL-3).
   */
  async function withProgress<T extends { readonly id: string }>(
    locttDir: string,
    url: URL,
    field: "milestone" | "sprint",
    items: readonly T[],
  ): Promise<readonly (T | (T & { progress: Progress }))[]> {
    if (url.searchParams.get("progress") !== "true") return items;
    const workflow = await loadWorkflowConfig(locttDir);
    const ids = items.map(i => i.id);
    const byId = field === "milestone"
      ? await milestoneProgress(locttDir, ids, workflow)
      : await sprintProgress(locttDir, ids, workflow);
    return items.map(i => ({
      ...i,
      progress: byId[i.id] ?? { done: 0, total: 0, discarded: 0, fraction: 0 },
    }));
  }

  const handleListSprints: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const cfg = await loadSprintsConfig(locttDir);
    const counted = await withCounts(locttDir, url, "sprint", cfg.sprints);
    const items = await withProgress(locttDir, url, "sprint", counted);
    json(res, paginated(items, page.offset, page.limit));
  };

  const handleCreateSprint: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBody<{
      name: string;
      start_date: string;
      end_date: string;
      state: "active" | "completed" | "future";
      goal?: string;
    }>(req, res);
    try {
      const created = await createSprint(locttDir, {
        name: r.name,
        start_date: r.start_date,
        end_date: r.end_date,
        state: r.state,
        ...(r.goal !== undefined ? { goal: r.goal } : {}),
      });
      json(res, created, 201);
    } catch (err) {
      // SprintError's common cause is the date range (end before start),
      // so `end_date` is the input the UI can mark (ERR-14).
      if (err instanceof SprintError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "end_date" });
        return;
      }
      throw err;
    }
  };

  const handleUpdateSprint: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const r = await parseJsonBody<{
      name?: string;
      start_date?: string;
      end_date?: string;
      state?: "active" | "completed" | "future";
      goal?: string | null;
    }>(req, res);
    try {
      await editSprint(locttDir, id, {
        ...(r.name !== undefined ? { name: r.name } : {}),
        ...(r.start_date !== undefined ? { start_date: r.start_date } : {}),
        ...(r.end_date !== undefined ? { end_date: r.end_date } : {}),
        ...(r.state !== undefined ? { state: r.state } : {}),
        ...("goal" in r ? { goal: r.goal } : {}),
      });
      const cfg = await loadSprintsConfig(locttDir);
      const updated = assertPersisted(
        cfg.sprints.find(s => s.id === id),
        "sprint",
        id,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof SprintError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "end_date" });
        return;
      }
      throw err;
    }
  };

  const handleDeleteSprint: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    try {
      const result = await deleteSprint(locttDir, id, {
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: id, ...result });
    } catch (err) {
      if (err instanceof SprintError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleListMilestones: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const cfg = await loadMilestonesConfig(locttDir);
    const counted = await withCounts(locttDir, url, "milestone", cfg.milestones);
    const items = await withProgress(locttDir, url, "milestone", counted);
    json(res, paginated(items, page.offset, page.limit));
  };

  const handleCreateMilestone: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBody<{ name: string; target_date?: string }>(req, res);
    try {
      const created = await createMilestone(locttDir, {
        name: r.name,
        ...(r.target_date !== undefined ? { target_date: r.target_date } : {}),
      });
      json(res, created, 201);
    } catch (err) {
      if (err instanceof MilestoneError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "name" });
        return;
      }
      throw err;
    }
  };

  const handleUpdateMilestone: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const r = await parseJsonBody<{
      name?: string;
      target_date?: string | null;
      archived?: boolean;
    }>(req, res);
    try {
      await editMilestone(locttDir, id, {
        ...(r.name !== undefined ? { name: r.name } : {}),
        ...("target_date" in r ? { target_date: r.target_date } : {}),
        ...(r.archived !== undefined ? { archived: r.archived } : {}),
      });
      const cfg = await loadMilestonesConfig(locttDir);
      const updated = assertPersisted(
        cfg.milestones.find(m => m.id === id),
        "milestone",
        id,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof MilestoneError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "name" });
        return;
      }
      throw err;
    }
  };

  const handleDeleteMilestone: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    // MSL-12/MSL-13: DELETE means delete. Core's `hard` defaults to
    // false, so omitting it archived the milestone while answering 200
    // — the caller was told it was deleted and it was not. Worse, the
    // soft path *throws* on `remapTo`, so the remap MSL-12 requires was
    // unreachable over HTTP: the request 400'd with the CLI's own
    // `--remap-to only applies to --hard delete`. `?soft=true` keeps
    // archive reachable, matching the contract M4.1 landed for
    // `DELETE /api/projects/:id`.
    const soft = url.searchParams.get("soft") === "true";
    try {
      const result = await deleteMilestone(locttDir, id, {
        hard: !soft,
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: id, ...result });
    } catch (err) {
      if (err instanceof MilestoneError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleListLabels: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const cfg = await loadLabelsConfig(locttDir);
    const items = await withCounts(locttDir, url, "label", cfg.labels);
    json(res, paginated(items, page.offset, page.limit));
  };

  const handleCreateLabel: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBody<{ name: string; color?: string }>(req, res);
    try {
      const created = await createLabel(locttDir, {
        name: r.name,
        ...(r.color !== undefined ? { color: r.color } : {}),
      });
      json(res, created, 201);
    } catch (err) {
      // Both the duplicate-name guard and the hex-colour guard raise
      // LabelError; name is the field the create form leads with.
      if (err instanceof LabelError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "name" });
        return;
      }
      throw err;
    }
  };

  const handleUpdateLabel: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const r = await parseJsonBody<{ name?: string; color?: string | null }>(req, res);
    try {
      await editLabel(locttDir, id, {
        ...(r.name !== undefined ? { name: r.name } : {}),
        ...("color" in r ? { color: r.color } : {}),
      });
      const cfg = await loadLabelsConfig(locttDir);
      const updated = assertPersisted(
        cfg.labels.find(l => l.id === id),
        "label",
        id,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof LabelError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "name" });
        return;
      }
      throw err;
    }
  };

  const handleDeleteLabel: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    // See handleDeleteMilestone: same defect, same contract. Without
    // `hard` the label was archived, not deleted, and `remap_to` was
    // rejected outright — MSL-12's remap could not be performed at all.
    const soft = url.searchParams.get("soft") === "true";
    try {
      const result = await deleteLabel(locttDir, id, {
        hard: !soft,
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: id, ...result });
    } catch (err) {
      if (err instanceof LabelError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  /**
   * MSL-10: archiving a label keeps existing references and removes it
   * from the pickers. `archiveLabel`/`unarchiveLabel` were exported
   * from core and reached only by the CLI, so the UI had no way to
   * archive at all — a delete was the only option, which MSL-10 is
   * specifically about not having to do.
   */
  const handleArchiveLabel: RouteHandler = async ({ res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    try {
      await archiveLabel(locttDir, id);
      json(res, { archived: id });
    } catch (err) {
      if (err instanceof LabelError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleUnarchiveLabel: RouteHandler = async ({ res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    try {
      await unarchiveLabel(locttDir, id);
      json(res, { unarchived: id });
    } catch (err) {
      if (err instanceof LabelError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleListUsers: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const includeArchived = url.searchParams.get("include_archived") === "true";
    const users = await loadAllUsers(locttDir);
    const current = await getCurrentUser(locttDir);
    const filtered = users.filter(u => includeArchived || u.archived !== true);
    json(res, {
      ...paginated(filtered, page.offset, page.limit),
      current: current?.id ?? null,
    });
  };

  const handleCurrentUser: RouteHandler = async ({ res, locttDir }) => {
    const current = await getCurrentUser(locttDir);
    // ERR-15: the fix lives in the CLI, so the exact command is carried
    // for the UI to render copyable rather than described in prose.
    if (!current) { error(res, NO_USERS_MESSAGE, 404, NO_USERS_ENVELOPE); return; }
    json(res, current);
  };

  const handleListRecents: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const current = await getCurrentUser(locttDir);
    if (!current) { error(res, NO_USERS_MESSAGE, 404, NO_USERS_ENVELOPE); return; }
    const entries = await readRecents(locttDir, current.id);
    // Resolve each id to its current frontmatter. A recents file can
    // outlive the tasks it references (delete leaves the entry behind),
    // so silently drop ids that no longer resolve — the next push from
    // the client won't re-add them, and the sidebar only ever shows
    // live tasks.
    const resolved: RecentTaskResponse[] = [];
    for (const entry of entries) {
      try {
        const task = await lookupById(locttDir, entry.id);
        const fm = task.frontmatter;
        resolved.push({
          key: fm.key,
          title: fm.title,
          ...(fm.project !== undefined ? { project: fm.project } : {}),
          at: entry.at,
        });
      } catch (err) {
        if (err instanceof TaskNotFoundError) continue;
        throw err;
      }
    }
    json(res, paginated(resolved, page.offset, page.limit));
  };

  const handleSwitchUser: RouteHandler = async ({ req, res, locttDir }) => {
    const request = await parseJsonBody<{ ref: string }>(req, res);
    if (typeof request.ref !== "string" || request.ref.length === 0) {
      error(res, "Pick a user to switch to.", 400, { ...REJECTED_WRITE, field: "ref" });
      return;
    }
    try {
      const target = await resolveUserRef(locttDir, request.ref);
      await switchCurrentUser(locttDir, target.id);
      json(res, { current: target.id });
    } catch (err) {
      // The named user does not resolve — retrying the same ref cannot
      // help, so ERR-15 says offer no control that would not work.
      if (err instanceof UserError) {
        error(res, err.message, 400, { ...REJECTED_WRITE_NO_RETRY, field: "ref" });
        return;
      }
      throw err;
    }
  };

  const handleCreateUser: RouteHandler = async ({ req, res, locttDir }) => {
    const request = await parseJsonBody<{
      name: string;
      email?: string;
      timezone?: string;
      switch_to_on_create?: boolean;
    }>(req, res);
    if (typeof request.name !== "string" || request.name.length === 0) {
      error(res, "A name is required.", 400, { ...REJECTED_WRITE, field: "name" });
      return;
    }
    try {
      const created = await createUser(locttDir, {
        name: request.name,
        ...(request.email !== undefined ? { email: request.email } : {}),
        ...(request.timezone !== undefined ? { timezone: request.timezone } : {}),
        switchToOnCreate: request.switch_to_on_create === true,
      });
      json(res, created, 201);
    } catch (err) {
      if (err instanceof UserError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "name" });
        return;
      }
      throw err;
    }
  };

  const handleUpdateUser: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const request = await parseJsonBody<{
      name?: string;
      email?: string | null;
      timezone?: string;
    }>(req, res);
    try {
      const target = await resolveUserRef(locttDir, ref);
      const updated = await updateUser(locttDir, target.id, {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...("email" in request ? { email: request.email } : {}),
        ...(request.timezone !== undefined ? { timezone: request.timezone } : {}),
      });
      json(res, updated);
    } catch (err) {
      if (err instanceof UserError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "name" });
        return;
      }
      throw err;
    }
  };

  const handleUploadAvatar: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const contentType = req.headers["content-type"] ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      // Client-side bug, not user input — no field to place it at. The
      // protocol wording stays out of the headline (ERR-16).
      error(res, "The avatar upload was not sent in a form the server can read.", 400, {
        ...REJECTED_WRITE,
        recovery: { kind: "reload" },
        detail: `Content-Type must be multipart/form-data, got: ${contentType}`,
      });
      return;
    }

    let target;
    try {
      target = await resolveUserRef(locttDir, ref);
    } catch (err) {
      if (err instanceof UserError) {
        error(res, err.message, 404, {
          code: "not_found",
          data_state: "not_saved",
          recovery: { kind: "reload" },
        });
        return;
      }
      throw err;
    }

    const tmpParent = await mkdtemp(pathJoin(tmpdir(), "loctt-avatar-"));
    try {
      let parsed: ParsedFilePart;
      try {
        // Cap multipart at the avatar size limit so we reject huge
        // payloads before reading them into a temp file. The core
        // copyAvatar() also enforces MAX_AVATAR_BYTES on the written
        // file as defense-in-depth.
        parsed = await parseMultipartFile(req, contentType, tmpParent, "file", MAX_AVATAR_BYTES);
      } catch (parseErr) {
        // ERR-24: the upload is rejected before anything is copied into
        // the tracker, so no phantom avatar is left behind.
        error(res, (parseErr as Error).message, 400, { ...REJECTED_WRITE, field: "file" });
        return;
      }
      try {
        const updated = await updateUser(locttDir, target.id, {
          avatarSourcePath: parsed.tempPath,
        });
        json(res, updated);
      } catch (err) {
        if (err instanceof UserError) {
          error(res, err.message, 400, { ...REJECTED_WRITE, field: "file" });
          return;
        }
        throw err;
      }
    } finally {
      await rm(tmpParent, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const handleArchiveUser: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    try {
      const target = await resolveUserRef(locttDir, ref);
      await archiveUser(locttDir, target.id);
      json(res, { archived: target.id });
    } catch (err) {
      if (err instanceof UserError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleUnarchiveUser: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    try {
      const target = await resolveUserRef(locttDir, ref);
      await unarchiveUser(locttDir, target.id);
      json(res, { unarchived: target.id });
    } catch (err) {
      if (err instanceof UserError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleDeleteUser: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    // The confirmation guard fires before anything is read, so nothing
    // was deleted — ERR-18's claim is unambiguous here.
    if (url.searchParams.get("confirm") !== "true") {
      error(res, "Deleting a user is permanent, so it has to be confirmed first.", 400, {
        ...REJECTED_WRITE,
        field: "confirm",
      });
      return;
    }
    const remapToRef = url.searchParams.get("remap_to") ?? undefined;
    const unassign = url.searchParams.get("unassign") === "true";
    if (remapToRef !== undefined && unassign) {
      error(res, "Choose either a user to reassign to, or unassign — not both.", 400, {
        ...REJECTED_WRITE,
        field: "remap_to",
      });
      return;
    }
    try {
      const target = await resolveUserRef(locttDir, ref);
      const remapTo = remapToRef !== undefined
        ? (await resolveUserRef(locttDir, remapToRef)).id
        : undefined;
      const result = await deleteUser(locttDir, target.id, {
        ...(remapTo !== undefined ? { remapTo } : {}),
        ...(unassign ? { unassign: true } : {}),
      });
      json(res, { deleted: target.id, ...result });
    } catch (err) {
      if (err instanceof UserError) {
        error(res, err.message, 400, REJECTED_WRITE_NO_RETRY);
        return;
      }
      throw err;
    }
  };

  const handleGetAvatar: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    try {
      const target = await resolveUserRef(locttDir, ref);
      if (!target.avatar) { error(res, "This user has no avatar.", 404, NO_AVATAR); return; }
      // Defense-in-depth: target.avatar comes from a user-edited
      // YAML file. Reject anything that isn't a plain basename
      // before joining into a filesystem path.
      try {
        assertSafeBasename(target.avatar);
      } catch {
        // The stored filename is not a plain basename, which only a
        // hand-edited users file produces — name it as the config
        // problem it is rather than a generic bad request (ERR-31).
        error(res, "This user's avatar filename in .loctt/users is not usable.", 400, {
          code: "config_invalid",
          recovery: { kind: "none" },
        });
        return;
      }
      const avatarPath = pathJoin(locttDir, "users", target.id, target.avatar);
      // lstat (not stat) so a symlink at avatar.jpg doesn't smuggle
      // out an arbitrary file. Avatars are written atomically by
      // copyAvatar so this can only fire on a hand-crafted symlink,
      // but the check is cheap and the failure mode is severe.
      const stat = await fsLstat(avatarPath);
      if (stat.isSymbolicLink()) {
        error(res, "This user's avatar in .loctt/users is a symlink, which is not read.", 400, {
          code: "config_invalid",
          recovery: { kind: "none" },
        });
        return;
      }
      if (!stat.isFile()) { error(res, "This user has no avatar.", 404, NO_AVATAR); return; }
      // Avatars are always stored as JPG (sharp re-encode in core),
      // so the content-type is fixed. nosniff prevents the browser
      // from guessing into image/svg+xml or text/html if a
      // hand-edited file ended up with surprising bytes.
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(stat.size),
      });
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(avatarPath);
        stream.on("error", reject);
        stream.on("end", () => resolve());
        stream.pipe(res);
      });
    } catch (err) {
      if (err instanceof UserError) {
        error(res, err.message, 404, { code: "not_found", recovery: { kind: "reload" } });
        return;
      }
      throw err;
    }
  };

  const handleReplaceBody: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const task = await lookupTask(locttDir, ref);
    const r = await parseJsonBody<{ body: string; expectedToken?: unknown }>(req, res);
    if (typeof r.body !== "string") {
      error(res, "The description could not be read.", 400, { ...REJECTED_WRITE, field: "body" });
      return;
    }
    // K2. Optional on the wire, so the CLI's own `body --set` and every
    // existing caller keep last-write-wins; a client that opts in gets
    // the precondition. `undefined` is passed straight through to core,
    // whose `BodyWriteOptions` already means "no precondition".
    if (r.expectedToken !== undefined && typeof r.expectedToken !== "string") {
      error(res, "The version token could not be read.", 400, {
        ...REJECTED_WRITE_NO_RETRY,
        field: "expectedToken",
      });
      return;
    }
    try {
      await writeTaskBody(locttDir, task.frontmatter.id, r.body, {
        ...(typeof r.expectedToken === "string" ? { expectedToken: r.expectedToken } : {}),
      });
    } catch (err) {
      if (err instanceof StaleBodyWriteError) {
        /**
         * 409, not 412. Both are defensible reads of the spec, but the
         * envelope's `code` is what the UI branches on and `conflict`
         * already exists for exactly this shape (the git merge path
         * uses it). A 412 would need a new code for no behavioural
         * gain, and `conflict` is what `errorMessage()` already
         * routes.
         *
         * The current on-disk body rides along in `detail`. XS-12
         * requires the conflict surface to show *both* versions in
         * full, and a client that had to issue a second GET to fetch
         * "theirs" could race a third writer between the refusal and
         * that read — showing the user a version that is already gone.
         * Reading it here, after core has refused, means the two sides
         * shown are the two sides that actually collided.
         *
         * `data_state: "not_saved"` matters more than usual here:
         * core's own message says the text was NOT saved, and a client
         * that mistook this for a success would let the user close the
         * tab believing their draft landed.
         */
        const current = await readTaskBodyForConflict(locttDir, task.frontmatter.id);
        error(res, err.message, 409, {
          code: "conflict",
          data_state: "not_saved",
          // Retrying the identical request reproduces the refusal
          // exactly — the user has to choose a side (ERR-15).
          recovery: { kind: "none" },
          field: "body",
          detail: JSON.stringify({ theirs: current.body, bodyToken: current.token }),
        });
        return;
      }
      throw err;
    }
    json(res, { ok: true, bodyToken: await bodyToken(locttDir, task.frontmatter.id) });
  };

  /**
   * The body and token now on disk, for the conflict envelope above.
   *
   * Read through `buildShowModel`'s underlying loader rather than
   * re-parsing here, so "theirs" is the same string the client would
   * have got from a `GET /api/tasks/:ref` — a conflict surface that
   * showed a differently-parsed version of the file would be lying
   * about what the user is choosing between.
   */
  async function readTaskBodyForConflict(
    dir: string,
    taskId: string,
  ): Promise<{ body: string; token: string }> {
    const fresh = await lookupById(dir, taskId);
    return { body: fresh.body, token: await bodyToken(dir, taskId) };
  }

  const handleAppendBody: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const task = await lookupTask(locttDir, ref);
    const r = await parseJsonBody<{ text: string }>(req, res);
    if (typeof r.text !== "string") {
      error(res, "The text to append could not be read.", 400, { ...REJECTED_WRITE, field: "text" });
      return;
    }
    await appendTaskBody(locttDir, task.frontmatter.id, r.text);
    json(res, { ok: true });
  };

  const handleInit: RouteHandler = async ({ req, res }) => {
    const r = await parseJsonBodyWithSchema(req, res, InitRequestSchema);
    try {
      const result = await initLoctt(root, {
        ...(r.prefix !== undefined ? { prefix: r.prefix } : {}),
        ...(r.projectLabel !== undefined ? { projectName: r.projectLabel } : {}),
        ...(r.docs !== undefined ? { docs: r.docs } : {}),
      });
      json(res, { locttDir: result.locttDir, created: result.created.length }, 201);
    } catch (err) {
      // initLoctt refuses on an existing tracker and on a bad prefix;
      // either way nothing was created.
      error(res, (err as Error).message, 400, { ...REJECTED_WRITE, field: "prefix" });
    }
  };

  const handleSetConfigValue: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const r = await parseJsonBody<{ value: unknown }>(req, res);
    try {
      await setConfigValue({ locttDir, root }, key, String(r.value));
      json(res, { key });
    } catch (err) {
      // The config key being written is the field the UI marks (ERR-14):
      // the settings form renders one input per key.
      if (err instanceof ConfigRouterError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, code: "config_invalid", field: key });
        return;
      }
      throw err;
    }
  };

  const handleUnsetConfigValue: RouteHandler = async ({ res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    try {
      await unsetConfigValue({ locttDir, root }, key);
      json(res, { key });
    } catch (err) {
      if (err instanceof ConfigRouterError) {
        error(res, err.message, 400, {
          ...REJECTED_WRITE_NO_RETRY,
          code: "config_invalid",
          field: key,
        });
        return;
      }
      throw err;
    }
  };

  const handleGitStatus: RouteHandler = async ({ res, locttDir }) => {
    const status = await getGitStatus(locttDir, root);
    json(res, status);
  };

  const handleGitPublish: RouteHandler = async ({ res, locttDir }) => {
    try {
      const result = await publish(locttDir, root);
      json(res, result);
    } catch (err) {
      // ERR-31: git is the known cause, so it is named. Publish commits
      // to a temporary worktree and either lands or does not; a failure
      // partway leaves the tracker's own files untouched, but whether the
      // branch moved is not knowable from here — except for a conflict,
      // which aborts before writing and says so (GIT-C5).
      const { status, message, extra } = gitErrorResponse(err);
      error(res, message, status, extra);
    }
  };

  const handleGitSync: RouteHandler = async ({ res, locttDir }) => {
    try {
      const result = await sync(locttDir, root);
      json(res, result);
    } catch (err) {
      // Sync both fetches and publishes, so an interrupted run genuinely
      // cannot say which side landed — ERR-4 asks for `unknown` by name
      // rather than a guess in either direction. A conflict is the one
      // case that *can* say: it aborts before applying anything.
      const { status, message, extra } = gitErrorResponse(err);
      error(res, message, status, extra);
    }
  };

  const handleGitEnable: RouteHandler = async ({ res, locttDir }) => {
    try {
      await enableGit(locttDir, root);
      json(res, { enabled: true });
    } catch (err) {
      error(res, (err as Error).message, 400, {
        code: "git_failed",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      });
    }
  };

  const handleGitDisable: RouteHandler = async ({ res, locttDir }) => {
    try {
      await disableGit(locttDir);
      json(res, { enabled: false });
    } catch (err) {
      error(res, (err as Error).message, 400, {
        code: "git_failed",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      });
    }
  };

  const handleGetUserSettings: RouteHandler = async ({ res, locttDir }) => {
    const current = await getCurrentUser(locttDir);
    if (!current) { error(res, NO_USERS_MESSAGE, 404, NO_USERS_ENVELOPE); return; }
    const settings = await loadUserSettings(locttDir, current.id);
    json(res, { user: current.id, settings });
  };

  const handlePutUserSettings: RouteHandler = async ({ req, res, locttDir }) => {
    const current = await getCurrentUser(locttDir);
    // A write, so ERR-18 applies: nothing was written, since there is no
    // user to write settings for.
    if (!current) {
      error(res, NO_USERS_MESSAGE, 404, { ...NO_USERS_ENVELOPE, data_state: "not_saved" });
      return;
    }
    const raw = await parseJsonBody<unknown>(req, res);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      error(res, "The settings could not be read.", 400, REJECTED_WRITE);
      return;
    }
    // Settings are intentionally schema-less (UI-defined keys), but
    // reject obvious shape junk. JSON.parse already rejects
    // functions/symbols, but we still bound depth to avoid storing
    // pathological payloads.
    const MAX_DEPTH = 8;
    const checkDepth = (value: unknown, depth: number): boolean => {
      if (depth > MAX_DEPTH) return false;
      if (Array.isArray(value)) return value.every(v => checkDepth(v, depth + 1));
      if (value !== null && typeof value === "object") {
        return Object.values(value).every(v => checkDepth(v, depth + 1));
      }
      return true;
    };
    if (!checkDepth(raw, 0)) {
      error(res, `The settings are nested deeper than ${MAX_DEPTH} levels.`, 400, REJECTED_WRITE);
      return;
    }
    const settings = raw as Record<string, unknown>;
    await saveUserSettings(locttDir, current.id, settings);
    json(res, { user: current.id, settings });
  };

  const handleBoardRerank: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const request = await parseJsonBody<{ before?: string; after?: string }>(req, res);
    try {
      const result = await reorderBoardRank({
        locttDir,
        taskRef: ref,
        ...(request.before !== undefined ? { before: request.before } : {}),
        ...(request.after !== undefined ? { after: request.after } : {}),
      });
      json(res, result);
    } catch (err) {
      // A rejected drop: the rank was not written, and dropping on the
      // same bad target again would fail identically (ERR-15).
      if (err instanceof ReorderError) {
        error(res, err.message, 400, { ...REJECTED_WRITE_NO_RETRY, field: "board_rank" });
        return;
      }
      throw err;
    }
  };

  /**
   * A board drag that crosses columns: `status` and `board_rank` in
   * **one** write (BRD-9, XS-9, CW-5).
   *
   * ## Why this is not two calls
   *
   * The obvious implementation — `POST /set status` then
   * `POST /board-rerank` — is two writes with a window between them. A
   * crash, a 500, or a lost connection in that window leaves the card
   * in a column its `status` contradicts: exactly the half-landed
   * state BRD-41 says must never reach disk ("no partial write of one
   * field without the other"). XS-9 rules it out in as many words.
   *
   * `setFields` (core) writes a change set under one state lock and
   * appends one history batch, so both fields land or neither does. It
   * was exported and had no caller; this is the caller.
   *
   * ## Why a dedicated core op, not `reorderBoardRank`
   *
   * `reorderBoardRank` throws when given `before` *and* `after`
   * together, and this path passes both deliberately (BRD-32 wants the
   * two neighbours the user actually saw at release). It also writes
   * only `board_rank`, so routing through it would lose the atomic
   * status+rank write. Core's `boardMove` is the consolidation target
   * instead — and it brings the rebalance this path never had.
   *
   * The rank interpolation that used to live here is gone: one
   * implementation of "interpolate between two ranks", in core, so a
   * boundary fix or a rebalance cannot land on one path and not the
   * other.
   */
  const handleBoardMove: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const request = await parseJsonBody<{
      status?: unknown;
      before?: unknown;
      after?: unknown;
    }>(req, res);

    if (typeof request.status !== "string" || request.status.length === 0) {
      error(res, "No destination status was named for the move.", 400, REJECTED_WRITE);
      return;
    }
    const status = request.status;

    const wfConfig = await loadWorkflowConfig(locttDir);
    // BRD-42: the column was rendered from config the page loaded
    // *before* the status was deleted from `workflow.yaml`. The write
    // must be refused naming the key, and the board told to reload —
    // not written into a status the workflow no longer declares.
    if (!wfConfig.statuses.some(s => s.key === status)) {
      error(
        res,
        `The status "${status}" no longer exists in workflow.yaml. `
        + `This board is showing stale configuration — reload to see the current columns.`,
        400,
        {
          ...REJECTED_WRITE_NO_RETRY,
          field: "status",
          recovery: { kind: "reload" },
        },
      );
      return;
    }

    try {
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const result = await boardMove({
        locttDir,
        taskRef: ref,
        status,
        ...(typeof request.before === "string" && request.before.length > 0
          ? { before: request.before }
          : {}),
        ...(typeof request.after === "string" && request.after.length > 0
          ? { after: request.after }
          : {}),
        workflowConfig: wfConfig,
        archivedGuard,
      });
      json(res, projectTaskFrontmatter(result.task.frontmatter));
    } catch (err) {
      if (err instanceof ReorderError) {
        error(res, err.message, 400, {
          ...REJECTED_WRITE_NO_RETRY,
          field: "board_rank",
          recovery: { kind: "reload" },
        });
        return;
      }
      // BRD-41: the drop failed, so *neither* field was written —
      // `setFields` is atomic. The client snaps the card back to its
      // original column and position on this.
      if (err instanceof LocttError) {
        const envelope = err.toEnvelope();
        error(res, envelope.message, 400, {
          ...envelope,
          field: envelope.field ?? "status",
          recovery: envelope.recovery ?? { kind: "retry" },
        });
        return;
      }
      if (err instanceof ZodError) {
        error(res, zodIssueSummary(err), 400, {
          code: "validation_failed",
          field: "status",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        });
        return;
      }
      throw err;
    }
  };


  /**
   * `POST /api/tasks/:ref/set-dates` — the timeline drag's write verb
   * (TML-9, TML-10, TML-11).
   *
   * ## Why a route at all, when `/set` exists
   *
   * TML-11 is explicit: a body drag sends both dates "in a **single**
   * atomic multi-field write, not two sequential calls". `/set` is
   * singular by construction — one `field`, one `value`, one
   * `setField` — so a body drag routed through it is two requests with
   * a window between them. A crash in that window leaves a task whose
   * `start_date` is after its `due_date`, which is precisely the
   * anomaly TML-18 exists to render. TML-43 names the same failure
   * from the other side: "a half-applied shift that silently changes
   * the task's duration is the specific failure this case exists to
   * catch".
   *
   * `setFields` (core) applies a change set under one state lock and
   * appends one history batch, so both dates land or neither does.
   * This is `handleBoardMove`'s reasoning applied to the other pair of
   * fields that must move together.
   *
   * ## Why no `allowAutoManaged` grant
   *
   * `board_rank` needed one because it is in `AUTO_MANAGED_FIELDS`.
   * `start_date` and `due_date` are `BUILTIN_OPTIONAL_FIELDS` — user
   * fields the CLI's `loctt set` already writes — so the default
   * refusal does not apply to them and no grant is passed. Checked
   * rather than assumed: passing a grant we do not need would widen
   * this route to fields it has no business writing.
   *
   * ## Why the route names its own fields
   *
   * The payload is `{ start_date?, due_date? }`, not a generic
   * `changes[]`. A general multi-field write endpoint is a larger
   * surface than any case asks for, and it would let a client send
   * `status` and `title` through a path whose error envelopes are
   * written about dates. Each of TML-9/10/11 is one of the three
   * shapes this accepts: due only, start only, both.
   *
   * TML-9's first bullet ("`start_date` is **not included** in the
   * payload") and TML-10's ("only `start_date` is written; `due_date`
   * is untouched") are held by the omitted key never reaching the
   * change set — an absent key is absent, not sent at its current
   * value. Resending the unchanged date would clobber a concurrent
   * CLI edit with a value the browser read minutes ago, the same
   * hazard XS-9 names for `status` on a rerank.
   */
  const handleSetDates: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const request = await parseJsonBody<{
      start_date?: unknown;
      due_date?: unknown;
    }>(req, res);

    const changes: { field: string; value: unknown }[] = [];
    for (const field of ["start_date", "due_date"] as const) {
      if (!Object.hasOwn(request, field)) continue;
      const value = request[field];
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        error(
          res,
          `"${field}" must be a date in YYYY-MM-DD form.`,
          400,
          { ...REJECTED_WRITE, field },
        );
        return;
      }
      changes.push({ field, value });
    }

    if (changes.length === 0) {
      error(res, "No dates were given to change.", 400, REJECTED_WRITE);
      return;
    }

    // TML-45: "the write is rejected ... and the reason names the
    // constraint: start cannot be after due", and "nothing is written
    // to disk". Checked here, before `setFields`, so the rejection
    // happens without a partial write — and against the *effective*
    // pair, which for a single-edge drag means the stored value of the
    // date this request does not carry. A left-edge drag past the due
    // date sends only `start_date`, so comparing the two sent values
    // would find nothing wrong and write the anomaly.
    const current = await lookupTask(locttDir, ref);
    const sent = new Map(changes.map(c => [c.field, c.value as string]));
    const start = sent.get("start_date") ?? current.frontmatter.start_date;
    const due = sent.get("due_date") ?? current.frontmatter.due_date;
    if (
      typeof start === "string" && typeof due === "string"
      && start.slice(0, 10) > due.slice(0, 10)
    ) {
      error(
        res,
        `The start date (${start.slice(0, 10)}) cannot be after the due date `
        + `(${due.slice(0, 10)}).`,
        400,
        {
          ...REJECTED_WRITE,
          field: sent.has("start_date") ? "start_date" : "due_date",
        },
      );
      return;
    }

    try {
      const wfConfig = await loadWorkflowConfig(locttDir);
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const updated = await setFields({
        locttDir,
        taskId: current.frontmatter.id,
        changes,
        workflowConfig: wfConfig,
        archivedGuard,
      });
      json(res, projectTaskFrontmatter(updated.frontmatter));
    } catch (err) {
      // TML-43: the write failed, so *neither* date was written —
      // `setFields` is atomic. The client reverts the bar to its
      // original geometry on this and says both dates are unchanged.
      if (err instanceof LocttError) {
        const envelope = err.toEnvelope();
        error(res, envelope.message, 400, {
          ...envelope,
          field: envelope.field ?? changes[0]?.field ?? "due_date",
          recovery: envelope.recovery ?? { kind: "retry" },
        });
        return;
      }
      if (err instanceof ZodError) {
        error(res, zodIssueSummary(err), 400, {
          code: "validation_failed",
          field: changes[0]?.field ?? "due_date",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        });
        return;
      }
      throw err;
    }
  };

  const handleRelationshipRerank: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const sourceRef = captures[0] ?? "";
    const relationshipType = captures[1] ?? "";
    const targetRef = captures[2] ?? "";
    const request = await parseJsonBody<{ before?: string; after?: string }>(req, res);
    try {
      const result = await reorderRelationship({
        locttDir,
        sourceRef,
        relationshipType,
        targetRef,
        ...(request.before !== undefined ? { before: request.before } : {}),
        ...(request.after !== undefined ? { after: request.after } : {}),
      });
      json(res, result);
    } catch (err) {
      if (err instanceof ReorderError) {
        error(res, err.message, 400, { ...REJECTED_WRITE_NO_RETRY, field: "relationships" });
        return;
      }
      throw err;
    }
  };

  /**
   * True for the errors a malformed DSL query produces.
   *
   * Listed rather than caught broadly: an unexpected throw from the
   * evaluator is a server fault and must keep surfacing as one, or a
   * real bug hides behind a 400 that blames the user.
   */
  const isQueryError = (err: unknown): boolean =>
    err instanceof TokenizeError
    || err instanceof ParseError
    || err instanceof QueryValidationError
    || err instanceof ViewError;

  const handleListTasks: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    // Detailed, so a task file that will not parse can be *named*
    // rather than silently dropped (ERR-9). The other rows load either
    // way; what the plain call cannot do is tell the user which file
    // to go and fix.
    const { tasks, unreadable } = await loadAllTasksDetailed(locttDir);
    const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);

    const requestedView = url.searchParams.get("view") ?? undefined;
    // XS-28 / SHL-32: a view deleted from `queries.yaml` while a tab
    // holds its URL must not error the list. The case is explicit —
    // "the list falls back to a defined default view and says so — it
    // does not render an error page or an empty table implying zero
    // tasks". Resolving it in core throws `ViewError`, which the
    // catch below turns into a 400 and the surface into an error
    // page, so the drop has to happen before core sees it.
    //
    // A missing `queries.yaml` is not a missing view: with no config
    // at all there is nothing to check against, so the ref is passed
    // through and core decides.
    const viewMissing =
      requestedView !== undefined
      && queriesConfig !== undefined
      && !queriesConfig.queries.some(
        q => q.id === requestedView || q.name === requestedView,
      );
    const view = viewMissing ? undefined : requestedView;
    const includeArchived = url.searchParams.get("archived") === "true";
    // Fold the free-text `query` and the structured filter params
    // (project/status/priority/type/assignee/…, plus custom
    // `field.<key>`) into one DSL query, AND-ing every active filter.
    // When a saved view is in play we leave its query untouched (views
    // are authored as-is) and apply `?project=` via core's dedicated
    // structured project option instead.
    const baseQuery = url.searchParams.get("query") ?? undefined;
    await resolveProjectSlugParam(url, locttDir);
    const effectiveQuery = view !== undefined
      ? baseQuery
      : buildStructuredQuery(url, baseQuery);
    // Only relevant alongside a view (otherwise project rides in the
    // DSL above). Passed as a structured option so a project key with
    // query-parser specials can't confuse the parser.
    const projectFilter = view !== undefined
      ? (url.searchParams.get("project") ?? undefined)
      : undefined;
    // Single-column sort from `?sort=<field>&dir=asc|desc`. The list
    // view drives this off the clicked column header. `dir` defaults to
    // ascending and rejects anything else so a bad URL doesn't silently
    // sort the wrong way. When `sort` is absent we pass nothing and let
    // the view's own sort (or core's default) stand.
    const rawSort = url.searchParams.get("sort") ?? undefined;
    const dirParam = url.searchParams.get("dir");
    if (dirParam !== null && dirParam !== "asc" && dirParam !== "desc") {
      error(res, "Sort direction must be ascending or descending.", 400, {
        code: "validation_failed",
        field: "dir",
        recovery: { kind: "reload" },
      });
      return;
    }
    // An unknown sort field falls back to the default rather than
    // erroring (LST-29): the list must still render, and a pasted URL
    // with a typo is a bad sort, not a bad request. Dropping it here
    // also stops it reaching the comparator, where it read as
    // `undefined` on every task — the list came back in its original
    // order while the header still showed the sort as applied.
    const sortField = rawSort !== undefined && isSortableTaskField(rawSort)
      ? rawSort
      : undefined;
    const direction: "asc" | "desc" = dirParam ?? "asc";
    const sort = sortField !== undefined
      ? [{ field: sortField, direction }]
      : undefined;
    // listTasks() applies a built-in default limit (30) for the CLI's
    // benefit. The HTTP API paginates explicitly, so opt out by
    // passing a sentinel limit large enough to cover any tracker.
    // `total` then reflects the true matching count and the page
    // slice happens in `paginated()` below.
    const params: ListTasksRequest = {
      ...(effectiveQuery !== undefined ? { query: effectiveQuery } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(projectFilter !== undefined ? { project: projectFilter } : {}),
      ...(sort !== undefined ? { sort } : {}),
      ...(includeArchived ? { includeArchived: true } : {}),
      ...(today !== undefined ? { today } : {}),
      limit: Number.MAX_SAFE_INTEGER,
    };

    /*
      VUE-21. A saved view naming a since-deleted custom field is the
      one case core deliberately *warns* about instead of throwing:
      breaking a view that used to work would regress existing
      trackers, so `listTasks` runs it and reports through
      `onWarning`. Nothing was passing the callback, so the warning was
      raised and dropped, and the request returned 200 with zero rows —
      exactly the "zero rows presented as a legitimate empty result"
      the case forbids.

      Collected here and returned alongside the rows, the way
      `unreadable` already reports per-file parse failures: the rows
      that did match are still honest, and the reason the set may be
      short is named rather than left for the user to infer.
    */
    const queryWarnings: { field: string; message: string; position: number; suggestions: string[] }[] = [];

    let result;
    try {
      result = listTasks({
        tasks,
        options: params,
        onWarning: (err: QueryValidationError) => {
          queryWarnings.push({
            field: "query",
            message: err.message,
            position: err.position,
            suggestions: [...err.suggestions],
          });
        },
        ...(queriesConfig !== undefined ? { queriesConfig } : {}),
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        ctx: buildListContext(tasks),
      });
    } catch (err) {
      // A mistyped query is the user's, not the server's. Without this
      // it became 500 "Internal server error", discarding the message,
      // position and suggestions validate.ts carries deliberately — and
      // telling the user they broke the server (QRY-C2).
      if (isQueryError(err)) {
        error(res, (err as Error).message, 400, {
          code: "validation_failed",
          field: "query",
          recovery: { kind: "none" },
        });
        return;
      }
      throw err;
    }
    const frontmatters = result.map(t => projectTaskFrontmatter(t.frontmatter));
    json(res, {
      ...paginated(frontmatters, page.offset, page.limit),
      // ERR-9: the count above is honest about what loaded; this says
      // what did not, by path and with the parse error, so the user can
      // reconcile the list against what is on disk.
      ...(unreadable.length > 0 ? { unreadable } : {}),
      // XS-28: the fallback is reported rather than performed
      // silently. Without this the list looks like an ordinary
      // unfiltered result, and the user has no way to learn that the
      // view they asked for is gone.
      ...(viewMissing ? { missing_view: requestedView } : {}),
      // VUE-21: a saved view that ran but referenced something the
      // workflow no longer defines. Non-fatal by design — the rows are
      // real — but the user must be told, or a short result reads as a
      // legitimate empty one.
      ...(queryWarnings.length > 0 ? { warnings: queryWarnings } : {}),
    });
  };

  /**
   * `GET /api/search?q=<text>` (D2).
   *
   * Deliberately not a new matching engine: it builds `text ~ "<q>"`
   * and runs the existing evaluator, so the header box and a hand-typed
   * DSL query agree by construction. No full-text index — the corpus is
   * a directory of markdown files that the list route already loads in
   * full for every request.
   *
   * `q` is passed as a structured value rather than interpolated into
   * a query string, so a search for `foo") or (status = done` cannot
   * inject query structure.
   */
  const handleSearch: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length === 0) {
      // An empty search is not an error and is not "everything" —
      // returning the whole tracker for a stray keystroke would be a
      // surprising and expensive answer.
      json(res, paginated([], page.offset, page.limit));
      return;
    }

    const tasks = await loadAllTasks(locttDir);
    const { workflowConfig, today } = await loadOptionalConfigs(locttDir);
    const includeArchived = url.searchParams.get("archived") === "true";

    const result = listTasks({
      tasks,
      options: {
        query: `text ~ ${JSON.stringify(q)}`,
        ...(includeArchived ? { includeArchived: true } : {}),
        ...(today !== undefined ? { today } : {}),
        limit: Number.MAX_SAFE_INTEGER,
      },
      ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      ctx: buildListContext(tasks),
    });
    const frontmatters = result.map(t => projectTaskFrontmatter(t.frontmatter));
    json(res, paginated(frontmatters, page.offset, page.limit));
  };

  const handleExportTasks: RouteHandler = async ({ res, url, locttDir }) => {
    const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
    if (format !== "csv" && format !== "json") {
      error(res, "Export format must be CSV or JSON.", 400, {
        code: "validation_failed",
        field: "format",
        recovery: { kind: "reload" },
      });
      return;
    }
    const includeArchived = url.searchParams.get("archived") === "true";
    const includeBody = url.searchParams.get("body") === "true";
    const columnsParam = url.searchParams.get("columns");
    const columns = columnsParam ? columnsParam.split(",").map(c => c.trim()).filter(Boolean) : undefined;

    // Detailed, so a task that will not parse can be *named* rather
    // than silently dropped. BLK-44: "what must not happen is a
    // truncated file that silently omits the bad row with no
    // mention." The export used the plain call, so a corrupt task
    // vanished from the CSV and nothing anywhere said so — a
    // spreadsheet short by one row that reconciles against nothing.
    const { tasks, unreadable } = await loadAllTasksDetailed(locttDir);
    const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);
    const baseQuery = url.searchParams.get("query") ?? undefined;
    const view = url.searchParams.get("view") ?? undefined;
    const projectFilter = url.searchParams.get("project") ?? undefined;
    // Export mirrors the list view's filter resolution so a CSV/JSON
    // reflects exactly the rows the user is looking at. (archived is
    // applied below via filterForExport, so it's excluded here.)
    await resolveProjectSlugParam(url, locttDir);
    const effectiveQuery = view !== undefined
      ? baseQuery
      : buildStructuredQuery(url, baseQuery);
    const params: ListTasksRequest = {
      ...(effectiveQuery !== undefined ? { query: effectiveQuery } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(projectFilter !== undefined ? { project: projectFilter } : {}),
      ...(today !== undefined ? { today } : {}),
      limit: Number.MAX_SAFE_INTEGER,
    };
    const result = listTasks({
      tasks,
      options: params,
      ...(queriesConfig !== undefined ? { queriesConfig } : {}),
      ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      ctx: buildListContext(tasks),
    });
    const filtered = filterForExport(result, includeArchived);
    const opts = {
      ...(columns ? { columns } : {}),
      ...(includeBody ? { includeBody: true } : {}),
    };
    // The body is a file, so it cannot carry an error envelope. The
    // skipped ids ride on a header instead: the download still
    // succeeds — which is the branch BLK-44 prefers — and the client
    // reports what is missing from it.
    // Paths rather than ids: a path is what the user acts on, and it
    // is what ERR-9's banner already shows for the same files. A bare
    // ULID would also put an internal identifier in front of the user
    // for no gain (P-4) — the id is only a handle here because the
    // file will not parse well enough to have a key.
    //
    // Header-safe: a header value cannot hold a newline, and these are
    // filesystem paths under the tracker, so they are joined with a
    // separator that cannot appear in one.
    const skipped = unreadable.length > 0
      ? { "X-Loctt-Unreadable": unreadable.map(u => u.path).join("|") }
      : {};

    if (format === "json") {
      const body = exportTasksToJSON(filtered, opts);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="loctt-tasks.json"',
        ...skipped,
      });
      res.end(body);
    } else {
      const body = exportTasksToCSV(filtered, opts);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="loctt-tasks.csv"',
        ...skipped,
      });
      res.end(body);
    }
  };

  const handleCreateTask: RouteHandler = async ({ req, res, locttDir }) => {
    const request = await parseJsonBody<CreateTaskRequest>(req, res);
    const wfConfig = await loadWorkflowConfig(locttDir);

    // Resolve target project via the shared chain: explicit
    // > per-user default > workspace default > sole project. If
    // ambiguous, return 400 so the client can surface a picker.
    let projectKey: string;
    try {
      projectKey = await resolveProjectIdForUser(locttDir, request.project);
    } catch (err) {
      // Ambiguous or unknown project: the create form has a project
      // picker, so this places at that input (ERR-14). Nothing was
      // written — key allocation has not happened yet.
      error(res, (err as Error).message, 400, { ...REJECTED_WRITE, field: "project" });
      return;
    }

    const archivedGuard = await loadArchivedGuardConfigs(locttDir);
    let task;
    try {
      task = await withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        const created = await createTask({
          locttDir,
          state,
          options: { ...request, project: projectKey },
          workflowConfig: wfConfig,
          archivedGuard,
        });
        await saveState(locttDir, state);
        return created;
      });
    } catch (err) {
      // ERR-31: an archived-reference rejection is a known, specific
      // cause and must not flatten into a generic failure. Assigning the
      // same archived thing again would be rejected identically, so no
      // retry control is offered (ERR-15).
      if (err instanceof ArchivedReferenceError) {
        error(res, err.message, 400, {
          code: "archived_reference",
          data_state: "not_saved",
          recovery: { kind: "none" },
        });
        return;
      }
      // A rejected value (bad date, unconfigured status) reaches here as
      // a ZodError from the frontmatter write, and used to escape as a
      // 500 carrying a serialized validator dump — the same leak already
      // fixed in handleSetField (ERR-16, ERR-31).
      if (err instanceof ZodError) {
        const field = zodSingleField(err);
        error(res, zodIssueSummary(err), 400, {
          ...REJECTED_WRITE,
          ...(field !== undefined ? { field } : {}),
        });
        return;
      }
      if (err instanceof TaskUpdateError) {
        // Forward the offending field so the create form places the
        // message *at the input* (ERR-14, NEW-40) rather than as a
        // detached banner. Dropping it left the client with a correct
        // message and nowhere to put it.
        error(res, err.message, 400, {
          ...REJECTED_WRITE,
          ...(err.field !== undefined ? { field: err.field } : {}),
        });
        return;
      }
      throw err;
    }
    json(res, projectTaskFrontmatter(task.frontmatter), 201);
  };

  const handleGetTask: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res);
    if (ref === null) return;
    const task = await lookupTask(locttDir, ref);
    const model = await buildShowModel(locttDir, task);
    // "Recently viewed" is written here, on task-detail fetch. The read
    // route (GET /api/recents) shipped without this, so the sidebar
    // group was permanently empty — a list nothing wrote to.
    //
    // Failure is swallowed deliberately: not recording a recent view is
    // a cosmetic loss, and failing the task fetch over it would trade a
    // missing sidebar entry for an unopenable task.
    try {
      const current = await getCurrentUser(locttDir);
      if (current) await pushRecent(locttDir, current.id, task.frontmatter.id);
    } catch {
      // ignored — see above
    }
    const response: TaskResponse = {
      frontmatter: projectTaskFrontmatter(model.task.frontmatter),
      body: model.task.body,
      // K2. Computed from the file rather than from `model`, so it
      // describes the bytes on disk at the moment of this read — the
      // same thing core will recompute when the write arrives.
      bodyToken: await bodyToken(locttDir, task.frontmatter.id),
      attachments: model.attachments.map(a => ({
        name: a.name,
        size: a.size,
        ...(a.mime !== undefined ? { mime: a.mime } : {}),
      })),
      // REL-49: an unreadable directory degrades this section, not the
      // task. Omitting it would let the client render "no attachments"
      // over a directory that may be full.
      ...(model.attachmentsError !== undefined
        ? { attachmentsError: model.attachmentsError }
        : {}),
      // Detected server-side so every client applies one rule rather
      // than each editor reimplementing it (B5).
      lossyConstructs: findLossyConstructs(model.task.body).map(c => ({
        kind: c.kind,
        line: c.line,
        excerpt: c.excerpt,
      })),
      // buildShowModel already resolved these; the response used to
      // drop them, leaving the Relationships panel with no data.
      relationships: model.relationships.map(r => ({
        type: r.type,
        target: r.target,
        ...(r.resolvedKey !== undefined ? { resolvedKey: r.resolvedKey } : {}),
        ...(r.resolvedTitle !== undefined ? { resolvedTitle: r.resolvedTitle } : {}),
        ...(r.resolvedStatus !== undefined ? { resolvedStatus: r.resolvedStatus } : {}),
        missing: r.missing,
      })),
    };
    json(res, response);
  };

  const handleTaskActivity: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const ref = requireValidRef(captures, res);
    if (ref === null) return;
    const task = await lookupTask(locttDir, ref);
    /**
     * Rows, not entries. `readHistory` returns only the readable ones
     * and says nothing about what it dropped — so a file with one
     * hand-broken entry read back as a complete, shorter history, and
     * CMT-37's second bullet ("the feed says the list is incomplete
     * rather than presenting a partial log as complete") had no data
     * to stand on. `unreadable` is that datum, and it is a count
     * rather than the raw rows: the feed needs to say *that* the log
     * is incomplete, and shipping malformed YAML into the client
     * would invite rendering it.
     */
    const rows = await readHistoryRows(locttDir, task.frontmatter.id);
    const unreadable = rows.filter(r => isMalformedHistoryEntry(r)).length;
    const entries = validHistory(rows);

    // Copy before reversing — if `validHistory` ever returns a cached
    // array (or another caller observes the same reference), an
    // in-place reverse would corrupt their view.
    const reversed = [...entries].reverse();

    const page = parsePagination(url, res);
    if (page === null) return;
    const sliced = reversed.slice(page.offset, page.offset + page.limit);
    json(res, { entries: sliced, total: reversed.length, unreadable });
  };

  /**
   * Bulk operations (CW-4).
   *
   * Core had bulkSetFields/bulkArchive/bulkMoveTasksToProject and no
   * HTTP route reached any of them, so the documented bulk bar had no
   * backend at all.
   *
   * All four return the same `{bulk_op_id, succeeded, failed}` split.
   * Partial success is the normal outcome — a bad ref does not abort
   * the batch — and the split is what lets a UI retain exactly the
   * failures for retry rather than clearing the selection (ERR-13).
   *
   * Status is always 200, including when every task failed: the batch
   * itself was processed. Per-task outcomes live in the body.
   */
  const handleBulkSet: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBodyWithSchema(req, res, BulkSetRequestSchema);
    const wfConfig = await loadWorkflowConfig(locttDir);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);
    try {
      const result = await bulkSetFields({
        locttDir,
        taskRefs: r.refs,
        // JSON has no `undefined`, and core reads `undefined` as
        // "clear this field". Mapping null → undefined here is what
        // makes a separate bulk-unset endpoint unnecessary.
        changes: r.changes.map(c => ({
          field: c.field,
          value: c.value === null ? undefined : c.value,
        })),
        workflowConfig: wfConfig,
        archivedGuard,
      });
      json(res, result satisfies BulkResponse);
    } catch (err) {
      // Partial failure never reaches here — core returns it in the 200
      // body as `succeeded`/`failed`, which is what ERR-13 asks for. This
      // path is the batch aborting outright (an unwritable field name, a
      // lock it could not take), so ERR-25 applies instead: nothing was
      // applied, stated distinctly from a partial success.
      bulkAborted(res, err);
    }
  };

  const handleBulkArchive: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBodyWithSchema(req, res, BulkArchiveRequestSchema);
    try {
      const result = await bulkArchive({
        locttDir, taskRefs: r.refs, archive: r.archive,
      });
      json(res, result satisfies BulkResponse);
    } catch (err) {
      bulkAborted(res, err);
    }
  };

  /**
   * Permanent removal. The typed confirmation is enforced by the
   * schema, so a request without `confirm: "DELETE"` is a 400 before
   * core is reached — the server does not assume the client asked.
   */
  const handleBulkDelete: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBodyWithSchema(req, res, BulkDeleteRequestSchema);
    try {
      const result = await bulkDelete({ locttDir, taskRefs: r.refs });
      json(res, result satisfies BulkResponse);
    } catch (err) {
      // As with the other bulk routes: per-task failures come back in
      // the 200 body, so reaching here means nothing was deleted.
      bulkAborted(res, err);
    }
  };

  const handleBulkMove: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBodyWithSchema(req, res, BulkMoveRequestSchema);
    try {
      const projectId = await resolveProjectIdForUser(locttDir, r.project);
      const result = await bulkMoveTasksToProject({
        locttDir, taskRefs: r.refs, targetProjectId: projectId,
      });
      // Move reports key changes per task. `succeeded` is flattened to
      // the shared shape so every bulk route answers identically, but
      // the keys are carried alongside rather than dropped: BLK-9 wants
      // the result to name the new keys, and the old key is what the
      // user still has in hand.
      json(res, {
        bulk_op_id: result.bulk_op_id,
        succeeded: result.succeeded.map(x => x.taskId),
        failed: result.failed,
        moved: result.succeeded.map(x => ({
          taskId: x.taskId,
          old_key: x.oldKey,
          new_key: x.newKey,
        })),
      } satisfies BulkResponse);
    } catch (err) {
      bulkAborted(res, err);
    }
  };

  const handleBulkLink: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBodyWithSchema(req, res, BulkLinkRequestSchema);
    const wfConfig = await loadWorkflowConfig(locttDir);
    try {
      const result = await bulkLink({
        locttDir, taskRefs: r.refs, type: r.type, target: r.target,
        workflowConfig: wfConfig,
      });
      json(res, result satisfies BulkResponse);
    } catch (err) {
      bulkAborted(res, err);
    }
  };

  /**
   * Comments (item 9).
   *
   * packages/core/src/task/comments.ts implemented post/list/edit/
   * delete with zero production callers — no CLI command, no MCP tool,
   * no HTTP route — while ui/features.md described comments as shipped
   * and 38 UI cases were written against them.
   *
   * There is deliberately no ownership check on edit or delete. LocTT
   * has no roles or permissions (Q25) and users switch identity freely
   * from a menu, so an ownership guard would be the product's only
   * permission rule while protecting nothing. The requirement is
   * traceability: `editors` records who touched someone else's
   * comment (CMT-35).
   */
  const commentResolver = async (locttDir: string) =>
    buildMentionResolver(await loadAllUsers(locttDir));

  const handleListComments: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res);
    if (ref === null) return;
    const task = await lookupTask(locttDir, ref);
    const comments = await listComments(locttDir, task.frontmatter.id);
    json(res, comments satisfies readonly CommentResponse[]);
  };

  const handlePostComment: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const r = await parseJsonBodyWithSchema(req, res, PostCommentRequestSchema);
    const task = await lookupTask(locttDir, ref);
    try {
      const comment = await postComment({
        locttDir,
        taskId: task.frontmatter.id,
        body: r.body,
        mentionResolver: await commentResolver(locttDir),
      });
      json(res, comment satisfies CommentResponse, 201);
    } catch (err) {
      // ERR-12/ERR-27: the comment box keeps the typed text on screen, so
      // the not-saved claim is what tells the user to retry rather than
      // retype. The body is the field the composer can mark (ERR-14).
      //
      // CMT-33: core's "no current user set; pass an explicit author" is
      // a library's message — this surface has no author field to pass,
      // so relaying it verbatim names a fix the user cannot perform.
      // The CLI already rewrites it to name `loctt user switch`; the
      // equivalent route out here is the header's user menu.
      const message = /no current user/i.test((err as Error).message)
        ? "A user must be selected before you can comment — pick one from "
          + "the user menu, then post again."
        : (err as Error).message;
      error(res, message, 400, { ...REJECTED_WRITE, field: "body" });
    }
  };

  const handleEditComment: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const commentId = captures[1];
    if (commentId === undefined || commentId.length === 0) {
      error(res, "No comment was named to edit.", 400, {
        ...REJECTED_WRITE,
        recovery: { kind: "reload" },
      });
      return;
    }
    const r = await parseJsonBodyWithSchema(req, res, EditCommentRequestSchema);
    const task = await lookupTask(locttDir, ref);
    try {
      const comment = await editComment({
        locttDir,
        taskId: task.frontmatter.id,
        commentId,
        body: r.body,
        mentionResolver: await commentResolver(locttDir),
      });
      json(res, comment satisfies CommentResponse);
    } catch (err) {
      error(res, (err as Error).message, 400, { ...REJECTED_WRITE, field: "body" });
    }
  };

  const handleDeleteComment: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const commentId = captures[1];
    if (commentId === undefined || commentId.length === 0) {
      error(res, "No comment was named to delete.", 400, {
        ...REJECTED_WRITE,
        recovery: { kind: "reload" },
      });
      return;
    }
    const task = await lookupTask(locttDir, ref);
    try {
      await deleteComment({ locttDir, taskId: task.frontmatter.id, commentId });
      // Matches handleDeleteTask: a JSON body rather than 204, so a
      // client can confirm what was removed.
      json(res, { deleted: commentId });
    } catch (err) {
      // The comment is missing or the file could not be rewritten;
      // either way nothing was removed. Reload settles which it was.
      //
      // CMT-34's third bullet: when the comment was *already gone*,
      // the message has to say so. Core's "unknown comment id: <ulid>"
      // is accurate but reads as a malformed-input error, and the id
      // it names is one the user never typed and cannot act on.
      const raw = (err as Error).message;
      const message = /unknown comment id/i.test(raw)
        ? "That comment is already gone — someone else deleted it. "
          + "Refreshing will bring this list up to date."
        : raw;
      error(res, message, 400, {
        ...REJECTED_WRITE_NO_RETRY,
        recovery: { kind: "reload" },
      });
    }
  };

  const handleSetField: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const request = await parseJsonBody<UpdateTaskRequest>(req, res);
    if (typeof request.field !== "string" || request.field.length === 0) {
      error(res, "No field was named to change.", 400, REJECTED_WRITE);
      return;
    }
    const wfConfig = await loadWorkflowConfig(locttDir);
    const task = await lookupTask(locttDir, ref);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);
    try {
      const updated = await setField({
        locttDir,
        taskId: task.frontmatter.id,
        field: request.field,
        value: request.value,
        workflowConfig: wfConfig,
        archivedGuard,
      });
      json(res, projectTaskFrontmatter(updated.frontmatter));
    } catch (err) {
      // A rejected single-field write is the path ERR-14 and ERR-18 are
      // written about: the UI renders it at the input rather than in a
      // toast, and tells the user their edit did not land. Both need
      // the field name and the data state, which prose cannot carry.
      //
      // V1: core states its own cause, so the three hand-written
      // branches that used to live here — one per error class, each
      // restating a code the class already knew — are gone. Adding a
      // new error class in core no longer needs a matching branch here.
      //
      // `field` is filled in from the request when core did not name
      // one: core knows *what* was wrong, this handler knows *which
      // input* the user typed into.
      if (err instanceof LocttError) {
        const envelope = err.toEnvelope();
        error(res, envelope.message, 400, {
          ...envelope,
          field: envelope.field ?? request.field,
          recovery: envelope.recovery ?? { kind: "retry" },
        });
        return;
      }
      // Frontmatter shape is validated on write, so a bad value reaches
      // here as a raw ZodError. Left unhandled it became a 500 carrying
      // a serialized validator dump — a known cause reported as unknown
      // (ERR-31) with jargon in the headline (ERR-16).
      if (err instanceof ZodError) {
        error(res, zodIssueSummary(err), 400, {
          code: "validation_failed",
          field: request.field,
          data_state: "not_saved",
          recovery: { kind: "retry" },
        });
        return;
      }
      throw err;
    }
  };

  const handleUnsetField: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const { field } = await parseJsonBody<{ field: string }>(req, res);
    if (typeof field !== "string" || field.length === 0) {
      error(res, "No field was named to clear.", 400, REJECTED_WRITE);
      return;
    }
    const task = await lookupTask(locttDir, ref);
    try {
      const updated = await unsetField(locttDir, task.frontmatter.id, field);
      json(res, projectTaskFrontmatter(updated.frontmatter));
    } catch (err) {
      // Mirrors handleSetField: clearing an immutable or required field
      // is rejected before disk, and the UI places it at that input.
      if (err instanceof TaskUpdateError) {
        error(res, err.message, 400, { ...REJECTED_WRITE_NO_RETRY, field });
        return;
      }
      // Same ZodError leak as the set path: clearing a field the schema
      // requires fails frontmatter validation on write and would
      // otherwise surface as a generic 500 (ERR-16, ERR-31).
      if (err instanceof ZodError) {
        error(res, zodIssueSummary(err), 400, { ...REJECTED_WRITE_NO_RETRY, field });
        return;
      }
      throw err;
    }
  };

  const handleArchive: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const task = await lookupTask(locttDir, ref);
    const updated = await archiveTask(locttDir, task.frontmatter.id);
    json(res, projectTaskFrontmatter(updated.frontmatter));
  };

  const handleUnarchive: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const task = await lookupTask(locttDir, ref);
    const updated = await unarchiveTask(locttDir, task.frontmatter.id);
    json(res, projectTaskFrontmatter(updated.frontmatter));
  };

  /**
   * `POST /api/tasks/:ref/duplicate` — TSK-20.
   *
   * A thin wrapper over core's `duplicateTask`, which is what the CLI
   * and MCP already call. The copy's title, body and metadata come
   * from core; `key`, `id`, `created_at`/`updated_at` are fresh and
   * `key_history` is empty, all of which core guarantees and none of
   * which this route re-implements.
   *
   * No `overrides` are passed, so the copy is titled `<title> (copy)`
   * — core's default, and the same title `loctt duplicate` and the
   * MCP `duplicate` tool produce (A24). The suffix is not added here.
   *
   * `withStateLock` is not optional: allocating the copy's key reads
   * and writes `state.yaml`, so two concurrent duplicates without it
   * would race for the same counter value and hand out one key twice.
   * That is the one invariant this wrapper is responsible for.
   *
   * The full frontmatter is returned rather than just the key, because
   * the client navigates to the copy and can prime its cache from the
   * response instead of racing a refetch.
   */
  const handleDuplicate: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    // Fails here with a 404 if the source does not exist, before any
    // key is allocated — so a bad ref cannot burn a counter value.
    await lookupTask(locttDir, ref);
    const { workflowConfig } = await loadOptionalConfigs(locttDir);
    const archivedGuard = await loadArchivedGuardConfigs(locttDir);
    try {
      const created = await withStateLock(locttDir, async () => {
        const state = await loadState(locttDir);
        const task = await duplicateTask({
          locttDir,
          state,
          sourceRef: ref,
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
          archivedGuard,
        });
        await saveState(locttDir, state);
        return task;
      });
      json(res, projectTaskFrontmatter(created.frontmatter));
    } catch (err) {
      // A source whose assignee or milestone has since been archived
      // cannot be copied forward wholesale. Same shape as create's
      // (ERR-31): named cause, nothing written, no retry offered —
      // repeating the request would be rejected identically.
      if (err instanceof ArchivedReferenceError) {
        error(res, err.message, 400, {
          code: "archived_reference",
          data_state: "not_saved",
          recovery: { kind: "none" },
        });
        return;
      }
      if (err instanceof ZodError) {
        error(res, zodIssueSummary(err), 400, { ...REJECTED_WRITE_NO_RETRY });
        return;
      }
      throw err;
    }
  };

  const handleDeleteTask: RouteHandler = async ({ req, res, url, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    // Fires before the task is even loaded, so nothing was deleted.
    if (url.searchParams.get("confirm") !== "true") {
      error(res, "Deleting a task is permanent, so it has to be confirmed first.", 400, {
        ...REJECTED_WRITE,
        field: "confirm",
      });
      return;
    }
    const task = await lookupTask(locttDir, ref);
    await deleteTask(locttDir, task.frontmatter.id, { force: true });
    json(res, { deleted: task.frontmatter.key });
  };

  const handleLink: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const request = await parseJsonBody<LinkRequest>(req, res);
    const wfConfig = await loadWorkflowConfig(locttDir);
    const task = await lookupTask(locttDir, ref);
    const target = await lookupTask(locttDir, request.target);
    try {
      const updated = await linkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: target.frontmatter.id, workflowConfig: wfConfig });
      json(res, projectTaskFrontmatter(updated.frontmatter));
    } catch (err) {
      // ERR-14: the Relationships panel is where the user acted, so the
      // failure is attributed to that field rather than only toasted.
      if (err instanceof ArchivedReferenceError) {
        error(res, err.message, 400, {
          code: "archived_reference",
          field: "relationships",
          data_state: "not_saved",
          recovery: { kind: "none" },
        });
        return;
      }
      if (err instanceof TaskUpdateError) {
        error(res, err.message, 400, { ...REJECTED_WRITE_NO_RETRY, field: "relationships" });
        return;
      }
      throw err;
    }
  };

  const handleUnlink: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const request = await parseJsonBody<LinkRequest>(req, res);
    // Without workflowConfig, findInverseType returns undefined and the
    // inverse branch is skipped: the forward edge goes and its inverse
    // is stranded permanently. handleLink above passes it; so do the CLI
    // and MCP (REL-C1).
    const wfConfig = await loadWorkflowConfig(locttDir);
    const task = await lookupTask(locttDir, ref);
    /**
     * REL-24. The target may be a task that no longer exists — that is
     * precisely the dangling edge the user is trying to clean up, and
     * resolving it first made the cleanup impossible: `lookupTask`
     * threw, the route answered 404 naming the id that is supposed to
     * be gone, and the row could not be removed from any surface.
     *
     * So a resolvable ref is still resolved to its id (a user may
     * unlink by key), and an unresolvable one is passed through as
     * written. Core tolerates it: `unlinkTask` reads the *source*
     * task's file for the forward edge and only reads the target for
     * the inverse, which it now skips when the target is gone.
     *
     * A ref that is neither a live task nor an id on this task's edges
     * still fails, from core, with "relationship ... does not exist on
     * task ..." — which is the honest message for it.
     */
    let targetId = request.target;
    try {
      targetId = (await lookupTask(locttDir, request.target)).frontmatter.id;
    } catch (err) {
      if (!(err instanceof TaskNotFoundError)) throw err;
    }
    // REL-44's "already gone" message needs no catch here: core throws
    // `RelationshipError`, which is a `LocttError`, and the route
    // wrapper turns those into a 400 carrying core's own sentence
    // ("relationship blocks -> <id> does not exist on task <id>").
    const updated = await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: targetId, workflowConfig: wfConfig });
    json(res, projectTaskFrontmatter(updated.frontmatter));
  };

  const handleAttachUpload: RouteHandler = async ({ req, res, url, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;

    const task = await lookupTask(locttDir, ref);

    const contentType = req.headers["content-type"] ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      error(res, "The upload was not sent in a form the server can read.", 400, {
        ...REJECTED_WRITE,
        recovery: { kind: "reload" },
        detail: `Content-Type must be multipart/form-data, got: ${contentType}`,
      });
      return;
    }

    const force = url.searchParams.get("force") === "true";

    const tmpParent = await mkdtemp(pathJoin(tmpdir(), "loctt-upload-"));
    let tmpFilePath: string | undefined;
    try {
      let parsed: ParsedFilePart;
      try {
        parsed = await parseMultipartFile(req, contentType, tmpParent, "file");
      } catch (parseErr) {
        // ERR-24: parsing failed before attachFile ran, so nothing was
        // written into tasks/<id>/attachments/ — the file was never
        // attached and the grid must not show a phantom entry.
        error(res, (parseErr as Error).message, 400, { ...REJECTED_WRITE, field: "file" });
        return;
      }
      tmpFilePath = parsed.tempPath;

      try {
        const result = await attachFile({
          locttDir,
          taskId: task.frontmatter.id,
          sourcePath: tmpFilePath,
          force,
        });
        json(res, {
          name: result.name,
          size: result.size,
          overwritten: result.overwritten,
          task_key: task.frontmatter.key,
        }, 201);
        return;
      } catch (err) {
        // A name collision: the existing attachment is untouched, and
        // the remedy is re-sending with `force`, not a bare retry.
        if (err instanceof AttachmentExistsError) {
          error(res, err.message, 409, {
            code: "conflict",
            field: "file",
            data_state: "not_saved",
            recovery: { kind: "none" },
          });
          return;
        }
        if (err instanceof AttachmentSourceError) {
          error(res, err.message, 400, { ...REJECTED_WRITE, field: "file" });
          return;
        }
        throw err;
      }
    } finally {
      await rm(tmpParent, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const handleGetAttachment: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res);
    if (ref === null) return;
    const rawName = decodeURIComponent(captures[1] ?? "");

    const task = await lookupTask(locttDir, ref);

    // assertSafeBasename rejects empty strings, separators, "..", null
    // bytes, etc.; it's the same guard `getAttachmentPath` uses.
    let filePath: string;
    try {
      filePath = getAttachmentPath(locttDir, task.frontmatter.id, rawName);
    } catch {
      error(res, "That attachment name is not usable.", 400, {
        code: "validation_failed",
        recovery: { kind: "none" },
      });
      return;
    }
    // A read, so no data_state claim (ERR-18). The list the user clicked
    // from may be stale, which is what reload fixes.
    const attachmentMissing = {
      code: "not_found",
      recovery: { kind: "reload" },
    } as const satisfies Omit<Partial<ErrorResponse>, "message">;
    let fileStat;
    try {
      fileStat = await fsStat(filePath);
    } catch {
      error(res, `"${rawName}" is not attached to this task.`, 404, attachmentMissing);
      return;
    }
    if (!fileStat.isFile()) {
      error(res, `"${rawName}" is not attached to this task.`, 404, attachmentMissing);
      return;
    }
    // Force download semantics: attachments are user-uploaded
    // content, never trusted markup. Octet-stream + nosniff stops
    // the browser from inferring a content type, and the
    // Content-Disposition: attachment header makes browsers offer
    // a save dialog rather than rendering inline.
    //
    // The UI gets the inferred MIME type via the `mime` field on
    // `AttachmentResponse` (returned by GET /api/tasks/:ref), and
    // dispatches client-side — e.g. fetching the bytes here and
    // wrapping them in a sandboxed `<img>`/`<video>`/`<audio>` blob
    // URL. Don't switch this endpoint to a derived Content-Type —
    // an inline image/svg+xml or text/html upload would be an XSS
    // hole even with nosniff.
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": contentDispositionAttachment(rawName),
      "Content-Length": String(fileStat.size),
    });
    const stream = createReadStream(filePath);
    stream.on("error", () => { try { res.end(); } catch { /* ignore */ } });
    stream.pipe(res);
  };

  const handleDeleteAttachment: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = requireValidRef(captures, res, 0, req);
    if (ref === null) return;
    const rawName = decodeURIComponent(captures[1] ?? "");
    try {
      assertSafeBasename(rawName);
    } catch {
      error(res, "That attachment name is not usable.", 400, REJECTED_WRITE_NO_RETRY);
      return;
    }

    const task = await lookupTask(locttDir, ref);

    try {
      await detachFile({
        locttDir,
        taskId: task.frontmatter.id,
        name: rawName,
      });
      res.writeHead(204);
      res.end();
    } catch (err) {
      // Already gone — the user's intent is satisfied, but the list they
      // clicked from is stale, so reload is the useful control.
      if (err instanceof AttachmentNotFoundError) {
        error(res, err.message, 404, {
          code: "not_found",
          data_state: "not_saved",
          recovery: { kind: "reload" },
        });
        return;
      }
      throw err;
    }
  };

  /**
   * Migration (C1). Was CLI-only: the schema banner told the user to
   * go run `loctt migrate` in a terminal, which is the one remedy the
   * UI could not offer for the state it was reporting.
   *
   * Two endpoints, preview then confirm. Migration rewrites task
   * frontmatter across the whole tracker and a step may be marked
   * risky, so a bare button would ask the user to accept an unseen
   * change.
   */
  const handleMigratePlan: RouteHandler = async ({ res, locttDir }) => {
    try {
      const plan = await planMigration(locttDir);
      const tasks = await loadAllTasks(locttDir);
      json(res, {
        from: plan.from,
        to: plan.to,
        steps: plan.steps.map(st => ({
          from: st.from,
          to: st.to,
          description: st.description,
          ...(st.risky === true ? { risky: true } : {}),
        })),
        taskCount: tasks.length,
      } satisfies MigrationPlanResponse);
    } catch (err) {
      // SchemaVersionError (missing file) and SchemaTooNewError both
      // mean "no migration can help", which is a 409 rather than a
      // server fault — the same code the schema guard uses. Planning is
      // a read, so it makes no data_state claim.
      error(res, (err as Error).message, 409, {
        code: "schema_mismatch",
        recovery: { kind: "none" },
      });
    }
  };

  const handleMigrate: RouteHandler = async ({ res, locttDir }) => {
    try {
      const result = await migrateToCurrent(locttDir);
      json(res, {
        from: result.from,
        to: result.to,
        steps: result.steps.map(st => ({
          from: st.from,
          to: st.to,
          description: st.description,
          ...(st.risky === true ? { risky: true } : {}),
        })),
        ...(result.backupPath !== undefined ? { backupPath: result.backupPath } : {}),
      } satisfies MigrateResponse);
    } catch (err) {
      // migrateToCurrent backs up before it rewrites and refuses outright
      // when no migration applies, but a failure partway through a
      // multi-step run cannot say how far it got — ERR-4 wants `unknown`
      // rather than a guess. The backup is the user's way to check.
      error(res, (err as Error).message, 409, {
        code: "schema_mismatch",
        data_state: "unknown",
        recovery: { kind: "command", command: "loctt migrate" },
      });
    }
  };

  const routes: readonly Route[] = [
    { method: "GET", pattern: "/api/info", handler: handleInfo },
    { method: "GET", pattern: "/api/migrate/plan", handler: handleMigratePlan },
    { method: "POST", pattern: "/api/migrate", handler: handleMigrate },
    { method: "GET", pattern: "/api/doctor", handler: handleDoctor },
    { method: "GET", pattern: "/api/config", handler: handleConfig },
    { method: "GET", pattern: "/api/projects", handler: handleListProjects },
    { method: "POST", pattern: "/api/tasks/bulk/set", handler: handleBulkSet },
    { method: "POST", pattern: "/api/tasks/bulk/archive", handler: handleBulkArchive },
    { method: "POST", pattern: "/api/tasks/bulk/delete", handler: handleBulkDelete },
    { method: "POST", pattern: "/api/tasks/bulk/move", handler: handleBulkMove },
    { method: "POST", pattern: "/api/tasks/bulk/link", handler: handleBulkLink },
    { method: "POST", pattern: "/api/projects", handler: handleCreateProject },
    { method: "PUT", pattern: PROJECT_KEY_RE, handler: handleUpdateProject },
    { method: "DELETE", pattern: PROJECT_KEY_RE, handler: handleDeleteProject },
    { method: "PUT", pattern: PROJECT_PREFIX_RE, handler: handleSetProjectPrefix },
    { method: "POST", pattern: "/api/projects/prefix-rename/complete", handler: handleCompletePrefixRename },
    { method: "GET", pattern: "/api/labels", handler: handleListLabels },
    { method: "POST", pattern: "/api/labels", handler: handleCreateLabel },
    { method: "PUT", pattern: LABEL_KEY_RE, handler: handleUpdateLabel },
    { method: "DELETE", pattern: LABEL_KEY_RE, handler: handleDeleteLabel },
    // Before LABEL_KEY_RE would matter only if that pattern were a
    // prefix match; it is anchored, so order is not load-bearing here.
    // Kept adjacent for readability.
    { method: "POST", pattern: LABEL_ARCHIVE_RE, handler: handleArchiveLabel },
    { method: "POST", pattern: LABEL_UNARCHIVE_RE, handler: handleUnarchiveLabel },
    { method: "GET", pattern: "/api/milestones", handler: handleListMilestones },
    { method: "POST", pattern: "/api/milestones", handler: handleCreateMilestone },
    { method: "PUT", pattern: MILESTONE_KEY_RE, handler: handleUpdateMilestone },
    { method: "DELETE", pattern: MILESTONE_KEY_RE, handler: handleDeleteMilestone },
    { method: "GET", pattern: "/api/calendar", handler: handleGetCalendar },
    { method: "PUT", pattern: "/api/calendar", handler: handlePutCalendar },
    { method: "GET", pattern: "/api/list-view", handler: handleGetListView },
    { method: "PUT", pattern: "/api/list-view", handler: handlePutListView },
    { method: "GET", pattern: SPRINT_BURNDOWN_RE, handler: handleSprintBurndown },
    // Before the bare `/api/workflow` entry: the router matches in
    // order and a bare-string pattern is compared whole, but keeping
    // the more specific path first is the habit that survives someone
    // later turning either into a prefix match.
    { method: "GET", pattern: "/api/workflow/usage", handler: handleWorkflowUsage },
    { method: "GET", pattern: "/api/workflow", handler: handleGetWorkflow },
    { method: "PUT", pattern: "/api/workflow", handler: handlePutWorkflow },
    { method: "POST", pattern: "/api/query/validate", handler: handleValidateQuery },
    { method: "GET", pattern: "/api/views", handler: handleListViews },
    { method: "POST", pattern: "/api/views", handler: handleCreateView },
    { method: "PUT", pattern: VIEW_REF_RE, handler: handleUpdateView },
    { method: "DELETE", pattern: VIEW_REF_RE, handler: handleDeleteView },
    { method: "POST", pattern: VIEW_UNARCHIVE_RE, handler: handleUnarchiveView },
    { method: "GET", pattern: "/api/sprints", handler: handleListSprints },
    { method: "POST", pattern: "/api/sprints", handler: handleCreateSprint },
    { method: "PUT", pattern: SPRINT_KEY_RE, handler: handleUpdateSprint },
    { method: "DELETE", pattern: SPRINT_KEY_RE, handler: handleDeleteSprint },
    { method: "GET", pattern: "/api/users", handler: handleListUsers },
    { method: "POST", pattern: "/api/users", handler: handleCreateUser },
    { method: "GET", pattern: "/api/user/current", handler: handleCurrentUser },
    { method: "GET", pattern: "/api/recents", handler: handleListRecents },
    { method: "POST", pattern: "/api/user/switch", handler: handleSwitchUser },
    { method: "PUT", pattern: USER_REF_RE, handler: handleUpdateUser },
    { method: "DELETE", pattern: USER_REF_RE, handler: handleDeleteUser },
    { method: "POST", pattern: USER_ARCHIVE_RE, handler: handleArchiveUser },
    { method: "POST", pattern: USER_UNARCHIVE_RE, handler: handleUnarchiveUser },
    { method: "GET", pattern: USER_AVATAR_RE, handler: handleGetAvatar },
    { method: "POST", pattern: USER_AVATAR_RE, handler: handleUploadAvatar },
    { method: "GET", pattern: TASK_COMMENTS_RE, handler: handleListComments },
    { method: "POST", pattern: TASK_COMMENTS_RE, handler: handlePostComment },
    { method: "PUT", pattern: TASK_COMMENT_ID_RE, handler: handleEditComment },
    { method: "DELETE", pattern: TASK_COMMENT_ID_RE, handler: handleDeleteComment },
    { method: "GET", pattern: "/api/search", handler: handleSearch },
    { method: "GET", pattern: "/api/tasks", handler: handleListTasks },
    { method: "GET", pattern: "/api/tasks/export", handler: handleExportTasks },
    { method: "POST", pattern: "/api/tasks", handler: handleCreateTask },
    { method: "GET", pattern: TASK_ACTIVITY_RE, handler: handleTaskActivity },
    { method: "POST", pattern: TASK_SET_RE, handler: handleSetField },
    { method: "POST", pattern: TASK_UNSET_RE, handler: handleUnsetField },
    { method: "POST", pattern: TASK_ARCHIVE_RE, handler: handleArchive },
    { method: "POST", pattern: TASK_UNARCHIVE_RE, handler: handleUnarchive },
    { method: "POST", pattern: TASK_DUPLICATE_RE, handler: handleDuplicate },
    { method: "POST", pattern: TASK_LINK_RE, handler: handleLink },
    { method: "POST", pattern: TASK_UNLINK_RE, handler: handleUnlink },
    { method: "POST", pattern: TASK_ATTACHMENTS_RE, handler: handleAttachUpload },
    { method: "GET", pattern: TASK_ATTACHMENT_ITEM_RE, handler: handleGetAttachment },
    { method: "DELETE", pattern: TASK_ATTACHMENT_ITEM_RE, handler: handleDeleteAttachment },
    { method: "GET", pattern: TASK_REF_RE, handler: handleGetTask },
    { method: "DELETE", pattern: TASK_REF_RE, handler: handleDeleteTask },
    { method: "POST", pattern: TASK_BOARD_RERANK_RE, handler: handleBoardRerank },
    { method: "POST", pattern: TASK_BOARD_MOVE_RE, handler: handleBoardMove },
    { method: "POST", pattern: TASK_SET_DATES_RE, handler: handleSetDates },
    { method: "POST", pattern: TASK_RELATIONSHIP_RERANK_RE, handler: handleRelationshipRerank },
    { method: "POST", pattern: TASK_BODY_RE, handler: handleReplaceBody },
    { method: "POST", pattern: TASK_BODY_APPEND_RE, handler: handleAppendBody },
    { method: "POST", pattern: "/api/init", handler: handleInit },
    { method: "POST", pattern: CONFIG_KEY_RE, handler: handleSetConfigValue },
    { method: "DELETE", pattern: CONFIG_KEY_RE, handler: handleUnsetConfigValue },
    { method: "GET", pattern: "/api/git/status", handler: handleGitStatus },
    { method: "POST", pattern: "/api/git/publish", handler: handleGitPublish },
    { method: "POST", pattern: "/api/git/sync", handler: handleGitSync },
    { method: "POST", pattern: "/api/git/enable", handler: handleGitEnable },
    { method: "POST", pattern: "/api/git/disable", handler: handleGitDisable },
    { method: "GET", pattern: "/api/user-settings", handler: handleGetUserSettings },
    { method: "PUT", pattern: "/api/user-settings", handler: handlePutUserSettings },
  ];

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    // Short per-request id used in error logs so a stack trace can be
    // correlated to the request that produced it. 8 hex chars is
    // plenty — these are log-correlation tokens for an operator
    // grepping recent output, not identifiers persisted anywhere.
    const reqId = randomBytes(4).toString("hex");

    if (!requireCsrfHeader(req, res)) return;

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;

    try {
      const locttDir = resolveLocttDir(root);

      // Boot guard for API routes. The web server is long-lived and
      // a `loctt migrate` may run mid-session in another terminal,
      // so we re-check on every API request rather than once at
      // boot. Static asset routes are exempt — they don't read any
      // tracker data.
      // `init` is exempt — it creates the tracker and runs against a
      // fresh directory by definition. If the tracker already exists
      // it'll fail through its own existence check inside initLoctt.
      if (
        path.startsWith("/api/") &&
        path !== "/api/init" &&
        // Migration is the remedy for a mismatch, so it cannot be
        // gated behind one. Both endpoints re-check the version
        // themselves and refuse when no migration applies.
        path !== "/api/migrate" &&
        path !== "/api/migrate/plan" &&
        (await trackerDirExists(locttDir))
      ) {
        try {
          await requireSupportedSchema(locttDir);
        } catch (err) {
          if (err instanceof SchemaVersionError || err instanceof SchemaTooNewError) {
            // Nothing ran, so no write was attempted regardless of method
            // (ERR-18). `loctt migrate` is the fix and only helps for the
            // too-old case; a too-new tracker needs a newer LocTT, which
            // no command here can produce (ERR-15).
            const isWrite = req.method !== "GET" && req.method !== "HEAD";
            // Only offer `loctt migrate` when it can actually help.
            // A too-new tracker needs a newer LocTT; a missing
            // .schema-version or an interrupted migration needs
            // something else again, and each carries the sentence that
            // says what (ONB-C6). Naming a command that refuses costs
            // the user a round trip to find out.
            const recovery = err instanceof SchemaTooNewError
              ? { kind: "none" as const }
              : err instanceof SchemaUnmigratableError
                ? { kind: "none" as const }
                : { kind: "command" as const, command: "loctt migrate" };
            // The kind, not just the message. The guard refuses
            // `/api/info` too, so the surface cannot learn it from the
            // payload it just blocked — and without it the client was
            // left recovering the kind by matching the message text,
            // which turns a copy edit into a behaviour change.
            // SHL-13/34-36/38 and XS-33/34/35 all need the four kinds
            // told apart while the guard is refusing.
            const schemaStatus = await computeSchemaStatus(locttDir);
            error(res, err.message, 409, {
              code: "schema_mismatch",
              schema_status: schemaStatus,
              ...(isWrite ? { data_state: "not_saved" as const } : {}),
              recovery,
              ...(err instanceof SchemaUnmigratableError ? { detail: err.remedy } : {}),
            });
            return;
          }
          throw err;
        }

        // Finish an interrupted prefix rename before any handler reads a
        // task key. Silent on success; a failure is a 500 rather than a
        // degraded response, because every key the request would go on
        // to return could be stale.
        const { error: recoveryError } =
          await recoverInterruptedPrefixRename(locttDir);
        if (recoveryError) {
          const isWrite = req.method !== "GET" && req.method !== "HEAD";
          error(
            res,
            `A project prefix rename was interrupted and could not be ` +
            `finished, so task keys may be inconsistent.`,
            500,
            {
              code: "io_failed",
              ...(isWrite ? { data_state: "not_saved" as const } : {}),
              recovery: { kind: "command", command: "loctt doctor" },
              detail: recoveryError.message,
            },
          );
          return;
        }
      }

      for (const route of routes) {
        if (req.method !== route.method) continue;
        const captures = matchPattern(route.pattern, path);
        if (!captures) continue;
        await route.handler({ req, res, url, locttDir, captures });
        return;
      }

      if (clientDir && !path.startsWith("/api/")) {
        const served = await tryServeStatic(req, res, clientDir, path);
        if (served) return;
      }

      // A route the server does not have. Nothing ran, so a write that
      // lands here never touched disk (ERR-18).
      error(res, `There is nothing at ${path}.`, 404, {
        code: "not_found",
        ...(req.method === "GET" || req.method === "HEAD"
          ? {}
          : { data_state: "not_saved" as const }),
        recovery: { kind: "none" },
      });
    } catch (err) {
      if (err instanceof HandledRequestError) {
        // parseJsonBody already wrote a 400 — bail silently.
        return;
      }
      if (err instanceof TaskNotFoundError) {
        // ERR-7: the row the user clicked is stale — the task was deleted
        // from the CLI or another surface. Reload is what reconciles the
        // list with disk. The lookup precedes every write, so nothing was
        // saved.
        const isWrite = req.method !== "GET" && req.method !== "HEAD";
        error(res, err.message, 404, {
          code: "not_found",
          ...(isWrite ? { data_state: "not_saved" as const } : {}),
          recovery: { kind: "reload" },
        });
        return;
      }
      if (err instanceof BodyTooLargeError) {
        // Force-close the connection on overflow: the request body
        // was paused mid-read (so the response could write back),
        // which leaves the socket's receive buffer stuck. A
        // misbehaving / malicious client could otherwise sit on a
        // half-open connection until the OS keepalive timeout —
        // setting Connection: close and destroying the request
        // stream guarantees the socket cleans up promptly.
        res.setHeader("Connection", "close");
        // Rejected while still reading the body, so nothing reached disk.
        // Retrying the same oversized payload cannot succeed (ERR-15).
        error(res, "That was too large to send in one request.", 413, {
          code: "validation_failed",
          data_state: "not_saved",
          recovery: { kind: "none" },
          detail: err.message,
        });
        req.destroy();
        return;
      }
      // Tag the log line with method+path+req-id so an operator
      // looking at a stack trace can find which request triggered it.
      console.error(`[req ${reqId}] ${req.method ?? "?"} ${path}`, err);
      // ERR-30: an unattributable failure may say so, but must still state
      // what was attempted, what state the data is in, and what to do
      // next. A read never put data at stake; a write that died in here
      // did so at an unknown point, so `unknown` is the honest claim
      // rather than a guess in either direction.
      const method = req.method ?? "GET";
      const isRead = method === "GET" || method === "HEAD";
      // A filesystem failure the user can act on — an unwritable
      // .loctt/, a full disk. ERR-31 forbids reporting a knowable cause
      // as unknown, and ERR-11/ERR-12 want these named: only the user
      // can fix a permission or free up space.
      // Core attributed it, so use its attribution rather than
      // flattening to `unknown`. A schema problem in workflow.yaml
      // already names the file, the field path and what was expected
      // (ERR-10); reporting it as an unexplained server failure threw
      // all of that away at the last step. V1: core states its own
      // cause and the surface renders it.
      if (err instanceof LocttError) {
        const env = err.toEnvelope();
        error(res, env.message, statusForCode(err.code), env);
        return;
      }
      if (err instanceof FsAccessError) {
        error(res, err.message, 500, {
          code: "io_failed",
          ...(isRead ? {} : { data_state: "not_saved" as const }),
          recovery: { kind: "retry" },
          detail: `${err.code}: ${err.path}`,
        });
        return;
      }
      error(res, `The server failed while handling ${method} ${path}.`, 500, {
        code: "unknown",
        ...(isRead ? {} : { data_state: "unknown" as const }),
        recovery: { kind: isRead ? "retry" : "reload" },
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    start: () => new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    }),
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    }),
    port,
    server,
  };
}
