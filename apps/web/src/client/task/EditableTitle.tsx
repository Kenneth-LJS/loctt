import { useEffect, useRef, useState } from "react";

import type { FieldFailure } from "./fieldFailure.ts";
import { FieldFailureNotice } from "./FieldFailureNotice.tsx";

/**
 * The task title, editable in place (L1 — the GUI's core/surface parity
 * hole: core, CLI and MCP can all rename a task via the `title` field,
 * and the detail page could not).
 *
 * ## Read vs. edit
 *
 * At rest the title is an `<h1>` — the page's heading semantics are kept
 * whether or not the field is editable. It is also a `button` so it is
 * keyboard-reachable and announces as editable; clicking it (or Enter /
 * Space when focused) swaps to a text input seeded with the current
 * title. Enter or blur commits; Escape reverts and returns focus to the
 * heading (TSK-41's shape, matching `DateField`).
 *
 * ## Empty is refused client-side
 *
 * Core treats `title` as non-empty (a rename to `""` is rejected). Rather
 * than send a write the server will bounce, an empty (whitespace-only)
 * draft is refused here: the commit is a no-op and the input stays open
 * with the original value, so the user is never left with a blank
 * heading. A committed *unchanged* title is also a no-op — no write, no
 * failure notice churn.
 *
 * ## Absent / corrupt title (K26)
 *
 * `title` is field-local: a corrupt or absent title still loads the task
 * (its identity is `id`/`key`). The read state then falls back to the
 * key, exactly like `BoardCard`, so the heading is never blank. Editing
 * still seeds from the *actual* title (empty), so committing a real one
 * repairs it.
 *
 * ## Write path
 *
 * The same `onSet("title", …)` the MetaPanel editors funnel through
 * (`useSetField` → `POST /api/tasks/:ref/set`). A rejection is handed
 * back as a `FieldFailure` and rendered under the heading with the shared
 * `FieldFailureNotice`.
 */
export function EditableTitle({
  title,
  taskKey,
  onCommit,
  error,
  onRetry,
  onDismiss,
}: {
  /** The stored title, or undefined when absent/corrupt (K26). */
  readonly title: string | undefined;
  /** The task's current key — the K26 fallback and the failure notice. */
  readonly taskKey: string;
  /** Writes the new title through the shared field-write path. */
  readonly onCommit: (title: string) => void;
  /** A server rejection of a title write, rendered under the heading. */
  readonly error?: FieldFailure | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // A refetch (or another tab's write, XS-54) changing the stored title
  // must reach a field the user is not currently typing in.
  useEffect(() => {
    if (!editing) setDraft(title ?? "");
  }, [title, editing]);

  const commit = (): void => {
    const next = draft.trim();
    // Empty is refused (core requires non-empty): stay open with the
    // original value rather than send a write the server will reject or,
    // worse, leave the heading blank.
    if (next === "") {
      setDraft(title ?? "");
      return;
    }
    setEditing(false);
    if (next === (title ?? "")) return;
    onCommit(next);
  };

  const cancel = (): void => {
    setDraft(title ?? "");
    setEditing(false);
    triggerRef.current?.focus();
  };

  // K26: a blank/absent title falls back to the key for display.
  const shown = title === undefined || title === "" ? taskKey : title;

  return (
    <div>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          data-testid="task-title-input"
          aria-label="Task title"
          value={draft}
          onChange={e => { setDraft(e.target.value); }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          className="w-full rounded border border-border-subtle bg-bg-surface px-1.5 py-0.5 text-[1.4286rem] font-semibold leading-tight text-text-primary"
        />
      ) : (
        // The h1 stays — heading semantics are kept in the read state.
        // The inner button is what carries the edit affordance and focus
        // ring; `title` makes the full string recoverable on hover even
        // when it wraps to a clamped height (TSK-24).
        <h1 className="break-words text-[1.4286rem] font-semibold leading-tight text-text-primary">
          <button
            ref={triggerRef}
            type="button"
            data-testid="task-title-edit"
            title={title ?? undefined}
            aria-label={`Task title: ${shown}. Edit`}
            onClick={() => { setEditing(true); }}
            className="-mx-1 w-full rounded px-1 text-left break-words hover:cursor-text hover:bg-bg-muted focus-visible:bg-bg-muted"
          >
            {shown}
          </button>
        </h1>
      )}
      {error !== undefined && (
        <FieldFailureNotice
          failure={error}
          taskKey={taskKey}
          {...(error.retry !== undefined && onRetry !== undefined ? { onRetry } : {})}
          {...(onDismiss !== undefined ? { onDismiss } : {})}
        />
      )}
    </div>
  );
}
