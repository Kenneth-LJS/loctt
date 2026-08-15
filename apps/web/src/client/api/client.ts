/**
 * Tiny typed fetch wrapper for the LocTT REST API.
 *
 * - Sends `X-Loctt-Client: web` on every request. The server requires
 *   this header on non-GET methods as a CSRF guard; sending it
 *   unconditionally keeps the call sites uniform.
 * - Treats any non-2xx response as a failure and throws ApiError with
 *   the parsed body (if JSON) or the raw text.
 * - Each call site provides its own response type — the client is a
 *   transport, not a schema registry. Per-resource hooks in T1+
 *   define the shapes from @loctt/contracts.
 *
 * The base URL is relative (""), so calls hit the same origin during
 * `npm run dev` (Vite proxies /api → API server) and in production
 * (the API server serves both the SPA bundle and the routes).
 */

import type { ErrorResponse } from "@loctt/contracts";

const CLIENT_HEADER = "X-Loctt-Client";
const CLIENT_NAME = "web";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly endpoint: string;
  /**
   * The server's structured error envelope, when it sent one.
   *
   * Components branch on this rather than matching `message` text: the
   * field a failure belongs to decides *where* it renders (ERR-14), the
   * data state decides *what the user is told about their edit*
   * (ERR-18), and the recovery decides *which control to offer*
   * (ERR-15). Undefined when the failure never reached the API — an
   * unreachable server, an HTML error page from something upstream.
   */
  readonly envelope: ErrorResponse | undefined;

  constructor(message: string, opts: {
    status: number;
    body: unknown;
    endpoint: string;
    envelope?: ErrorResponse | undefined;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.body = opts.body;
    this.endpoint = opts.endpoint;
    this.envelope = opts.envelope;
  }

  /** Convenience for the common `err.envelope?.code` branch. */
  get code(): ErrorResponse["code"] | undefined {
    return this.envelope?.code;
  }
}

/**
 * Narrows a parsed response body to the error envelope.
 *
 * Only `code` and `message` are required — a body carrying neither is
 * some other server's error page, not ours, and is left as raw `body`.
 */
function asEnvelope(body: unknown): ErrorResponse | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const candidate = body as Partial<ErrorResponse>;
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
    return undefined;
  }
  return candidate as ErrorResponse;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions {
  readonly method?: Method;
  /** JSON-serializable request body. */
  readonly body?: unknown;
  /** Extra headers to merge. */
  readonly headers?: Record<string, string>;
  /** AbortSignal forwarded to fetch. */
  readonly signal?: AbortSignal;
}

async function parseBody(res: Response): Promise<unknown> {
  // 204 No Content has no body — fetch will return an empty string,
  // not valid JSON, so short-circuit.
  if (res.status === 204) return undefined;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await res.json()) as unknown;
    } catch {
      return undefined;
    }
  }
  // Fall back to text so error responses (HTML 404 pages, plain-text
  // errors) at least surface their content via ApiError.body.
  return await res.text();
}

function errorMessage(endpoint: string, status: number, body: unknown): string {
  // The envelope's `message` is the user-facing headline; prefer it over
  // the legacy `error` string, which it duplicates today but need not
  // once call sites carry richer copy.
  const envelope = asEnvelope(body);
  if (envelope !== undefined) return envelope.message;
  // Prefer a server-supplied error string when present
  if (body !== null && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string") return err;
  }
  if (typeof body === "string" && body.length > 0 && body.length < 200) {
    return body;
  }
  return `${endpoint} responded with ${status}`;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const method: Method = options.method ?? "GET";
  const headers: Record<string, string> = {
    [CLIENT_HEADER]: CLIENT_NAME,
    Accept: "application/json",
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  };
  const init: RequestInit = {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  const res = await fetch(endpoint, init);
  const body = await parseBody(res);
  if (!res.ok) {
    throw new ApiError(errorMessage(endpoint, res.status, body), {
      status: res.status,
      body,
      endpoint,
      envelope: asEnvelope(body),
    });
  }
  return body as T;
}

export const apiClient = {
  get: <T>(endpoint: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "GET" }),
  post: <T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "POST", body }),
  put: <T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "PUT", body }),
  delete: <T>(endpoint: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "DELETE" }),
};
