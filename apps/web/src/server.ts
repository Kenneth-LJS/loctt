import { createServer } from "node:http";

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
  buildListContext,
  buildShowModel,
  createTask,
  deleteTask,
  getTrackerInfo,
  linkTask,
  listTasks,
  loadAllTasks,
  loadOptionalConfigs,
  loadQueriesConfig,
  loadState,
  loadWorkflowConfig,
  lookupTask,
  resolveLocttDir,
  runDoctor,
  saveState,
  setField,
  unarchiveTask,
  unlinkTask,
  unsetField,
} from "@loctt/core";

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
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;

    try {
      const locttDir = resolveLocttDir(root);

      if (path === "/api/info" && req.method === "GET") {
        const info = await getTrackerInfo(root);
        const response: TrackerInfoResponse = {
          exists: info.exists,
          locttDir: info.locttDir,
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

        const result = listTasks(tasks, params, queriesConfig, workflowConfig, buildListContext(tasks));
        json(res, result.map(t => t.frontmatter));
        return;
      }

      if (path === "/api/tasks" && req.method === "POST") {
        const body = await readBody(req);
        const request = JSON.parse(body) as CreateTaskRequest;
        const state = await loadState(locttDir);
        const wfConfig = await loadWorkflowConfig(locttDir);
        const task = await createTask(locttDir, state, request, wfConfig);
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
          attachments: model.attachments,
        };
        json(res, response);
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
        const updated = await setField(locttDir, task.frontmatter.id, request.field, request.value, wfConfig);
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
        const updated = await linkTask(locttDir, task.frontmatter.id, request.type, target.frontmatter.id, wfConfig);
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
        const updated = await unlinkTask(locttDir, task.frontmatter.id, request.type, target.frontmatter.id);
        json(res, updated.frontmatter);
        return;
      }

      error(res, "Not found", 404);
    } catch (err) {
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
