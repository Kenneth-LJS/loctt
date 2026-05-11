import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat as fsLstat, mkdtemp, rm, stat as fsStat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join as pathJoin, normalize as pathNormalize, resolve as pathResolve, sep as pathSep } from "node:path";

import type {
  ConfigResponse,
  CreateTaskRequest,
  DoctorCheckResponse,
  LinkRequest,
  ListTasksRequest,
  TaskResponse,
  TrackerInfoResponse,
  UpdateTaskRequest,
} from "@loctt/contracts";
import { CalendarConfigSchema, ListViewConfigSchema } from "@loctt/contracts";
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
  buildShowModel,
  BurndownError,
  ConfigRouterError,
  createLabel,
  createMilestone,
  createProject,
  createSprint,
  createTask,
  createUser,
  createView,
  deleteLabel,
  deleteMilestone,
  deleteProject,
  deleteSprint,
  deleteTask,
  deleteUser,
  deleteView,
  detachFile,
  disableGit,
  editLabel,
  editMilestone,
  editProject,
  editSprint,
  editView,
  enableGit,
  getAttachmentPath,
  getCurrentUser,
  getGitStatus,
  getTrackerInfo,
  initLoctt,
  LabelError,
  linkTask,
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
  lookupTask,
  MAX_AVATAR_BYTES,
  MilestoneError,
  ProjectError,
  publish,
  readBurndownSeries,
  readHistory,
  reorderBoardRank,
  ReorderError,
  reorderRelationship,
  requireSupportedSchema,
  resolveLocttDir,
  resolveProjectKey,
  resolveUserRef,
  runDoctor,
  saveCalendarConfig,
  saveListViewConfig,
  saveState,
  saveUserSettings,
  SchemaTooNewError,
  SchemaVersionError,
  setConfigValue,
  setDefaultProject,
  setField,
  SprintError,
  switchCurrentUser,
  sync,
  TaskNotFoundError,
  TaskUpdateError,
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

import type { ParsedFilePart } from "./multipart.js";
import { parseMultipartFile } from "./multipart.js";

const DEFAULT_PORT = 4321;

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

