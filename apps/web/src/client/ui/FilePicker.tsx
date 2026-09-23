import { type ChangeEvent, type ReactNode, useRef, useState } from "react";

import { Button } from "./Button.tsx";

/**
 * The one file-input trigger. `settings/BackupPanel.tsx` rendered a bare
 * `<input type="file">`, so the browser's native "Choose file / No file
 * chosen" widget sat among the app's custom controls — the defect Ken
 * flagged from a live walkthrough. `attachments/AttachmentsPanel.tsx`
 * already had the fix's shape (a hidden input plus a visible trigger that
 * proxies a click to it via a ref), just not factored out; this absorbs
 * that pattern so there is exactly one implementation, not two — both
 * panels now render through this component.
 *
 * ## The "meta" API (Ken's design, verbatim)
 *
 * > "make it a 'meta' component: if its child is a react component
 * > rendered, just render. if its a function that takes in the
 * > filename/state/etc, then it renders the result of that function
 * > which is a component (can be button or otherwise)"
 *
 * `children` is either:
 *  - a plain `ReactNode` — rendered as the content of a default `Button`
 *    (`variant="secondary"`), which owns the click-to-open proxy; or
 *  - a `(state: FilePickerState) => ReactNode` — called with the current
 *    state and rendered as-is, so the caller's own element (a `Button`,
 *    a link-styled `<button>`, anything) owns rendering AND decides how
 *    to wire `state.open` to its own click handler.
 *
 * Either way, `FilePicker` owns the hidden `<input type="file">`, the ref
 * that opens it, and the "same file can be re-picked twice in a row"
 * value-clear `AttachmentsPanel` already relied on — the pieces every
 * caller needs and must not reimplement per call site.
 *
 * ## Single vs. multiple
 *
 * `onFiles` always receives the full `FileList | null` — the multi-file
 * case (`AttachmentsPanel`'s drop-additional-files Upload button) needs
 * every selected file, and a single-file caller (`BackupPanel`) just
 * reads `files?.[0]`. There is no separate single-file callback: two
 * callback shapes for what is structurally one event would be the "two
 * implementations" this component exists to avoid, just moved inside
 * itself.
 *
 * ## Accessibility
 *
 * The input is hidden with `.sr-only` positioning (off-screen, not
 * `display: none`/`hidden` and not `aria-hidden`), so it stays in the
 * keyboard tab order and reachable by assistive tech even though the
 * visible trigger is what a sighted user clicks. The default (plain-
 * child) form renders a real `<button type="button">` as that visible
 * trigger, whose `onClick` proxies to the input via `inputRef` — exactly
 * `AttachmentsPanel`'s prior pattern, now shared. A render-function
 * caller must render its own real, focusable control (a `<button>`, not
 * a `<div onClick>`) — this primitive cannot enforce that from outside.
 */

export interface FilePickerState {
  /** The first chosen file's name, or `undefined` when none is selected. */
  readonly filename: string | undefined;
  /** `true` once at least one file is selected. */
  readonly hasFile: boolean;
  /** Opens the native file picker — wire this to a custom trigger's `onClick`. */
  readonly open: () => void;
}

export interface FilePickerProps {
  /**
   * A plain node (rendered inside a default `Button`) or a render
   * function receiving the current `FilePickerState` and returning the
   * trigger to display.
   */
  readonly children: ReactNode | ((state: FilePickerState) => ReactNode);
  /** Called with the chosen files, or `null` if the selection was cleared/cancelled. */
  readonly onFiles: (files: FileList | null) => void;
  /** Forwarded to the underlying `<input multiple>`. */
  readonly multiple?: boolean;
  /** Forwarded to the underlying `<input accept="...">`. */
  readonly accept?: string;
  /** Forwarded to the underlying `<input disabled>`; also disables the default `Button`. */
  readonly disabled?: boolean;
  /** `data-testid` on the hidden `<input>`. */
  readonly testId?: string;
  /** `data-testid` on the default `Button` (ignored when `children` is a render function — the caller's own element owns its testId then). */
  readonly triggerTestId?: string;
}

export function FilePicker({
  children,
  onFiles,
  multiple,
  accept,
  disabled,
  testId,
  triggerTestId,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | undefined>(undefined);

  const open = (): void => {
    inputRef.current?.click();
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const list = e.target.files;
    const hasAny = list !== null && list.length > 0;
    setFilename(hasAny ? list[0]?.name : undefined);
    onFiles(hasAny ? list : null);
    // Clearing the input value lets the same file be chosen twice in a
    // row — how a user retries after a refusal (AttachmentsPanel's prior
    // behaviour, preserved here for every caller).
    e.target.value = "";
  };

  const state: FilePickerState = { filename, hasFile: filename !== undefined, open };

  return (
    <>
      {typeof children === "function"
        ? children(state)
        : (
            <Button
              type="button"
              variant="secondary"
              {...(triggerTestId !== undefined ? { testId: triggerTestId } : {})}
              disabled={disabled}
              onClick={open}
            >
              {children}
            </Button>
          )}
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        {...(accept !== undefined ? { accept } : {})}
        disabled={disabled}
        data-testid={testId}
        // Off-screen, not `hidden`/`display:none` and not `aria-hidden`:
        // the input must stay in the tab order and remain the thing a
        // screen reader / keyboard user can still reach and activate
        // directly (Space/Enter on a focused file input opens the native
        // picker), even though the visible trigger is what callers see.
        className="sr-only"
        onChange={handleChange}
      />
    </>
  );
}
