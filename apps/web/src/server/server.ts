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
  ListViewConfigSchema,
  PostCommentRequestSchema,
  projectTaskFrontmatter,
  PutWorkflowRequestSchema,
} from "@loctt/contracts";
import {
  appendTaskBody,
  applyWorkflowEdit,
  ArchivedReferenceError,
  archiveTask,
  archiveUser,
  assertSafeBasename,
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
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
  FsAccessError,
  getAttachmentPath,
  getCurrentUser,
  getGitStatus,
  getTrackerInfo,
  GitConflictError,
  initLoctt,
  LabelError,
  linkTask,
  listComments,
  listTasks,
  loadAllTasks,
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
  planMigration,
  postComment,
  type Progress,
  ProjectError,
  publish,
  pushRecent,
  QueryValidationError,
  readBurndownSeries,
  readHistory,
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
  setProjectPrefix,
  SprintError,
  sprintProgress,
  switchCurrentUser,
  sync,
  TaskNotFoundError,
  type TaskReferenceKind,
  TaskUpdateError,
  todayInZone,
  TokenizeError,
  unarchiveTask,
  unarchiveUser,
  unlinkTask,
  unsetConfigValue,
  unsetField,
  updateUser,
  UserError,
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
async function workspaceToday(locttDir: string): Promise<string> {
  try {
    return todayInZone((await loadCalendarConfig(locttDir)).timezone);
  } catch {
    return todayInZone();
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
const USER_REF_RE = /^\/api\/users\/([^/]+)$/;
const USER_ARCHIVE_RE = /^\/api\/users\/([^/]+)\/archive$/;
const USER_UNARCHIVE_RE = /^\/api\/users\/([^/]+)\/unarchive$/;
const USER_AVATAR_RE = /^\/api\/users\/([^/]+)\/avatar$/;
const TASK_ACTIVITY_RE = /^\/api\/tasks\/([^/]+)\/activity$/;
const TASK_COMMENTS_RE = /^\/api\/tasks\/([^/]+)\/comments$/;
const TASK_COMMENT_ID_RE = /^\/api\/tasks\/([^/]+)\/comments\/([^/]+)$/;
const TASK_SET_RE = /^\/api\/tasks\/([^/]+)\/set$/;
const TASK_UNSET_RE = /^\/api\/tasks\/([^/]+)\/unset$/;
const TASK_ARCHIVE_RE = /^\/api\/tasks\/([^/]+)\/archive$/;
const TASK_UNARCHIVE_RE = /^\/api\/tasks\/([^/]+)\/unarchive$/;
const TASK_LINK_RE = /^\/api\/tasks\/([^/]+)\/link$/;
const TASK_UNLINK_RE = /^\/api\/tasks\/([^/]+)\/unlink$/;
const TASK_ATTACHMENTS_RE = /^\/api\/tasks\/([^/]+)\/attachments$/;
const TASK_ATTACHMENT_ITEM_RE = /^\/api\/tasks\/([^/]+)\/attachments\/([^/]+)$/;
const TASK_BOARD_RERANK_RE = /^\/api\/tasks\/([^/]+)\/board-rerank$/;
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
      today: await workspaceToday(locttDir),
    };
    json(res, response);
  };

  const handleDoctor: RouteHandler = async ({ res }) => {
    const checks = await runDoctor(root);
    json(res, checks as DoctorCheckResponse[]);
  };

  const handleListViews: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadQueriesConfig(locttDir);
    json(res, cfg);
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

  const handleDeleteView: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    try {
      await deleteView(locttDir, ref);
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
    json(res, {
      ...paginated(cfg.projects, page.offset, page.limit),
      default: cfg.default ?? null,
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
      make_default?: boolean;
    }>(req, res);
    try {
      const created = await createProject(locttDir, {
        name: request.name,
        prefix: request.prefix,
      });
      if (request.make_default === true) {
        await setDefaultProject(locttDir, created.id);
      }
      json(res, created, 201);
    } catch (err) {
      // A create rejection is almost always the prefix (taken, or badly
      // shaped), which is the field the UI can mark (ERR-14).
      if (err instanceof ProjectError) {
        error(res, err.message, 400, { ...REJECTED_WRITE, field: "prefix" });
        return;
      }
      throw err;
    }
  };

  const handleUpdateProject: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const id = captures[0] ?? "";
    const request = await parseJsonBody<{ name?: string; default?: boolean }>(req, res);
    try {
      if (request.name !== undefined) {
        await editProject(locttDir, id, { name: request.name });
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
    try {
      const result = await deleteProject(locttDir, id, {
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
    try {
      const result = await deleteMilestone(locttDir, id, {
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
    try {
      const result = await deleteLabel(locttDir, id, {
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
    const r = await parseJsonBody<{ body: string }>(req, res);
    if (typeof r.body !== "string") {
      error(res, "The description could not be read.", 400, { ...REJECTED_WRITE, field: "body" });
      return;
    }
    await writeTaskBody(locttDir, task.frontmatter.id, r.body);
    json(res, { ok: true });
  };

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
    const tasks = await loadAllTasks(locttDir);
    const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);

    const view = url.searchParams.get("view") ?? undefined;
    const includeArchived = url.searchParams.get("archived") === "true";
    // Fold the free-text `query` and the structured filter params
    // (project/status/priority/type/assignee/…, plus custom
    // `field.<key>`) into one DSL query, AND-ing every active filter.
    // When a saved view is in play we leave its query untouched (views
    // are authored as-is) and apply `?project=` via core's dedicated
    // structured project option instead.
    const baseQuery = url.searchParams.get("query") ?? undefined;
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
    const sortField = url.searchParams.get("sort") ?? undefined;
    const dirParam = url.searchParams.get("dir");
    if (dirParam !== null && dirParam !== "asc" && dirParam !== "desc") {
      error(res, "Sort direction must be ascending or descending.", 400, {
        code: "validation_failed",
        field: "dir",
        recovery: { kind: "reload" },
      });
      return;
    }
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

    let result;
    try {
      result = listTasks({
        tasks,
        options: params,
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
    json(res, paginated(frontmatters, page.offset, page.limit));
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

    const tasks = await loadAllTasks(locttDir);
    const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);
    const baseQuery = url.searchParams.get("query") ?? undefined;
    const view = url.searchParams.get("view") ?? undefined;
    const projectFilter = url.searchParams.get("project") ?? undefined;
    // Export mirrors the list view's filter resolution so a CSV/JSON
    // reflects exactly the rows the user is looking at. (archived is
    // applied below via filterForExport, so it's excluded here.)
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
    if (format === "json") {
      const body = exportTasksToJSON(filtered, opts);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="loctt-tasks.json"',
      });
      res.end(body);
    } else {
      const body = exportTasksToCSV(filtered, opts);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="loctt-tasks.csv"',
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
        error(res, err.message, 400, REJECTED_WRITE);
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
      attachments: model.attachments.map(a => ({
        name: a.name,
        size: a.size,
        ...(a.mime !== undefined ? { mime: a.mime } : {}),
      })),
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
    const entries = await readHistory(locttDir, task.frontmatter.id);

    // Copy before reversing — if `readHistory` ever caches the
    // returned array (or another caller observes the same reference),
    // an in-place reverse would corrupt their view.
    const reversed = [...entries].reverse();

    const page = parsePagination(url, res);
    if (page === null) return;
    const sliced = reversed.slice(page.offset, page.offset + page.limit);
    json(res, { entries: sliced, total: reversed.length });
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
      error(res, (err as Error).message, 400, { ...REJECTED_WRITE, field: "body" });
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
      error(res, (err as Error).message, 400, {
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
    const target = await lookupTask(locttDir, request.target);
    const updated = await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: target.frontmatter.id, workflowConfig: wfConfig });
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
    { method: "GET", pattern: "/api/milestones", handler: handleListMilestones },
    { method: "POST", pattern: "/api/milestones", handler: handleCreateMilestone },
    { method: "PUT", pattern: MILESTONE_KEY_RE, handler: handleUpdateMilestone },
    { method: "DELETE", pattern: MILESTONE_KEY_RE, handler: handleDeleteMilestone },
    { method: "GET", pattern: "/api/calendar", handler: handleGetCalendar },
    { method: "PUT", pattern: "/api/calendar", handler: handlePutCalendar },
    { method: "GET", pattern: "/api/list-view", handler: handleGetListView },
    { method: "PUT", pattern: "/api/list-view", handler: handlePutListView },
    { method: "GET", pattern: SPRINT_BURNDOWN_RE, handler: handleSprintBurndown },
    { method: "GET", pattern: "/api/workflow", handler: handleGetWorkflow },
    { method: "PUT", pattern: "/api/workflow", handler: handlePutWorkflow },
    { method: "GET", pattern: "/api/views", handler: handleListViews },
    { method: "POST", pattern: "/api/views", handler: handleCreateView },
    { method: "PUT", pattern: VIEW_REF_RE, handler: handleUpdateView },
    { method: "DELETE", pattern: VIEW_REF_RE, handler: handleDeleteView },
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
    { method: "POST", pattern: TASK_LINK_RE, handler: handleLink },
    { method: "POST", pattern: TASK_UNLINK_RE, handler: handleUnlink },
    { method: "POST", pattern: TASK_ATTACHMENTS_RE, handler: handleAttachUpload },
    { method: "GET", pattern: TASK_ATTACHMENT_ITEM_RE, handler: handleGetAttachment },
    { method: "DELETE", pattern: TASK_ATTACHMENT_ITEM_RE, handler: handleDeleteAttachment },
    { method: "GET", pattern: TASK_REF_RE, handler: handleGetTask },
    { method: "DELETE", pattern: TASK_REF_RE, handler: handleDeleteTask },
    { method: "POST", pattern: TASK_BOARD_RERANK_RE, handler: handleBoardRerank },
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
            error(res, err.message, 409, {
              code: "schema_mismatch",
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
