/**
 * The error shape every surface can report from.
 *
 * V1: core owns validation, so core also owns the *cause*. Before this,
 * all 52 error classes in core carried only a message string — so the
 * CLI, MCP and web each had to infer what went wrong. The web guessed
 * from the HTTP status (`codeForStatus`, `server.ts:286`), which turned
 * an archived-reference rejection into `validation_failed` because it
 * arrived as a 400.
 *
 * The fields mirror `ErrorResponse` in `@loctt/contracts`, which was
 * derived from the ERR-* cases and already existed. This is not a new
 * taxonomy — it is core filling in an envelope the web was previously
 * assembling from guesses.
 *
 * **Core writes the sentence.** ERR-6 is explicit: *"Whatever core says
 * — e.g. 'cannot assign an archived user' — reaches the user in words
 * core chose, because core's error text is already user-facing."* So
 * `message` is the headline, not a key for a surface to translate.
 *
 * ERR-16 bars `ZodError`, `ENOENT`, `EACCES` and stack traces from that
 * headline; they belong in `detail`, behind a "Show details"
 * affordance. Paths inside `.loctt/` are the carve-out — they are the
 * user's own files and the thing they must go and fix.
 */

import type {
  ErrorCode,
  ErrorDataState,
  ErrorRecovery,
  ErrorResponse,
} from "@loctt/contracts";

export interface LocttErrorOptions {
  /**
   * The field at fault, when the failure belongs to one. The UI renders
   * a field-level rejection *at the input* (ERR-14) and infers that
   * placement from this being present — which is why the shape
   * describes the error rather than naming a presentation (V8).
   */
  readonly field?: string;
  /**
   * Saved, not saved, or unknown. **Required on write paths** by
   * ERR-18; ERR-3 calls it "the single most important error behaviour
   * in the app", because a user who cannot tell whether their edit
   * landed either re-does it or walks away having lost it.
   *
   * Omitted on reads, where nothing was at stake.
   */
  readonly dataState?: ErrorDataState;
  /** Rendered as a control, never as prose (ERR-15). */
  readonly recovery?: ErrorRecovery;
  /** Technical text for a details affordance — never the headline. */
  readonly detail?: string;
  readonly cause?: unknown;
}

/**
 * Base class for errors core raises about the user's data.
 *
 * Existing classes keep their names and extend this, so
 * `instanceof TaskUpdateError` keeps working while the error gains a
 * cause a surface can branch on.
 */
export class LocttError extends Error {
  readonly code: ErrorCode;
  readonly field: string | undefined;
  readonly dataState: ErrorDataState | undefined;
  readonly recovery: ErrorRecovery | undefined;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message: string, opts: LocttErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "LocttError";
    this.code = code;
    this.field = opts.field;
    this.dataState = opts.dataState;
    this.recovery = opts.recovery;
    this.detail = opts.detail;
  }

  /**
   * The envelope, ready to serialise.
   *
   * Optional fields are omitted rather than set to `undefined`, so a
   * JSON body carries only what is known — an absent `data_state` and a
   * null one would otherwise be indistinguishable to a client.
   */
  toEnvelope(): ErrorResponse {
    return {
      code: this.code,
      message: this.message,
      ...(this.field !== undefined ? { field: this.field } : {}),
      ...(this.dataState !== undefined ? { data_state: this.dataState } : {}),
      ...(this.recovery !== undefined ? { recovery: this.recovery } : {}),
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
    };
  }
}

/**
 * Reads the envelope off any error.
 *
 * A `LocttError` answers for itself. Anything else is a cause core did
 * not attribute — a bug, a dependency throwing, a raw errno — and gets
 * `unknown`, which ERR-30 permits *only* here and only alongside a data
 * state and a recovery. ERR-31 forbids reaching for it to avoid
 * enumerating a cause that is actually known.
 *
 * The raw message goes to `detail`, not to `message`: an unattributed
 * error's text is exactly the kind of thing ERR-16 keeps out of a
 * headline.
 */
export function errorEnvelope(err: unknown): ErrorResponse {
  if (err instanceof LocttError) return err.toEnvelope();
  return {
    code: "unknown",
    message: "Something failed. The cause could not be determined.",
    data_state: "unknown",
    recovery: { kind: "retry" },
    ...(err instanceof Error && err.message !== ""
      ? { detail: err.message }
      : {}),
  };
}
