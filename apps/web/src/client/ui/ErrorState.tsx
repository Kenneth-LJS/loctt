import type { ErrorResponse } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";

/**
 * The one place a failure is rendered, so ERR-15/16/18 hold everywhere
 * rather than per call site.
 *
 * The bug this exists for: a failed `/api/tasks` rendered as "No tasks
 * match these filters." A server that is down and a tracker that is
 * empty must be visibly different screens — conflating them reads as
 * data loss (ERR-1).
 *
 * What it renders, from the envelope the server already sends:
 *
 *  - the headline `message`, written for a user (ERR-16)
 *  - `data_state`, so a write failure says whether the change landed —
 *    the user's next action depends on it (ERR-18)
 *  - `recovery` as a **control**, not prose: a Retry button, a Reload
 *    button, or a copyable command (ERR-15)
 *  - `detail` behind "Show details", which is the only place technical
 *    text is allowed (ERR-16)
 *
 * A failure that never reached the API has no envelope — an unreachable
 * server, an HTML page from something upstream. That case is named
 * explicitly rather than falling back to a generic string, because a
 * local app has no network to blame (ERR-1).
 */

interface Props {
  readonly error: unknown;
  /** Invoked by the Retry control. Omit when retrying cannot help. */
  readonly onRetry?: (() => void) | undefined;
  /** Shown above the message: what was being attempted (ERR-30). */
  readonly context?: string | undefined;
}

const DATA_STATE_COPY: Record<NonNullable<ErrorResponse["data_state"]>, string> = {
  saved: "Your change was saved.",
  not_saved: "Your change was not saved.",
  unknown: "Whether your change was saved is not known — reload to check.",
};

/**
 * The server is unreachable when the request never got a response.
 *
 * `apiRequest` does not wrap `fetch`, so a transport failure throws a
 * raw `TypeError` and never becomes an `ApiError` — anything that is
 * not an `ApiError` therefore never reached the server. The
 * distinction matters: this is a local process the user started, so
 * the likely cause is nameable rather than mysterious (ERR-1).
 */
function isUnreachable(error: unknown): boolean {
  return !(error instanceof ApiError);
}

function envelopeOf(error: unknown): ErrorResponse | undefined {
  return error instanceof ApiError ? error.envelope : undefined;
}

function headline(error: unknown): string {
  const envelope = envelopeOf(error);
  if (envelope) return envelope.message;
  if (isUnreachable(error)) {
    // Names the actual likely cause. "Check your connection" is wrong
    // for localhost, and "Something went wrong" fails ERR-30.
    return "The LocTT server is not responding. It may have been stopped in the terminal where you ran `loctt ui`.";
  }
  return error instanceof Error ? error.message : "The request failed.";
}

export function ErrorState({ error, onRetry, context }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const envelope = envelopeOf(error);
  const recovery = envelope?.recovery
    // No envelope means we never reached the server, and retrying is
    // exactly the right action once it is back up.
    ?? (isUnreachable(error) ? ({ kind: "retry" } as const) : undefined)
    // An envelope carrying no recovery still leaves the user with a
    // dead end. A read is safe to repeat — nothing was written — so
    // offering Retry is honest even when the server did not say so.
    // ERR-15 wants recovery as a *control*, and a 500 with no button
    // is the failure ONB-33 names. Writes are not covered by this:
    // they pass an explicit recovery, and re-sending one that may have
    // landed is how one archive becomes two.
    ?? (onRetry !== undefined ? ({ kind: "retry" } as const) : undefined);

  return (
    <div role="alert" className="mx-auto max-w-lg px-4 py-10 text-center">
      {context !== undefined && (
        <p className="mb-1 text-[13px] text-text-tertiary">{context}</p>
      )}
      <p className="text-[14px] text-text-primary">{headline(error)}</p>

      {envelope?.data_state !== undefined && (
        <p className="mt-2 text-[13px] text-text-secondary">
          {DATA_STATE_COPY[envelope.data_state]}
        </p>
      )}

      {/* Each failure named with its own reason — three items can fail
          three different ways, and one collapsed message hides that
          (ERR-13). */}
      {envelope?.failures !== undefined && envelope.failures.length > 0 && (
        <ul className="mt-3 space-y-1 text-left text-[13px] text-text-secondary">
          {envelope.failures.map(f => (
            <li key={f.ref}>
              <span className="font-medium text-text-primary">{f.ref}</span>: {f.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-center gap-2">
        {recovery?.kind === "retry" && onRetry !== undefined && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-border-subtle px-3 py-1.5 text-[13px] hover:bg-bg-muted"
          >
            Retry
          </button>
        )}
        {recovery?.kind === "reload" && (
          <button
            type="button"
            onClick={() => { window.location.reload(); }}
            className="rounded border border-border-subtle px-3 py-1.5 text-[13px] hover:bg-bg-muted"
          >
            Reload
          </button>
        )}
        {recovery?.kind === "command" && recovery.command !== undefined && (
          // Copyable, because the user has to retype it into a terminal
          // (ERR-15).
          <code className="select-all rounded bg-bg-muted px-2 py-1 text-[12px]">
            {recovery.command}
          </code>
        )}
      </div>

      {envelope?.detail !== undefined && (
        <div className="mt-4 text-left">
          <button
            type="button"
            onClick={() => { setShowDetail(v => !v); }}
            className="text-[12px] text-text-tertiary underline"
          >
            {showDetail ? "Hide details" : "Show details"}
          </button>
          {showDetail && (
            // The only place raw technical text is permitted (ERR-16).
            <pre className="mt-2 overflow-x-auto rounded bg-bg-muted p-2 text-[11px] text-text-secondary">
              {envelope.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