function error(res: import("node:http").ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

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
    error(res, `invalid JSON body: ${(err as Error).message}`, 400);
    throw new HandledRequestError();
  }
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
  if (url.searchParams.has("limit")) {
    const raw = url.searchParams.get("limit") ?? "";
    if (raw.length === 0) {
      error(res, "limit must be a non-negative integer", 400);
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      error(res, "limit must be a non-negative integer", 400);
      return null;
    }
    if (n > MAX_PAGE_LIMIT) {
      error(res, `limit must be at most ${MAX_PAGE_LIMIT}`, 400);
      return null;
    }
    limit = n;
  }
  if (url.searchParams.has("offset")) {
    const raw = url.searchParams.get("offset") ?? "";
    if (raw.length === 0) {
      error(res, "offset must be a non-negative integer", 400);
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      error(res, "offset must be a non-negative integer", 400);
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
const TASK_REF_RE = /^\/api\/tasks\/([^/]+)$/;
const PROJECT_KEY_RE = /^\/api\/projects\/([^/]+)$/;
const LABEL_KEY_RE = /^\/api\/labels\/([^/]+)$/;
const MILESTONE_KEY_RE = /^\/api\/milestones\/([^/]+)$/;
const SPRINT_KEY_RE = /^\/api\/sprints\/([^/]+)$/;
const VIEW_REF_RE = /^\/api\/views\/([^/]+)$/;
const USER_REF_RE = /^\/api\/users\/([^/]+)$/;
const USER_ARCHIVE_RE = /^\/api\/users\/([^/]+)\/archive$/;
const USER_UNARCHIVE_RE = /^\/api\/users\/([^/]+)\/unarchive$/;
const USER_AVATAR_RE = /^\/api\/users\/([^/]+)\/avatar$/;
const TASK_ACTIVITY_RE = /^\/api\/tasks\/([^/]+)\/activity$/;
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
  const requested = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
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
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on("error", reject);
    stream.on("end", () => resolve());
    stream.pipe(res);
  });
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
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing X-Loctt-Client header" }));
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
        const primaryKey = projects.default ?? projects.projects[0]?.key;
        if (primaryKey !== undefined) {
          primaryEntry = info.state.keys[primaryKey];
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
    const r = await parseJsonBody<Parameters<typeof createView>[1]>(req, res);
    try {
      const created = await createView(locttDir, r);
      json(res, created, 201);
    } catch (err) {
      if (err instanceof ViewError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUpdateView: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const r = await parseJsonBody<Parameters<typeof editView>[2]>(req, res);
    try {
      const updated = await editView(locttDir, ref, r);
      json(res, updated);
    } catch (err) {
      if (err instanceof ViewError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleDeleteView: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    try {
      await deleteView(locttDir, ref);
      json(res, { deleted: ref });
    } catch (err) {
      if (err instanceof ViewError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleGetWorkflow: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadWorkflowConfig(locttDir);
    json(res, cfg);
  };

  const handlePutWorkflow: RouteHandler = async ({ req, res, locttDir }) => {
    const payload = await parseJsonBody<{
      workflow: Parameters<typeof applyWorkflowEdit>[1];
      remap?: Parameters<typeof applyWorkflowEdit>[2];
    }>(req, res);
    try {
      const result = await applyWorkflowEdit(locttDir, payload.workflow, payload.remap ?? {});
      json(res, result);
    } catch (err) {
      error(res, (err as Error).message, 400);
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
    json(res, {
      ...paginated(cfg.projects, page.offset, page.limit),
      default: cfg.default ?? null,
    });
  };

  const handleCreateProject: RouteHandler = async ({ req, res, locttDir }) => {
    const request = await parseJsonBody<{
      key: string;
      label: string;
      prefix: string;
      make_default?: boolean;
    }>(req, res);
    try {
      await createProject(locttDir, {
        key: request.key,
        label: request.label,
        prefix: request.prefix,
      });
      if (request.make_default === true) {
        await setDefaultProject(locttDir, request.key);
      }
      const cfg = await loadProjectsConfig(locttDir);
      const created = assertPersisted(
        cfg.projects.find(p => p.key === request.key),
        "project",
        request.key,
      );
      json(res, created, 201);
    } catch (err) {
      if (err instanceof ProjectError) {
        error(res, err.message, 400);
        return;
      }
      throw err;
    }
  };

  const handleUpdateProject: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const request = await parseJsonBody<{ label?: string; default?: boolean }>(req, res);
    try {
      if (request.label !== undefined) {
        await editProject(locttDir, key, { label: request.label });
      }
      if (request.default === true) {
        await setDefaultProject(locttDir, key);
      } else if (request.default === false) {
        // Clear default only when it's currently this project.
        const cfg = await loadProjectsConfig(locttDir);
        if (cfg.default === key) await setDefaultProject(locttDir, null);
      }
      const cfg = await loadProjectsConfig(locttDir);
      const updated = assertPersisted(
        cfg.projects.find(p => p.key === key),
        "project",
        key,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof ProjectError) {
        error(res, err.message, 400);
        return;
      }
      throw err;
    }
  };

  const handleDeleteProject: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    try {
      const result = await deleteProject(locttDir, key, {
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: key, remappedTaskCount: result.remappedTaskCount });
    } catch (err) {
      if (err instanceof ProjectError) {
        error(res, err.message, 400);
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
      error(res, `invalid calendar config: ${parsed.error.issues.map(i => i.message).join("; ")}`, 400);
      return;
    }
    try {
      await saveCalendarConfig(locttDir, parsed.data);
      json(res, parsed.data);
    } catch (err) {
      error(res, (err as Error).message, 400);
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
      if (err instanceof BurndownError) { error(res, err.message, 404); return; }
      throw err;
    }
  };

  const handlePutListView: RouteHandler = async ({ req, res, locttDir }) => {
    const raw = await parseJsonBody<unknown>(req, res);
    const parsed = ListViewConfigSchema.safeParse(raw);
    if (!parsed.success) {
      error(res, `invalid list-view config: ${parsed.error.issues.map(i => i.message).join("; ")}`, 400);
      return;
    }
    try {
      await saveListViewConfig(locttDir, parsed.data);
      json(res, parsed.data);
    } catch (err) {
      error(res, (err as Error).message, 400);
    }
  };

  const handleListSprints: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const cfg = await loadSprintsConfig(locttDir);
    json(res, paginated(cfg.sprints, page.offset, page.limit));
  };

  const handleCreateSprint: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBody<{
      key: string;
      label: string;
      start_date: string;
      end_date: string;
      state: "active" | "completed" | "future";
      goal?: string;
    }>(req, res);
    try {
      await createSprint(locttDir, {
        key: r.key,
        label: r.label,
        start_date: r.start_date,
        end_date: r.end_date,
        state: r.state,
        ...(r.goal !== undefined ? { goal: r.goal } : {}),
      });
      const cfg = await loadSprintsConfig(locttDir);
      const created = assertPersisted(
        cfg.sprints.find(s => s.key === r.key),
        "sprint",
        r.key,
      );
      json(res, created, 201);
    } catch (err) {
      if (err instanceof SprintError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUpdateSprint: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const r = await parseJsonBody<{
      label?: string;
      start_date?: string;
      end_date?: string;
      state?: "active" | "completed" | "future";
      goal?: string | null;
    }>(req, res);
    try {
      await editSprint(locttDir, key, {
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...(r.start_date !== undefined ? { start_date: r.start_date } : {}),
        ...(r.end_date !== undefined ? { end_date: r.end_date } : {}),
        ...(r.state !== undefined ? { state: r.state } : {}),
        ...("goal" in r ? { goal: r.goal } : {}),
      });
      const cfg = await loadSprintsConfig(locttDir);
      const updated = assertPersisted(
        cfg.sprints.find(s => s.key === key),
        "sprint",
        key,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof SprintError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleDeleteSprint: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    try {
      const result = await deleteSprint(locttDir, key, {
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: key, ...result });
    } catch (err) {
      if (err instanceof SprintError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleListMilestones: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const cfg = await loadMilestonesConfig(locttDir);
    json(res, paginated(cfg.milestones, page.offset, page.limit));
  };

  const handleCreateMilestone: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBody<{ key: string; label: string; target_date?: string }>(req, res);
    try {
      await createMilestone(locttDir, {
        key: r.key,
        label: r.label,
        ...(r.target_date !== undefined ? { target_date: r.target_date } : {}),
      });
      const cfg = await loadMilestonesConfig(locttDir);
      const created = assertPersisted(
        cfg.milestones.find(m => m.key === r.key),
        "milestone",
        r.key,
      );
      json(res, created, 201);
    } catch (err) {
      if (err instanceof MilestoneError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUpdateMilestone: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const r = await parseJsonBody<{
      label?: string;
      target_date?: string | null;
      archived?: boolean;
    }>(req, res);
    try {
      await editMilestone(locttDir, key, {
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...("target_date" in r ? { target_date: r.target_date } : {}),
        ...(r.archived !== undefined ? { archived: r.archived } : {}),
      });
      const cfg = await loadMilestonesConfig(locttDir);
      const updated = assertPersisted(
        cfg.milestones.find(m => m.key === key),
        "milestone",
        key,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof MilestoneError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleDeleteMilestone: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    try {
      const result = await deleteMilestone(locttDir, key, {
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: key, ...result });
    } catch (err) {
      if (err instanceof MilestoneError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleListLabels: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const cfg = await loadLabelsConfig(locttDir);
    json(res, paginated(cfg.labels, page.offset, page.limit));
  };

  const handleCreateLabel: RouteHandler = async ({ req, res, locttDir }) => {
    const r = await parseJsonBody<{ key: string; label: string; color?: string }>(req, res);
    try {
      await createLabel(locttDir, {
        key: r.key,
        label: r.label,
        ...(r.color !== undefined ? { color: r.color } : {}),
      });
      const cfg = await loadLabelsConfig(locttDir);
      const created = assertPersisted(
        cfg.labels.find(l => l.key === r.key),
        "label",
        r.key,
      );
      json(res, created, 201);
    } catch (err) {
      if (err instanceof LabelError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUpdateLabel: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const r = await parseJsonBody<{ label?: string; color?: string | null }>(req, res);
    try {
      await editLabel(locttDir, key, {
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...("color" in r ? { color: r.color } : {}),
      });
      const cfg = await loadLabelsConfig(locttDir);
      const updated = assertPersisted(
        cfg.labels.find(l => l.key === key),
        "label",
        key,
      );
      json(res, updated);
    } catch (err) {
      if (err instanceof LabelError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleDeleteLabel: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const remapTo = url.searchParams.get("remap_to") ?? undefined;
    try {
      const result = await deleteLabel(locttDir, key, {
        ...(remapTo !== undefined ? { remapTo } : {}),
      });
      json(res, { deleted: key, ...result });
    } catch (err) {
      if (err instanceof LabelError) { error(res, err.message, 400); return; }
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
    if (!current) { error(res, "no users registered", 404); return; }
    json(res, current);
  };

  const handleSwitchUser: RouteHandler = async ({ req, res, locttDir }) => {
    const request = await parseJsonBody<{ ref: string }>(req, res);
    if (typeof request.ref !== "string" || request.ref.length === 0) {
      error(res, "ref must be a non-empty string", 400);
      return;
    }
    try {
      const target = await resolveUserRef(locttDir, request.ref);
      await switchCurrentUser(locttDir, target.id);
      json(res, { current: target.id });
    } catch (err) {
      if (err instanceof UserError) { error(res, err.message, 400); return; }
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
    if (request === undefined) return;
    if (typeof request.name !== "string" || request.name.length === 0) {
      error(res, "name must be a non-empty string", 400);
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
      if (err instanceof UserError) { error(res, err.message, 400); return; }
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
    if (request === undefined) return;
    try {
      const target = await resolveUserRef(locttDir, ref);
      const updated = await updateUser(locttDir, target.id, {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...("email" in request ? { email: request.email } : {}),
        ...(request.timezone !== undefined ? { timezone: request.timezone } : {}),
      });
      json(res, updated);
    } catch (err) {
      if (err instanceof UserError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUploadAvatar: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const contentType = req.headers["content-type"] ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      error(res, "Content-Type must be multipart/form-data", 400);
      return;
    }

    let target;
    try {
      target = await resolveUserRef(locttDir, ref);
    } catch (err) {
      if (err instanceof UserError) { error(res, err.message, 404); return; }
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
        error(res, (parseErr as Error).message, 400);
        return;
      }
      try {
        const updated = await updateUser(locttDir, target.id, {
          avatarSourcePath: parsed.tempPath,
        });
        json(res, updated);
      } catch (err) {
        if (err instanceof UserError) { error(res, err.message, 400); return; }
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
      if (err instanceof UserError) { error(res, err.message, 400); return; }
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
      if (err instanceof UserError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleDeleteUser: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.searchParams.get("confirm") !== "true") {
      error(res, "user delete is permanent; pass ?confirm=true to proceed", 400);
      return;
    }
    const remapToRef = url.searchParams.get("remap_to") ?? undefined;
    const unassign = url.searchParams.get("unassign") === "true";
    if (remapToRef !== undefined && unassign) {
      error(res, "remap_to and unassign are mutually exclusive", 400);
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
      if (err instanceof UserError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleGetAvatar: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    try {
      const target = await resolveUserRef(locttDir, ref);
      if (!target.avatar) { error(res, "no avatar", 404); return; }
      // Defense-in-depth: target.avatar comes from a user-edited
      // YAML file. Reject anything that isn't a plain basename
      // before joining into a filesystem path.
      try {
        assertSafeBasename(target.avatar);
      } catch {
        error(res, "invalid avatar reference", 400);
        return;
      }
      const avatarPath = pathJoin(locttDir, "users", target.id, target.avatar);
      // lstat (not stat) so a symlink at avatar.jpg doesn't smuggle
      // out an arbitrary file. Avatars are written atomically by
      // copyAvatar so this can only fire on a hand-crafted symlink,
      // but the check is cheap and the failure mode is severe.
      const stat = await fsLstat(avatarPath);
      if (stat.isSymbolicLink()) { error(res, "invalid avatar reference", 400); return; }
      if (!stat.isFile()) { error(res, "no avatar", 404); return; }
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
      if (err instanceof UserError) { error(res, err.message, 404); return; }
      throw err;
    }
  };

  const handleReplaceBody: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    const r = await parseJsonBody<{ body: string }>(req, res);
    if (typeof r.body !== "string") { error(res, "body must be a string", 400); return; }
    await writeTaskBody(locttDir, task.frontmatter.id, r.body);
    json(res, { ok: true });
  };

  const handleAppendBody: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    const r = await parseJsonBody<{ text: string }>(req, res);
    if (typeof r.text !== "string") { error(res, "text must be a string", 400); return; }
    await appendTaskBody(locttDir, task.frontmatter.id, r.text);
    json(res, { ok: true });
  };

  const handleInit: RouteHandler = async ({ req, res }) => {
    const r = await parseJsonBody<Parameters<typeof initLoctt>[1]>(req, res);
    try {
      const result = await initLoctt(root, r);
      json(res, { locttDir: result.locttDir, created: result.created.length }, 201);
    } catch (err) {
      error(res, (err as Error).message, 400);
    }
  };

  const handleSetConfigValue: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const r = await parseJsonBody<{ value: unknown }>(req, res);
    try {
      await setConfigValue({ locttDir, root }, key, String(r.value));
      json(res, { key });
    } catch (err) {
      if (err instanceof ConfigRouterError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUnsetConfigValue: RouteHandler = async ({ res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    try {
      await unsetConfigValue({ locttDir, root }, key);
      json(res, { key });
    } catch (err) {
      if (err instanceof ConfigRouterError) { error(res, err.message, 400); return; }
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
      error(res, (err as Error).message, 400);
    }
  };

  const handleGitSync: RouteHandler = async ({ res, locttDir }) => {
    try {
      const result = await sync(locttDir, root);
      json(res, result);
    } catch (err) {
      error(res, (err as Error).message, 400);
    }
  };

  const handleGitEnable: RouteHandler = async ({ res, locttDir }) => {
    try {
      await enableGit(locttDir, root);
      json(res, { enabled: true });
    } catch (err) {
      error(res, (err as Error).message, 400);
    }
  };

  const handleGitDisable: RouteHandler = async ({ res, locttDir }) => {
    try {
      await disableGit(locttDir);
      json(res, { enabled: false });
    } catch (err) {
      error(res, (err as Error).message, 400);
    }
  };

  const handleGetUserSettings: RouteHandler = async ({ res, locttDir }) => {
    const current = await getCurrentUser(locttDir);
    if (!current) { error(res, "no users registered", 404); return; }
    const settings = await loadUserSettings(locttDir, current.id);
    json(res, { user: current.id, settings });
  };

  const handlePutUserSettings: RouteHandler = async ({ req, res, locttDir }) => {
    const current = await getCurrentUser(locttDir);
    if (!current) { error(res, "no users registered", 404); return; }
    const raw = await parseJsonBody<unknown>(req, res);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      error(res, "user settings must be a JSON object", 400);
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
      error(res, `user settings nested deeper than ${MAX_DEPTH} levels`, 400);
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
      if (err instanceof ReorderError) { error(res, err.message, 400); return; }
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
      if (err instanceof ReorderError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleListTasks: RouteHandler = async ({ res, url, locttDir }) => {
    const page = parsePagination(url, res);
    if (!page) return;
    const tasks = await loadAllTasks(locttDir);
    const { workflowConfig, queriesConfig } = await loadOptionalConfigs(locttDir);

    // Sugar: `?project=<key>` AND-merges into the query, mirroring
    // the CLI's `--project` flag.
    const projectFilter = url.searchParams.get("project") ?? undefined;
    const baseQuery = url.searchParams.get("query") ?? undefined;
    const composedQuery = projectFilter !== undefined
      ? (baseQuery !== undefined && baseQuery.length > 0
          ? `(${baseQuery}) and project = ${projectFilter}`
          : `project = ${projectFilter}`)
      : baseQuery;

    const view = url.searchParams.get("view") ?? undefined;
    // listTasks() applies a built-in default limit (30) for the CLI's
    // benefit. The HTTP API paginates explicitly, so opt out by
    // passing a sentinel limit large enough to cover any tracker.
    // `total` then reflects the true matching count and the page
    // slice happens in `paginated()` below.
    const params: ListTasksRequest = {
      ...(composedQuery !== undefined ? { query: composedQuery } : {}),
      ...(view !== undefined ? { view } : {}),
      limit: Number.MAX_SAFE_INTEGER,
    };

    const result = listTasks({
      tasks,
      options: params,
      ...(queriesConfig !== undefined ? { queriesConfig } : {}),
      ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      ctx: buildListContext(tasks),
    });
    const frontmatters = result.map(t => t.frontmatter);
    json(res, paginated(frontmatters, page.offset, page.limit));
  };

  const handleCreateTask: RouteHandler = async ({ req, res, locttDir }) => {
    const request = await parseJsonBody<CreateTaskRequest>(req, res);
    const wfConfig = await loadWorkflowConfig(locttDir);

    // Resolve target project. The HTTP API mirrors the CLI's
    // resolution order: explicit > per-user default > workspace
    // default > unique single project. If ambiguous, return 400 so
    // the client can surface a project picker.
    const projectsConfig = await loadProjectsConfig(locttDir);
    let projectKey: string;
    try {
      const current = await getCurrentUser(locttDir);
      let userDefault: string | undefined;
      if (current) {
        const settings = await loadUserSettings(locttDir, current.id);
        const raw = settings["default_project"];
        if (typeof raw === "string" && raw.length > 0) userDefault = raw;
      }
      projectKey = resolveProjectKey(projectsConfig, {
        ...(request.project !== undefined ? { explicit: request.project } : {}),
        ...(userDefault !== undefined ? { userDefault } : {}),
      });
    } catch (err) {
      error(res, (err as Error).message, 400);
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
      if (err instanceof ArchivedReferenceError) { error(res, err.message, 400); return; }
      throw err;
    }
    json(res, task.frontmatter, 201);
  };

  const handleGetTask: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    const model = await buildShowModel(locttDir, task);
    const response: TaskResponse = {
      frontmatter: model.task.frontmatter,
      body: model.task.body,
      attachments: model.attachments.map(a => ({
        name: a.name,
        size: a.size,
        ...(a.mime !== undefined ? { mime: a.mime } : {}),
      })),
    };
    json(res, response);
  };

  const handleTaskActivity: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    const entries = await readHistory(locttDir, task.frontmatter.id);

    entries.reverse();

    const page = parsePagination(url, res);
    if (page === null) return;
    const sliced = entries.slice(page.offset, page.offset + page.limit);
    json(res, { entries: sliced, total: entries.length });
  };

  const handleSetField: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const request = await parseJsonBody<UpdateTaskRequest>(req, res);
    if (typeof request.field !== "string" || request.field.length === 0) {
      error(res, "field must be a non-empty string", 400);
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
      json(res, updated.frontmatter);
    } catch (err) {
      if (err instanceof TaskUpdateError) { error(res, err.message, 400); return; }
      if (err instanceof ArchivedReferenceError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUnsetField: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const { field } = await parseJsonBody<{ field: string }>(req, res);
    if (typeof field !== "string" || field.length === 0) {
      error(res, "field must be a non-empty string", 400);
      return;
    }
    const task = await lookupTask(locttDir, ref);
    try {
      const updated = await unsetField(locttDir, task.frontmatter.id, field);
      json(res, updated.frontmatter);
    } catch (err) {
      if (err instanceof TaskUpdateError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleArchive: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    const updated = await archiveTask(locttDir, task.frontmatter.id);
    json(res, updated.frontmatter);
  };

  const handleUnarchive: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    const updated = await unarchiveTask(locttDir, task.frontmatter.id);
    json(res, updated.frontmatter);
  };

  const handleDeleteTask: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.searchParams.get("confirm") !== "true") {
      error(res, "task delete is permanent; pass ?confirm=true to proceed", 400);
      return;
    }
    const task = await lookupTask(locttDir, ref);
    await deleteTask(locttDir, task.frontmatter.id, { force: true });
    json(res, { deleted: task.frontmatter.key });
  };

  const handleLink: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const request = await parseJsonBody<LinkRequest>(req, res);
    const wfConfig = await loadWorkflowConfig(locttDir);
    const task = await lookupTask(locttDir, ref);
    const target = await lookupTask(locttDir, request.target);
    try {
      const updated = await linkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: target.frontmatter.id, workflowConfig: wfConfig });
      json(res, updated.frontmatter);
    } catch (err) {
      if (err instanceof ArchivedReferenceError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUnlink: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const request = await parseJsonBody<LinkRequest>(req, res);
    const task = await lookupTask(locttDir, ref);
    const target = await lookupTask(locttDir, request.target);
    const updated = await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: target.frontmatter.id });
    json(res, updated.frontmatter);
  };

  const handleAttachUpload: RouteHandler = async ({ req, res, url, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }

    const task = await lookupTask(locttDir, ref);

    const contentType = req.headers["content-type"] ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      error(res, "Content-Type must be multipart/form-data", 400);
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
        error(res, (parseErr as Error).message, 400);
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
        if (err instanceof AttachmentExistsError) {
          error(res, err.message, 409);
          return;
        }
        if (err instanceof AttachmentSourceError) {
          error(res, err.message, 400);
          return;
        }
        throw err;
      }
    } finally {
      await rm(tmpParent, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const handleGetAttachment: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const rawName = decodeURIComponent(captures[1] ?? "");
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }

    const task = await lookupTask(locttDir, ref);

    // assertSafeBasename rejects empty strings, separators, "..", null
    // bytes, etc.; it's the same guard `getAttachmentPath` uses.
    let filePath: string;
    try {
      filePath = getAttachmentPath(locttDir, task.frontmatter.id, rawName);
    } catch {
      error(res, "Invalid attachment name", 400);
      return;
    }
    let fileStat;
    try {
      fileStat = await fsStat(filePath);
    } catch {
      error(res, "Attachment not found", 404);
      return;
    }
    if (!fileStat.isFile()) {
      error(res, "Attachment not found", 404);
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
    const escaped = rawName.replace(/"/g, "\\\"");
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${escaped}"`,
      "Content-Length": String(fileStat.size),
    });
    const stream = createReadStream(filePath);
    stream.on("error", () => { try { res.end(); } catch { /* ignore */ } });
    stream.pipe(res);
  };

  const handleDeleteAttachment: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const rawName = decodeURIComponent(captures[1] ?? "");
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    try {
      assertSafeBasename(rawName);
    } catch {
      error(res, "Invalid attachment name", 400);
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
      if (err instanceof AttachmentNotFoundError) {
        error(res, err.message, 404);
        return;
      }
      throw err;
    }
  };

  const routes: readonly Route[] = [
    { method: "GET", pattern: "/api/info", handler: handleInfo },
    { method: "GET", pattern: "/api/doctor", handler: handleDoctor },
    { method: "GET", pattern: "/api/config", handler: handleConfig },
    { method: "GET", pattern: "/api/projects", handler: handleListProjects },
    { method: "POST", pattern: "/api/projects", handler: handleCreateProject },
    { method: "PUT", pattern: PROJECT_KEY_RE, handler: handleUpdateProject },
    { method: "DELETE", pattern: PROJECT_KEY_RE, handler: handleDeleteProject },
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
    { method: "POST", pattern: "/api/user/switch", handler: handleSwitchUser },
    { method: "PUT", pattern: USER_REF_RE, handler: handleUpdateUser },
    { method: "DELETE", pattern: USER_REF_RE, handler: handleDeleteUser },
    { method: "POST", pattern: USER_ARCHIVE_RE, handler: handleArchiveUser },
    { method: "POST", pattern: USER_UNARCHIVE_RE, handler: handleUnarchiveUser },
    { method: "GET", pattern: USER_AVATAR_RE, handler: handleGetAvatar },
    { method: "POST", pattern: USER_AVATAR_RE, handler: handleUploadAvatar },
    { method: "GET", pattern: "/api/tasks", handler: handleListTasks },
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
        (await trackerDirExists(locttDir))
      ) {
        try {
          await requireSupportedSchema(locttDir);
        } catch (err) {
          if (err instanceof SchemaVersionError || err instanceof SchemaTooNewError) {
            error(res, err.message, 409);
            return;
          }
          throw err;
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

      error(res, "Not found", 404);
    } catch (err) {
      if (err instanceof HandledRequestError) {
        // parseJsonBody already wrote a 400 — bail silently.
        return;
      }
      if (err instanceof TaskNotFoundError) {
        error(res, err.message, 404);
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
        error(res, err.message, 413);
        req.destroy();
        return;
      }
      // Tag the log line with method+path+req-id so an operator
      // looking at a stack trace can find which request triggered it.
      console.error(`[req ${reqId}] ${req.method ?? "?"} ${path}`, err);
      error(res, "Internal server error", 500);
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
