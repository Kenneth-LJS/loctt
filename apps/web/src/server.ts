import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat as fsStat } from "node:fs/promises";
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
import {
  applyWorkflowEdit,
  archiveTask,
  archiveUser,
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  buildListContext,
  buildShowModel,
  createLabel,
  createMilestone,
  createProject,
  createSprint,
  createTask,
  createUser,
  deleteLabel,
  deleteMilestone,
  deleteProject,
  deleteSprint,
  deleteTask,
  deleteUser,
  detachFile,
  editLabel,
  editMilestone,
  editProject,
  editSprint,
  getAttachmentPath,
  getCurrentUser,
  getTrackerInfo,
  LabelError,
  linkTask,
  listTasks,
  loadAllTasks,
  loadAllUsers,
  loadCalendarConfig,
  loadLabelsConfig,
  loadMilestonesConfig,
  loadOptionalConfigs,
  loadProjectsConfig,
  loadQueriesConfig,
  loadSprintsConfig,
  loadState,
  loadWorkflowConfig,
  lookupTask,
  MilestoneError,
  ProjectError,
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
  saveState,
  SchemaTooNewError,
  SchemaVersionError,
  setDefaultProject,
  setField,
  SprintError,
  switchCurrentUser,
  TaskNotFoundError,
  unarchiveTask,
  unarchiveUser,
  unlinkTask,
  unsetField,
  updateUser,
  UserError,
  withStateLock,
} from "@loctt/core";

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

