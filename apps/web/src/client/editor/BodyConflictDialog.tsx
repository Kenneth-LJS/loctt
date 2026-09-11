/**
 * The body conflict surface (XS-12, TSK-35, XS-65).
 *
 * Shown when a write was **refused** — nothing was written, and the
 * user has to choose. The design constraints come straight from the
 * cases and each one rules out a cheaper surface:
 *
 *  - **Both texts in full**, scrollable, not summarized and not
 *    diff-only. A diff with no way to see the original leaves a user
 *    who wants to salvage a sentence from "theirs" with nowhere to
 *    read it.
 *  - **The outcome of each choice is stated before clicking.** "Keep
 *    mine" and "keep theirs" are destructive in opposite directions
 *    and neither word says which text dies.
 *  - **Dismissing does not write.** It returns to the editor with the
 *    user's text intact — XS-65's "the conflict surface can be
 *    re-entered; it does not vanish leaving the user with no way back
 *    to their text".
 *
 * "Keep both" is offered because in the common case — a CLI `--append`
 * against a UI edit elsewhere in the body — it is the only choice that
 * loses nothing, and XS-11's third bullet asks for exactly that
 * outcome with the user told a merge happened.
 */

import { useEffect, useRef, useState } from "react";

import { useInertBackground } from "../ui/Modal.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import type { BodyConflict } from "./useBodyAutosave.ts";

export function BodyConflictDialog({
  taskRef, conflict, onResolve, onDismiss,
}: {
  readonly taskRef: string;
  readonly conflict: BodyConflict;
  readonly onResolve: (text: string) => void;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const [choice, setChoice] = useState<"mine" | "theirs" | "both" | null>(null);

  // K71: this dialog is wider than Modal's max-w-md panel (a two-column
  // diff needs max-w-4xl), so it cannot drop into Dialog/Modal without
  // breaking its layout. Instead it uses the SAME apparatus Modal uses,
  // directly on its own panel: focus trap + focus restore (A11Y-14/15),
  // inert background, and Escape-to-dismiss. Previously it had none of
  // these — Tab leaked to the editor behind it.
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useInertBackground(panelRef);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onDismiss]);

  /**
   * The merged text for "keep both". Concatenation with a separating
   * blank line, matching core's `appendTaskBody` spacing so the result
   * looks the same whichever surface produced it. Deliberately *not* a
   * three-way merge: there is no common ancestor to merge against
   * here, and a silent line-level merge is how conflicting edits get
   * interleaved into nonsense that reads as if the user wrote it.
   */
  const both = `${conflict.theirs.replace(/\n+$/, "")}\n\n${conflict.mine.replace(/^\n+/, "")}`;

  const preview =
    choice === "mine" ? conflict.mine
      : choice === "theirs" ? conflict.theirs
        : choice === "both" ? both
          : null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"
      onMouseDown={e => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${taskRef} changed while you were editing`}
        data-testid="body-conflict"
        tabIndex={-1}
        className="flex max-h-full w-full max-w-4xl flex-col gap-3 overflow-hidden rounded border border-border-default bg-bg-surface p-4 shadow-overlay"
      >
        <div>
          <h2 className="text-[14px] font-medium text-text-primary">
            {taskRef} changed while you were editing
          </h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            Nothing has been saved. Your text is still in the editor. Choose
            which version to keep.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
          <Version
            title="Yours (in the editor, not saved)"
            testid="conflict-mine"
            text={conflict.mine}
          />
          <Version
            title="On disk now (changed by another edit)"
            testid="conflict-theirs"
            text={conflict.theirs}
          />
        </div>

        <fieldset className="flex flex-col gap-1 text-[13px]">
          <legend className="sr-only">Resolution</legend>
          <Choice
            id="mine" checked={choice === "mine"} onSelect={setChoice}
            label="Keep mine"
            outcome="Replaces what is on disk with your text. The other edit is lost."
          />
          <Choice
            id="theirs" checked={choice === "theirs"} onSelect={setChoice}
            label="Keep theirs"
            outcome="Discards your text and keeps what is on disk."
          />
          <Choice
            id="both" checked={choice === "both"} onSelect={setChoice}
            label="Keep both"
            outcome="Writes the disk version followed by yours, separated by a blank line."
          />
        </fieldset>

        {preview !== null && (
          <div>
            <p className="text-[12px] text-text-tertiary">Result:</p>
            <pre
              data-testid="conflict-preview"
              className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-muted p-2 text-[12px] text-text-primary"
            >
              {preview}
            </pre>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="conflict-dismiss"
            onClick={onDismiss}
            className="rounded px-3 py-1 text-[13px] text-text-secondary hover:bg-bg-muted"
          >
            Cancel — save nothing
          </button>
          <button
            type="button"
            data-testid="conflict-apply"
            disabled={preview === null}
            onClick={() => { if (preview !== null) onResolve(preview); }}
            className="rounded bg-accent px-3 py-1 text-[13px] text-accent-contrast disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/** One side of the conflict, in full and scrollable. */
function Version(
  { title, text, testid }: { readonly title: string; readonly text: string; readonly testid: string },
): React.JSX.Element {
  return (
    <section className="flex min-h-0 flex-col">
      <h3 className="text-[12px] font-medium text-text-secondary">{title}</h3>
      <pre
        data-testid={testid}
        className="mt-1 max-h-48 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-border-subtle bg-bg-muted p-2 text-[12px] text-text-primary"
      >
        {/* A whitespace-only version renders as a blank box, which
            tells the user nothing about what they are choosing —
            "keep theirs" would look identical to a rendering bug. */}
        {text.trim() === "" ? "(empty)" : text}
      </pre>
    </section>
  );
}

function Choice({
  id, label, outcome, checked, onSelect,
}: {
  readonly id: "mine" | "theirs" | "both";
  readonly label: string;
  readonly outcome: string;
  readonly checked: boolean;
  readonly onSelect: (c: "mine" | "theirs" | "both") => void;
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2">
      <input
        type="radio"
        name="conflict-resolution"
        data-testid={`conflict-choice-${id}`}
        checked={checked}
        onChange={() => { onSelect(id); }}
        className="mt-1"
      />
      <span>
        <span className="text-text-primary">{label}</span>{" "}
        {/* The outcome sits in the label, not in a tooltip: XS-12 wants
            it stated *before* clicking, and a tooltip is not. */}
        <span className="text-text-tertiary">— {outcome}</span>
      </span>
    </label>
  );
}
