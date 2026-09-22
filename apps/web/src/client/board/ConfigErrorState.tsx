import type { ApiError } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";

/**
 * BRD-45 — a `workflow.yaml` the loader refuses.
 *
 * ## Why this is a refusal and not a fallback
 *
 * The case's own wording imagines a board that "does not silently fall
 * back to 1:1 columns without saying so", which reads as though a
 * fallback were available. Measured, it is not: `BoardsConfigSchema`
 * rejects a duplicated status at parse time, so `loadWorkflowConfig`
 * throws and **every** read fails — `/api/workflow` and `/api/tasks`
 * both return 400 `config_invalid`. There is no parsed config to fall
 * back *with*, and no task list to draw. Ken ruled that validation
 * stays strict and the web renders the refusal well rather than
 * relaxing the schema to make a fallback reachable.
 *
 * So this is the designed configuration-error state the case asks
 * for: it names the file, the offending columns and the duplicated
 * status key, and it says how to fix it. It is not a white pane and it
 * is not a crash surface.
 *
 * The envelope's `message` already carries the specifics (core builds
 * it: "workflow.yaml is not valid: boards.columns[1].statuses[0]
 * status 'blocked' already appears in column index 0"). It is shown
 * verbatim rather than re-derived — core owns the attribution, and a
 * second parser here would drift from it (A11's reasoning, in the
 * other direction).
 */
export function ConfigErrorState({
  error,
  onRetry,
}: {
  readonly error: ApiError;
  readonly onRetry: () => void;
}) {
  const message = error.envelope?.message ?? error.message;

  return (
    <div className="p-4" data-testid="board-config-error">
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-md border border-danger-fg/30 bg-danger-fg/5 p-4"
      >
        <h2 className="text-[1.0714rem] font-semibold text-text-primary">
          The board configuration could not be read
        </h2>

        {/* Names the file and the offending keys — the whole point of
            the case. This is core's message, unedited. */}
        <p className="mt-2 text-[0.8571rem] text-danger-fg" data-testid="board-config-error-message">
          {message}
        </p>

        <p className="mt-3 text-[0.9286rem] text-text-secondary">
          Every column on a board must claim a status no other column
          claims, so a card has exactly one place to be. While{" "}
          <code>.loctt/config/workflow.yaml</code>{" "}
          says otherwise, nothing can be read from it — the board, the
          list and the CLI all refuse it alike.
        </p>

        <div className="mt-3 text-[0.9286rem] text-text-secondary">
          To fix it, edit{" "}
          <code>.loctt/config/workflow.yaml</code> and
          either:
          <ul className="ml-5 mt-1 list-disc space-y-1">
            <li>
              remove the duplicated status from one of the two columns
              named above, so each status appears once; or
            </li>
            <li>
              delete the whole <code>boards:</code>{" "}
              block, which returns the board to one column per status.
            </li>
          </ul>
        </div>

        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
          Reload the configuration
        </Button>
      </div>
    </div>
  );
}