async function readBody(req: import("node:http").IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: import("node:http").ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function error(res: import("node:http").ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

const VALID_REF_RE = /^[A-Za-z0-9_-]+$/;
const TASK_REF_RE = /^\/api\/tasks\/([^/]+)$/;
const PROJECT_KEY_RE = /^\/api\/projects\/([^/]+)$/;
const LABEL_KEY_RE = /^\/api\/labels\/([^/]+)$/;
const MILESTONE_KEY_RE = /^\/api\/milestones\/([^/]+)$/;
const SPRINT_KEY_RE = /^\/api\/sprints\/([^/]+)$/;
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
  ".svg": "image/svg+xml",
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

  const handleGetWorkflow: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadWorkflowConfig(locttDir);
    json(res, cfg);
  };

  const handlePutWorkflow: RouteHandler = async ({ req, res, locttDir }) => {
    const body = await readBody(req);
    const payload = JSON.parse(body) as {
      workflow: Parameters<typeof applyWorkflowEdit>[1];
      remap?: Parameters<typeof applyWorkflowEdit>[2];
    };
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

  const handleListProjects: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadProjectsConfig(locttDir);
    json(res, { projects: cfg.projects, default: cfg.default ?? null });
  };

  const handleCreateProject: RouteHandler = async ({ req, res, locttDir }) => {
    const body = await readBody(req);
    const request = JSON.parse(body) as {
      key: string;
      label: string;
      prefix: string;
      make_default?: boolean;
    };
    try {
      await createProject(locttDir, {
        key: request.key,
        label: request.label,
        prefix: request.prefix,
      });
      if (request.make_default === true) {
        await setDefaultProject(locttDir, request.key);
      }
      json(res, { key: request.key }, 201);
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
    const body = await readBody(req);
    const request = JSON.parse(body) as { label?: string; default?: boolean };
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
      json(res, { key });
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
    const body = await readBody(req);
    const cfg = JSON.parse(body) as Parameters<typeof saveCalendarConfig>[1];
    try {
      await saveCalendarConfig(locttDir, cfg);
      json(res, cfg);
    } catch (err) {
      error(res, (err as Error).message, 400);
    }
  };

  const handleListSprints: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadSprintsConfig(locttDir);
    json(res, cfg);
  };

  const handleCreateSprint: RouteHandler = async ({ req, res, locttDir }) => {
    const body = await readBody(req);
    const r = JSON.parse(body) as {
      key: string;
      label: string;
      start_date: string;
      end_date: string;
      state: "active" | "completed" | "future";
      goal?: string;
    };
    try {
      await createSprint(locttDir, {
        key: r.key,
        label: r.label,
        start_date: r.start_date,
        end_date: r.end_date,
        state: r.state,
        ...(r.goal !== undefined ? { goal: r.goal } : {}),
      });
      json(res, { key: r.key }, 201);
    } catch (err) {
      if (err instanceof SprintError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUpdateSprint: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const body = await readBody(req);
    const r = JSON.parse(body) as {
      label?: string;
      start_date?: string;
      end_date?: string;
      state?: "active" | "completed" | "future";
      goal?: string | null;
    };
    try {
      await editSprint(locttDir, key, {
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...(r.start_date !== undefined ? { start_date: r.start_date } : {}),
        ...(r.end_date !== undefined ? { end_date: r.end_date } : {}),
        ...(r.state !== undefined ? { state: r.state } : {}),
        ...("goal" in r ? { goal: r.goal as string | null } : {}),
      });
      json(res, { key });
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

  const handleListMilestones: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadMilestonesConfig(locttDir);
    json(res, cfg);
  };

  const handleCreateMilestone: RouteHandler = async ({ req, res, locttDir }) => {
    const body = await readBody(req);
    const r = JSON.parse(body) as { key: string; label: string; target_date?: string };
    try {
      await createMilestone(locttDir, {
        key: r.key,
        label: r.label,
        ...(r.target_date !== undefined ? { target_date: r.target_date } : {}),
      });
      json(res, { key: r.key }, 201);
    } catch (err) {
      if (err instanceof MilestoneError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUpdateMilestone: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const body = await readBody(req);
    const r = JSON.parse(body) as {
      label?: string;
      target_date?: string | null;
      archived?: boolean;
    };
    try {
      await editMilestone(locttDir, key, {
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...("target_date" in r ? { target_date: r.target_date as string | null } : {}),
        ...(r.archived !== undefined ? { archived: r.archived } : {}),
      });
      json(res, { key });
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

  const handleListLabels: RouteHandler = async ({ res, locttDir }) => {
    const cfg = await loadLabelsConfig(locttDir);
    json(res, cfg);
  };

  const handleCreateLabel: RouteHandler = async ({ req, res, locttDir }) => {
    const body = await readBody(req);
    const r = JSON.parse(body) as { key: string; label: string; color?: string };
    try {
      await createLabel(locttDir, {
        key: r.key,
        label: r.label,
        ...(r.color !== undefined ? { color: r.color } : {}),
      });
      json(res, { key: r.key }, 201);
    } catch (err) {
      if (err instanceof LabelError) { error(res, err.message, 400); return; }
      throw err;
    }
  };

  const handleUpdateLabel: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const key = captures[0] ?? "";
    const body = await readBody(req);
    const r = JSON.parse(body) as { label?: string; color?: string | null };
    try {
      await editLabel(locttDir, key, {
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...("color" in r ? { color: r.color as string | null } : {}),
      });
      json(res, { key });
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
    const includeArchived = url.searchParams.get("include_archived") === "true";
    const users = await loadAllUsers(locttDir);
    const current = await getCurrentUser(locttDir);
    const filtered = users.filter(u => includeArchived || u.archived !== true);
    json(res, { current: current?.id ?? null, users: filtered });
  };

  const handleCurrentUser: RouteHandler = async ({ res, locttDir }) => {
    const current = await getCurrentUser(locttDir);
    if (!current) { error(res, "no users registered", 404); return; }
    json(res, current);
  };

  const handleSwitchUser: RouteHandler = async ({ req, res, locttDir }) => {
    const body = await readBody(req);
    const request = JSON.parse(body) as { ref: string };
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
    const body = await readBody(req);
    const request = JSON.parse(body) as {
      name: string;
      email?: string;
      timezone?: string;
      avatar_source_path?: string;
      switch_to_on_create?: boolean;
    };
    try {
      const created = await createUser(locttDir, {
        name: request.name,
        ...(request.email !== undefined ? { email: request.email } : {}),
        ...(request.timezone !== undefined ? { timezone: request.timezone } : {}),
        ...(request.avatar_source_path !== undefined ? { avatarSourcePath: request.avatar_source_path } : {}),
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
    const body = await readBody(req);
    const request = JSON.parse(body) as {
      name?: string;
      email?: string | null;
      timezone?: string;
      avatar_source_path?: string;
    };
    try {
      const target = await resolveUserRef(locttDir, ref);
      const updated = await updateUser(locttDir, target.id, {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...("email" in request ? { email: request.email as string | null } : {}),
        ...(request.timezone !== undefined ? { timezone: request.timezone } : {}),
        ...(request.avatar_source_path !== undefined ? { avatarSourcePath: request.avatar_source_path } : {}),
      });
      json(res, updated);
    } catch (err) {
      if (err instanceof UserError) { error(res, err.message, 400); return; }
      throw err;
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
      const avatarPath = pathJoin(locttDir, "users", target.id, target.avatar);
      const stat = await fsStat(avatarPath);
      if (!stat.isFile()) { error(res, "no avatar", 404); return; }
      // Pick a content-type from the extension.
      res.writeHead(200, { "Content-Type": mimeFor(target.avatar) });
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

  const handleBoardRerank: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const body = await readBody(req);
    const request = JSON.parse(body) as { before?: string; after?: string };
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
    const body = await readBody(req);
    const request = JSON.parse(body || "{}") as { before?: string; after?: string };
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
    const tasks = await loadAllTasks(locttDir);
    const { workflowConfig, queriesConfig } = await loadOptionalConfigs(locttDir);

    let limit: number | undefined;
    if (url.searchParams.has("limit")) {
      const n = Number(url.searchParams.get("limit"));
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        error(res, "limit must be a non-negative integer", 400);
        return;
      }
      limit = n;
    }

    // Sugar: `?project=<key>` AND-merges into the query, mirroring
    // the CLI's `--project` flag.
    const projectFilter = url.searchParams.get("project") ?? undefined;
    const baseQuery = url.searchParams.get("query") ?? undefined;
    const composedQuery = projectFilter !== undefined
      ? (baseQuery !== undefined && baseQuery.length > 0
          ? `(${baseQuery}) and project = ${projectFilter}`
          : `project = ${projectFilter}`)
      : baseQuery;

    const params: ListTasksRequest = {
      query: composedQuery,
      view: url.searchParams.get("view") ?? undefined,
      limit,
    };

    const result = listTasks({ tasks, options: params, queriesConfig, workflowConfig, ctx: buildListContext(tasks) });
    json(res, result.map(t => t.frontmatter));
  };

  const handleCreateTask: RouteHandler = async ({ req, res, locttDir }) => {
    const body = await readBody(req);
    const request = JSON.parse(body) as CreateTaskRequest;
    const wfConfig = await loadWorkflowConfig(locttDir);

    // Resolve target project. The HTTP API mirrors the CLI's
    // resolution order: explicit > workspace default > unique
    // single project. If ambiguous, return 400 so the client can
    // surface a project picker.
    const projectsConfig = await loadProjectsConfig(locttDir);
    let projectKey: string;
    try {
      projectKey = resolveProjectKey(projectsConfig, {
        explicit: request.project,
      });
    } catch (err) {
      error(res, (err as Error).message, 400);
      return;
    }

    const task = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const created = await createTask({
        locttDir,
        state,
        options: { ...request, project: projectKey },
        workflowConfig: wfConfig,
      });
      await saveState(locttDir, state);
      return created;
    });
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
      attachments: model.attachments.map(a => ({ name: a.name, size: a.size })),
    };
    json(res, response);
  };

  const handleTaskActivity: RouteHandler = async ({ res, url, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    const entries = await readHistory(locttDir, task.frontmatter.id);

    entries.reverse();

    let limit = entries.length;
    let offset = 0;
    if (url.searchParams.has("limit")) {
      const n = Number(url.searchParams.get("limit"));
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        error(res, "limit must be a non-negative integer", 400);
        return;
      }
      limit = n;
    }
    if (url.searchParams.has("offset")) {
      const n = Number(url.searchParams.get("offset"));
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        error(res, "offset must be a non-negative integer", 400);
        return;
      }
      offset = n;
    }

    const page = entries.slice(offset, offset + limit);
    json(res, { entries: page, total: entries.length });
  };

  const handleSetField: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const body = await readBody(req);
    const request = JSON.parse(body) as UpdateTaskRequest;
    const wfConfig = await loadWorkflowConfig(locttDir);
    const task = await lookupTask(locttDir, ref);
    const updated = await setField({ locttDir, taskId: task.frontmatter.id, field: request.field, value: request.value, workflowConfig: wfConfig });
    json(res, updated.frontmatter);
  };

  const handleUnsetField: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const body = await readBody(req);
    const { field } = JSON.parse(body) as { field: string };
    const task = await lookupTask(locttDir, ref);
    const updated = await unsetField(locttDir, task.frontmatter.id, field);
    json(res, updated.frontmatter);
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

  const handleDeleteTask: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const task = await lookupTask(locttDir, ref);
    await deleteTask(locttDir, task.frontmatter.id, { force: true });
    json(res, { deleted: task.frontmatter.key });
  };

  const handleLink: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const body = await readBody(req);
    const request = JSON.parse(body) as LinkRequest;
    const wfConfig = await loadWorkflowConfig(locttDir);
    const task = await lookupTask(locttDir, ref);
    const target = await lookupTask(locttDir, request.target);
    const updated = await linkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: target.frontmatter.id, workflowConfig: wfConfig });
    json(res, updated.frontmatter);
  };

  const handleUnlink: RouteHandler = async ({ req, res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    const body = await readBody(req);
    const request = JSON.parse(body) as LinkRequest;
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
      let parsed;
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

  function validateAttachmentName(rawName: string): boolean {
    return !(
      rawName.length === 0
      || rawName.includes("/")
      || rawName.includes("\\")
      || rawName.includes("\0")
      || rawName === "."
      || rawName === ".."
      || rawName.split(/[/\\]/).some(p => p === "..")
    );
  }

  const handleGetAttachment: RouteHandler = async ({ res, locttDir, captures }) => {
    const ref = captures[0] ?? "";
    const rawName = decodeURIComponent(captures[1] ?? "");
    if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
    if (!validateAttachmentName(rawName)) { error(res, "Invalid attachment name", 400); return; }

    const task = await lookupTask(locttDir, ref);

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
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
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
    if (!validateAttachmentName(rawName)) { error(res, "Invalid attachment name", 400); return; }

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
    { method: "GET", pattern: "/api/workflow", handler: handleGetWorkflow },
    { method: "PUT", pattern: "/api/workflow", handler: handlePutWorkflow },
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
  ];

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
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
      if (path.startsWith("/api/") && (await trackerDirExists(locttDir))) {
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
      if (err instanceof TaskNotFoundError) {
        error(res, err.message, 404);
        return;
      }
      console.error(err);
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
