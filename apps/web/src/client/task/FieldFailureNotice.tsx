import { Link } from "@tanstack/react-router";

import type { FieldFailure } from "./fieldFailure.ts";

/**
 * A rejected field write, rendered **at the control that failed**.
 *
 * P4 and ERR-14 put it here rather than in a toast, and the three
 * things it must say are the three ERR-3 enumerates: what was being
 * changed, what state the data is in, and what to do about it. A
 * message alone carries only the first.
 *
 * ## The data-state line is not decoration
 *
 * ERR-3 is explicit that "failed to update" is *not* enough — the
 * claim about the file has to be present in words. And ERR-4 is the
 * mirror: a write that timed out must not claim either outcome. So the
 * three states get three different sentences, and there is no default
 * branch that would quietly turn an unknown into a "not saved".
 *
 * ## Why retry is a prop rather than a `recovery` read
 *
 * Two cases turn on retry being *absent*: XS-57 (the task is gone, so
 * re-sending cannot help) and ERR-4 (the write may have landed, so
 * re-sending could double-apply). Both are decided in
 * `toFieldFailure`, which has the envelope; this component renders
 * what it is handed.
 */
export function FieldFailureNotice({
  failure,
  taskKey,
  onRetry,
  onDismiss,
}: {
  readonly failure: FieldFailure;
  /** The task's *current* key — never a ULID (XS-57, P4). */
  readonly taskKey: string;
  /** Omitted when retrying cannot help or could double-apply. */
  readonly onRetry?: (() => void) | undefined;
  /** Omit to render no Dismiss control rather than a dead one. */
  readonly onDismiss?: (() => void) | undefined;
}) {
  const gone = failure.code === "not_found";
  return (
    <div
      role="alert"
      data-testid="meta-field-error"
      data-field={failure.field}
      data-code={failure.code ?? "none"}
      data-data-state={failure.dataState ?? "none"}
      className="mt-1 rounded border border-danger-fg/30 bg-danger-fg/5 px-1.5 py-1 text-[0.7857rem] text-danger-fg"
    >
      {/* Names the field and the task, so a message read out of the
          corner of the eye still identifies what it is about — ERR-3's
          third bullet, which a bare server message does not satisfy. */}
      <p data-testid="meta-field-error-message">
        <span className="font-medium">{fieldLabel(failure.field)}</span>
        {" on "}
        <span>{taskKey}</span>
        {": "}
        {failure.message}
      </p>

      <p data-testid="meta-field-error-state" className="mt-0.5 text-text-secondary">
        {DATA_STATE_COPY[failure.dataState ?? "not_saved"]}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {onRetry !== undefined && (
          <button
            type="button"
            data-testid="meta-field-error-retry"
            onClick={onRetry}
            className="underline"
          >
            Retry
          </button>
        )}
        {failure.recovery?.kind === "reload" && (
          <button
            type="button"
            data-testid="meta-field-error-reload"
            onClick={() => { window.location.reload(); }}
            className="underline"
          >
            Reload
          </button>
        )}
        {gone && (
          // XS-57's fourth bullet. The page the user is on is a task
          // that does not exist; the only useful move is off it, and
          // it is the *primary* action here precisely because retry is
          // not offered.
          <Link
            to="/list"
            data-testid="meta-field-error-back"
            className="font-medium underline"
          >
            Back to the task list
          </Link>
        )}
        {/* A Dismiss that dismisses nothing is a control that lies
            about being one. Rendered only when the caller can
            actually clear the failure. */}
        {onDismiss !== undefined && (
          <button
            type="button"
            data-testid="meta-field-error-dismiss"
            onClick={onDismiss}
            className="text-text-tertiary underline"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The three claims, kept verbally distinct.
 *
 * "Unknown" names the check rather than gesturing at one: ERR-4
 * requires the message tell the user *how to find out*, and "check
 * again" would not. `loctt show` is the surface that reads the file
 * directly, which is the answer that cannot be wrong.
 */
const DATA_STATE_COPY = {
  saved: "Your change was saved.",
  not_saved: "Your change was not saved.",
  unknown:
    "LocTT cannot tell whether this was saved. Reload the page, or run "
    + "`loctt show` in a terminal to see what the file holds.",
} as const;

/**
 * A field key rendered for a reader.
 *
 * `start_date` → "Start date". Not a map from field name to caption:
 * a map would have to be kept in step with core's field set, and a
 * custom field the user declared would fall out of it entirely and
 * render blank. Underscores to spaces is right for every one of them.
 */
function fieldLabel(field: string): string {
  const words = field.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
