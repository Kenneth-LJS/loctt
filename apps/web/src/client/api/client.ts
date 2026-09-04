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
  /**
   * Abort after this many ms and report the outcome as *unknown*.
   *
   * A write that never returns is the one case where the UI genuinely
   * cannot say whether it landed — the request left, and silence is not
   * evidence either way (BLK-41). Spinning forever is worse than
   * saying so: the user cannot act, and reloading is exactly the thing
   * that would tell them. Reads do not need this; there is nothing at
   * stake in an unanswered GET.
   */
  readonly timeoutMs?: number;
}

/**
 * A 200 whose JSON body is truncated or malformed.
 *
 * Distinct from a network failure: the server answered, and answered
 * with something that is not what it claimed in `content-type`.
 */
export class UnparseableBodyError extends Error {
  constructor(cause: unknown) {
    super("the response from the LocTT server could not be read");
    this.name = "UnparseableBodyError";
    this.cause = cause;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  // 204 No Content has no body — fetch will return an empty string,
  // not valid JSON, so short-circuit.
  if (res.status === 204) return undefined;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await res.json()) as unknown;
    } catch (err) {
      // A body that will not parse is a *failure*, not an absent
      // value. Returning undefined here made a truncated 200 render as
      // an empty list — a read that silently produced "no tasks" from
      // a broken response, which ERR-19 forbids and which ERR-39 calls
      // the bare-catch failure by name.
      //
      // On an error response the body is only ever detail, so a
      // failure to parse it must not replace the status the caller
      // already has.
      if (res.ok) throw new UnparseableBodyError(err);
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

function isAbort(err: unknown): boolean {
  // `AbortSignal.timeout` rejects with `TimeoutError`, not `AbortError`
  // — and `AbortSignal.any` propagates whichever fired. Matching only
  // AbortError silently missed every deadline.
  return err instanceof Error
    && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * Adds a deadline without discarding a caller's own signal — React
 * Query passes one for unmount cancellation, and dropping it would
 * leave requests running after the component is gone.
 */
function withTimeout(init: RequestInit, deadline: AbortSignal | undefined): RequestInit {
  if (deadline === undefined) return init;
  return {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  };
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
  let res: Response;
  // A dedicated controller rather than `AbortSignal.timeout`, so the
  // deadline is distinguishable *after the fact*. `timeout()` keeps
  // running once the caller aborts, so a component that unmounts at
  // 10ms under a 30s deadline later reads as timed-out — and the user
  // gets "LocTT cannot tell whether this was saved" for a routine
  // navigation.
  const deadlineCtl = new AbortController();
  let timedOut = false;
  const timer = options.timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        deadlineCtl.abort();
      }, options.timeoutMs);
  // Stop the clock the instant the caller aborts. Without this the
  // deadline keeps running and can fire in the gap between fetch
  // rejecting and this function's catch block, so an unmount at 10ms
  // under a 30s deadline reports as a timeout — telling the user LocTT
  // cannot say whether their write saved, for a routine navigation.
  options.signal?.addEventListener("abort", () => {
    if (timer !== undefined) clearTimeout(timer);
  }, { once: true });
  try {
    res = await fetch(endpoint, withTimeout(init, timer === undefined ? undefined : deadlineCtl.signal));
  } catch (err) {
    // Only *our* deadline means the outcome is unknown. A caller's own
    // abort — React Query cancelling on unmount — is a cancellation,
    // and reporting that as "we cannot tell whether this saved" would
    // be alarming and wrong.
    if (isAbort(err) && timedOut) {
      // Not success, not failure. Per P4's rare exception the caller
      // must say all three things: what was attempted, what state the
      // data is in, and what to do — so the envelope carries
      // `data_state: "unknown"` and a reload, not a retry. Retrying a
      // write that may have landed is how one archive becomes two.
      // A read and a write time out differently. Nothing was at stake
      // in an unanswered GET — the data either arrived or it did not,
      // and repeating it is safe, so it gets a retry (LST-52). A write
      // may have landed, which is the one case where the honest answer
      // is "unknown" and the action is a reload: re-sending is how one
      // archive becomes two (BLK-41).
      const isRead = method === "GET";
      throw new ApiError(`${endpoint} did not respond`, {
        status: 0,
        body: undefined,
        endpoint,
        envelope: isRead
          ? {
              code: "unknown",
              message: "the server did not respond",
              recovery: { kind: "retry" },
            }
          : {
              code: "unknown",
              message: "the server did not respond, so LocTT cannot tell whether this was saved",
              data_state: "unknown",
              recovery: { kind: "reload" },
            },
      });
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

/**
 * POSTs a `File` as `multipart/form-data`, sharing this module's error
 * handling with every other call site.
 *
 * `apiRequest` cannot carry this: it JSON-stringifies `body` and sets
 * `Content-Type: application/json`, and a multipart upload needs the
 * browser to set the header itself so it can append the boundary. So
 * the fetch is its own, and the response handling is the same three
 * lines — parse, throw `ApiError` with the envelope, return.
 *
 * Deliberately no `timeoutMs`. A 50 MB upload over a slow disk can
 * legitimately outlast any deadline short enough to be useful, and
 * the write-timeout envelope ("LocTT cannot tell whether this was
 * saved") would be wrong far more often than it was right.
 */
async function postFile<T>(
  endpoint: string,
  file: File,
  fieldName = "file",
): Promise<T> {
  const form = new FormData();
  form.append(fieldName, file, file.name);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      // No Content-Type: the browser writes it, with the boundary.
      headers: { [CLIENT_HEADER]: CLIENT_NAME, Accept: "application/json" },
      body: form,
    });
  } catch {
    // REL-47: the connection dropped mid-upload — `fetch` rejects with a
    // bare `TypeError` ("Failed to fetch") that names nothing. The upload
    // route is atomic: it parses the body into an OS temp dir and only
    // renames into `tasks/<id>/attachments/` on success, removing the
    // temp dir in a `finally`. So a dropped connection means the file was
    // never attached — nothing partial is left on disk (proven by
    // ERR-24's server test) — which makes the state knowable as
    // "incomplete", not the P4 "unknown" write case, and makes retry
    // safe (it cannot duplicate a write that never landed). The panel
    // frames the file name and the retry; this only has to say, in the
    // envelope, that the transfer did not complete and may be retried.
    throw new ApiError(`${endpoint}: the upload did not complete`, {
      status: 0,
      body: undefined,
      endpoint,
      envelope: {
        code: "unknown",
        message: "the upload did not complete",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      },
    });
  }
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
  postFile,
  get: <T>(endpoint: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "GET" }),
  post: <T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "POST", body }),
  put: <T>(endpoint: string, body: unknown, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "PUT", body }),
  delete: <T>(endpoint: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T> =>
    apiRequest<T>(endpoint, { ...options, method: "DELETE" }),
};
