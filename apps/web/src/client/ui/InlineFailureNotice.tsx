import type { ErrorResponse } from "@loctt/contracts";

import { ApiError } from "../api/client.ts";

/**
 * A rejected mutation, rendered **inline at the control that failed** —
 * A328 (B6, PM call). `FieldFailureNotice` is the sibling for a task-field
 * write, which always has a task key and a field to name; this is the one
 * for everything else (a confirm box, a dialog, a row) that only has a
 * headline sentence and a data-state claim.
 *
 * Renders exactly what messaging.md asks for a failure to carry: what
 * happened (the caller's `message`), what it did to the data
 * ({@link dataStateOf}'s claim), and one next action (`onRetry`, when
 * retrying can help). Never a toast, never the page-level `ErrorState` —
 * A328 is explicit that each of the three call sites gets its own inline
 * notice and stays open on error.
 */
export function InlineFailureNotice({
  message,
  dataState,
  onRetry,
  testId,
}: {
  /** The headline sentence, already resolved per messaging.md. */
  readonly message: string;
  readonly dataState: ErrorResponse["data_state"] | undefined;
  /** Omit when retrying cannot help. */
  readonly onRetry?: (() => void) | undefined;
  readonly testId?: string | undefined;
}) {
  return (
    <div
      role="alert"
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      data-data-state={dataState ?? "none"}
      className="mt-1 rounded border border-danger-fg/30 bg-danger-fg/5 px-1.5 py-1 text-[0.7857rem] text-danger-fg"
    >
      <p data-testid={testId !== undefined ? `${testId}-message` : undefined}>{message}</p>
      {onRetry !== undefined && (
        <button
          type="button"
          data-testid={testId !== undefined ? `${testId}-retry` : undefined}
          onClick={onRetry}
          className="mt-0.5 underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Reads the envelope's `data_state` off a mutation error the way
 * `FieldFailureNotice`/`ErrorState` do: an `ApiError` with an envelope
 * carries it directly; anything else (a transport failure, a plain
 * `Error`) never reached the server, so nothing was written.
 */
export function dataStateOf(error: unknown): ErrorResponse["data_state"] | undefined {
  if (error instanceof ApiError && error.envelope !== undefined) {
    return error.envelope.data_state;
  }
  return error instanceof ApiError ? undefined : "not_saved";
}
