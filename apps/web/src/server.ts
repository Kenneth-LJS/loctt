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
  archiveTask,
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  buildListContext,
  buildShowModel,
  createTask,
  deleteTask,
  detachFile,
  getAttachmentPath,
  getTrackerInfo,
  linkTask,
  listTasks,
  loadAllTasks,
  loadOptionalConfigs,
  loadQueriesConfig,
  loadState,
  loadWorkflowConfig,
  lookupTask,
  readHistory,
  requireSupportedSchema,
  resolveLocttDir,
  runDoctor,
  saveState,
  SchemaTooNewError,
  SchemaVersionError,
  setField,
  TaskNotFoundError,
  unarchiveTask,
  unlinkTask,
  unsetField,
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
const TASK_ACTIVITY_RE = /^\/api\/tasks\/([^/]+)\/activity$/;
const TASK_SET_RE = /^\/api\/tasks\/([^/]+)\/set$/;
const TASK_UNSET_RE = /^\/api\/tasks\/([^/]+)\/unset$/;
const TASK_ARCHIVE_RE = /^\/api\/tasks\/([^/]+)\/archive$/;
const TASK_UNARCHIVE_RE = /^\/api\/tasks\/([^/]+)\/unarchive$/;
const TASK_LINK_RE = /^\/api\/tasks\/([^/]+)\/link$/;
const TASK_UNLINK_RE = /^\/api\/tasks\/([^/]+)\/unlink$/;
const TASK_ATTACHMENTS_RE = /^\/api\/tasks\/([^/]+)\/attachments$/;
const TASK_ATTACHMENT_ITEM_RE = /^\/api\/tasks\/([^/]+)\/attachments\/([^/]+)$/;

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

  const handleInfo: RouteHandler = async ({ res }) => {
    const info = await getTrackerInfo(root);
    const response: TrackerInfoResponse = {
      exists: info.exists,
      taskCount: info.taskCount,
      keyPrefix: info.workflowConfig?.key.prefix ?? null,
      nextKey: info.state?.keys["task"]
        ? `${info.state.keys["task"].prefix}${info.state.keys["task"].next_number}`
        : null,
    };
    json(res, response);
  };

  const handleDoctor: RouteHandler = async ({ res }) => {
    const checks = await runDoctor(root);
    json(res, checks as DoctorCheckResponse[]);
  };

  const handleConfig: RouteHandler = async ({ res, locttDir }) => {
    const workflow = await loadWorkflowConfig(locttDir);
    let queries = null;
    try { queries = await loadQueriesConfig(locttDir); } catch { /* ok */ }
    const response: ConfigResponse = { workflow, queries };
    json(res, response);
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

    const params: ListTasksRequest = {
      query: url.searchParams.get("query") ?? undefined,
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
    const task = await withStateLock(locttDir, async () => {
      const state = await loadState(locttDir);
      const created = await createTask({ locttDir, state, options: request, workflowConfig: wfConfig });
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
