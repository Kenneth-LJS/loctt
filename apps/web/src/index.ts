// @loctt/web — web app shell
// Minimal web client that talks to the LocTT service layer.

import type {
  TaskFrontmatter,
  TaskResponse,
  TrackerInfoResponse,
  DoctorCheckResponse,
  CreateTaskRequest,
  ConfigResponse,
} from "@loctt/contracts";

const DEFAULT_BASE = "http://localhost:4321";

/** Simple HTTP client for the LocTT service. */
export class LocttClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
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

  async listTasks(params?: { query?: string; view?: string; limit?: number }): Promise<TaskFrontmatter[]> {
    const searchParams = new URLSearchParams();
    if (params?.query) searchParams.set("query", params.query);
    if (params?.view) searchParams.set("view", params.view);
    if (params?.limit) searchParams.set("limit", String(params.limit));
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
    return this.fetch(`/api/tasks/${encodeURIComponent(ref)}`, { method: "DELETE" });
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
}
