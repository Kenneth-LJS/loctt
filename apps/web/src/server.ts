import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat as fsStat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";

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
  resolveLocttDir,
  runDoctor,
  saveState,
  setField,
  TaskNotFoundError,
  unarchiveTask,
  unlinkTask,
  unsetField,
} from "@loctt/core";

import { parseMultipartFile } from "./multipart.js";

const DEFAULT_PORT = 4321;

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

/** Matches a route pattern with a single capture group and returns the captured value. */
function matchRoute(path: string, pattern: RegExp): string | undefined {
  const m = pattern.exec(path);
  return m?.[1];
}

export interface WebAppOptions {
  readonly root: string;
  readonly port?: number;
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

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    if (!requireCsrfHeader(req, res)) return;

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;

    try {
      const locttDir = resolveLocttDir(root);

      if (path === "/api/info" && req.method === "GET") {
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
        return;
      }

      if (path === "/api/doctor" && req.method === "GET") {
        const checks = await runDoctor(root);
        json(res, checks as DoctorCheckResponse[]);
        return;
      }

      if (path === "/api/config" && req.method === "GET") {
        const workflow = await loadWorkflowConfig(locttDir);
        let queries = null;
        try { queries = await loadQueriesConfig(locttDir); } catch { /* ok */ }
        const response: ConfigResponse = { workflow, queries };
        json(res, response);
        return;
      }

      if (path === "/api/tasks" && req.method === "GET") {
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
        return;
      }

      if (path === "/api/tasks" && req.method === "POST") {
        const body = await readBody(req);
        const request = JSON.parse(body) as CreateTaskRequest;
        const state = await loadState(locttDir);
        const wfConfig = await loadWorkflowConfig(locttDir);
        const task = await createTask({ locttDir, state, options: request, workflowConfig: wfConfig });
        await saveState(locttDir, state);
        json(res, task.frontmatter, 201);
        return;
      }

      const getTaskRef = matchRoute(path, /^\/api\/tasks\/([^/]+)$/);
      if (getTaskRef !== undefined && req.method === "GET") {
        const ref = getTaskRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const task = await lookupTask(locttDir, ref);
        const model = await buildShowModel(locttDir, task);
        const response: TaskResponse = {
          frontmatter: model.task.frontmatter,
          body: model.task.body,
          attachments: model.attachments.map(a => ({ name: a.name, size: a.size })),
        };
        json(res, response);
        return;
      }

      const activityRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/activity$/);
      if (activityRef !== undefined && req.method === "GET") {
        const ref = activityRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const task = await lookupTask(locttDir, ref);
        const entries = await readHistory(locttDir, task.frontmatter.id);

        // Reverse chronological order
        entries.reverse();

        // Pagination
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
        return;
      }

      const setRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/set$/);
      if (setRef !== undefined && req.method === "POST") {
        const ref = setRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const body = await readBody(req);
        const request = JSON.parse(body) as UpdateTaskRequest;
        const wfConfig = await loadWorkflowConfig(locttDir);
        const task = await lookupTask(locttDir, ref);
        const updated = await setField({ locttDir, taskId: task.frontmatter.id, field: request.field, value: request.value, workflowConfig: wfConfig });
        json(res, updated.frontmatter);
        return;
      }

      const unsetRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/unset$/);
      if (unsetRef !== undefined && req.method === "POST") {
        const ref = unsetRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const body = await readBody(req);
        const { field } = JSON.parse(body) as { field: string };
        const task = await lookupTask(locttDir, ref);
        const updated = await unsetField(locttDir, task.frontmatter.id, field);
        json(res, updated.frontmatter);
        return;
      }

      const archiveRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/archive$/);
      if (archiveRef !== undefined && req.method === "POST") {
        const ref = archiveRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const task = await lookupTask(locttDir, ref);
        const updated = await archiveTask(locttDir, task.frontmatter.id);
        json(res, updated.frontmatter);
        return;
      }

      const unarchiveRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/unarchive$/);
      if (unarchiveRef !== undefined && req.method === "POST") {
        const ref = unarchiveRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const task = await lookupTask(locttDir, ref);
        const updated = await unarchiveTask(locttDir, task.frontmatter.id);
        json(res, updated.frontmatter);
        return;
      }

      const deleteRef = matchRoute(path, /^\/api\/tasks\/([^/]+)$/);
      if (deleteRef !== undefined && req.method === "DELETE") {
        const ref = deleteRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const task = await lookupTask(locttDir, ref);
        await deleteTask(locttDir, task.frontmatter.id, { force: true });
        json(res, { deleted: task.frontmatter.key });
        return;
      }

      const linkRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/link$/);
      if (linkRef !== undefined && req.method === "POST") {
        const ref = linkRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const body = await readBody(req);
        const request = JSON.parse(body) as LinkRequest;
        const wfConfig = await loadWorkflowConfig(locttDir);
        const task = await lookupTask(locttDir, ref);
        const target = await lookupTask(locttDir, request.target);
        const updated = await linkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: target.frontmatter.id, workflowConfig: wfConfig });
        json(res, updated.frontmatter);
        return;
      }

      const unlinkRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/unlink$/);
      if (unlinkRef !== undefined && req.method === "POST") {
        const ref = unlinkRef;
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        const body = await readBody(req);
        const request = JSON.parse(body) as LinkRequest;
        const task = await lookupTask(locttDir, ref);
        const target = await lookupTask(locttDir, request.target);
        const updated = await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: request.type, target: target.frontmatter.id });
        json(res, updated.frontmatter);
        return;
      }

      const attachUploadRef = matchRoute(path, /^\/api\/tasks\/([^/]+)\/attachments$/);
      if (attachUploadRef !== undefined && req.method === "POST") {
        const ref = attachUploadRef;
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

          // Use the multipart filename as the destination basename.
          // attachFile will derive basename from the source path, so we need
          // a source path whose basename matches the desired filename.
          // parseMultipartFile already wrote the file under that basename.
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
      }

      const attachItemMatch = /^\/api\/tasks\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
      if (attachItemMatch && (req.method === "GET" || req.method === "DELETE")) {
        const ref = attachItemMatch[1]!;
        const rawName = decodeURIComponent(attachItemMatch[2]!);
        if (!VALID_REF_RE.test(ref)) { error(res, "Invalid task reference", 400); return; }
        if (
          rawName.length === 0
          || rawName.includes("/")
          || rawName.includes("\\")
          || rawName.includes("\0")
          || rawName === "."
          || rawName === ".."
          || rawName.split(/[/\\]/).some(p => p === "..")
        ) {
          error(res, "Invalid attachment name", 400);
          return;
        }

        const task = await lookupTask(locttDir, ref);

        if (req.method === "GET") {
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
          return;
        }

        // DELETE
        try {
          await detachFile({
            locttDir,
            taskId: task.frontmatter.id,
            name: rawName,
          });
          res.writeHead(204);
          res.end();
          return;
        } catch (err) {
          if (err instanceof AttachmentNotFoundError) {
            error(res, err.message, 404);
            return;
          }
          throw err;
        }
      }

      error(res, "Not found", 404);
    } catch (err) {
      // 404-map TaskNotFoundError only for attachment endpoints, where the
      // contract calls for it. Other endpoints have historically returned
      // 500 for unknown refs; preserve that to avoid breaking existing
      // clients/tests until the rest of the API is updated separately.
      if (err instanceof TaskNotFoundError && /^\/api\/tasks\/[^/]+\/attachments(\/|$)/.test(path)) {
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
