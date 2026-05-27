// Internal HTTP client for the web app's own API endpoints.

import type {
  AttachResultResponse,
  ConfigResponse,
  CreateTaskRequest,
  DoctorCheckResponse,
  TaskFrontmatter,
  TaskResponse,
  TrackerInfoResponse,
} from "@loctt/contracts";

export type { AttachResultResponse };

/**
 * Thrown when an attachment upload fails because a file with the same name
 * already exists and `force` was not set. Frontend code can catch this
 * specifically to prompt the user to overwrite.
 */
export class AttachmentExistsError extends Error {
  readonly name = "AttachmentExistsError" as const;
  constructor(message: string) {
    super(message);
  }
}

/** HTTP client for the co-located API. Used internally by the web UI. */
export class LocttClient {
  private readonly base: string;

  constructor(baseUrl: string = "") {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Reads the error payload from a non-ok response and returns its
   * `error` message, falling back to the HTTP status text. Some
   * routes return JSON; some (e.g. a server-side fault before a
   * route is matched) don't, so a failed `.json()` falls back to
   * the status line.
   */
  private async readErrorMessage(res: Response): Promise<string> {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Loctt-Client": "1",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(await this.readErrorMessage(res));
    }
    return res.json() as Promise<T>;
  }

  async getInfo(): Promise<TrackerInfoResponse> {
    return this.fetch("/api/info");
  }

  async getDoctor(): Promise<DoctorCheckResponse[]> {
    return this.fetch("/api/doctor");
  }

  async getConfig(): Promise<ConfigResponse> {
    return this.fetch("/api/config");
  }

  async listTasks(params?: {
    query?: string;
    view?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: TaskFrontmatter[]; total: number; offset: number; limit: number }> {
    const searchParams = new URLSearchParams();
    if (params?.query) searchParams.set("query", params.query);
    if (params?.view) searchParams.set("view", params.view);
    if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
    if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
    const qs = searchParams.toString();
    return this.fetch(`/api/tasks${qs ? `?${qs}` : ""}`);
  }

  async getTask(ref: string): Promise<TaskResponse> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}`);
  }

  async createTask(request: CreateTaskRequest): Promise<TaskFrontmatter> {
    return this.fetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async setField(ref: string, field: string, value: unknown): Promise<TaskFrontmatter> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}/set`, {
      method: "POST",
      body: JSON.stringify({ field, value }),
    });
  }

  async unsetField(ref: string, field: string): Promise<TaskFrontmatter> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}/unset`, {
      method: "POST",
      body: JSON.stringify({ field }),
    });
  }

  async archiveTask(ref: string): Promise<TaskFrontmatter> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}/archive`, { method: "POST" });
  }

  async unarchiveTask(ref: string): Promise<TaskFrontmatter> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}/unarchive`, { method: "POST" });
  }

  async deleteTask(ref: string): Promise<{ deleted: string }> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}?confirm=true`, { method: "DELETE" });
  }

  async linkTasks(ref: string, type: string, target: string): Promise<TaskFrontmatter> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}/link`, {
      method: "POST",
      body: JSON.stringify({ type, target }),
    });
  }

  async unlinkTasks(ref: string, type: string, target: string): Promise<TaskFrontmatter> {
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}/unlink`, {
      method: "POST",
      body: JSON.stringify({ type, target }),
    });
  }

  async attachFile(
    ref: string,
    file: File | Blob,
    opts?: { force?: boolean; filename?: string },
  ): Promise<AttachResultResponse> {
    const form = new FormData();
    const filename = opts?.filename
      ?? (file instanceof File ? file.name : "upload");
    form.append("file", file, filename);
    const qs = opts?.force ? "?force=true" : "";
    const res = await fetch(
      `${this.base}/api/tasks/${encodeURIComponent(ref)}/attachments${qs}`,
      {
        method: "POST",
        headers: { "X-Loctt-Client": "1" },
        body: form,
      },
    );
    if (!res.ok) {
      const message = await this.readErrorMessage(res);
      if (res.status === 409) {
        throw new AttachmentExistsError(message);
      }
      throw new Error(message);
    }
    return res.json() as Promise<AttachResultResponse>;
  }

  async detachFile(ref: string, name: string): Promise<void> {
    const res = await fetch(
      `${this.base}/api/tasks/${encodeURIComponent(ref)}/attachments/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: { "X-Loctt-Client": "1" },
      },
    );
    if (!res.ok) {
      throw new Error(await this.readErrorMessage(res));
    }
  }

  getAttachmentUrl(ref: string, name: string): string {
    return `${this.base}/api/tasks/${encodeURIComponent(ref)}/attachments/${encodeURIComponent(name)}`;
  }
}
