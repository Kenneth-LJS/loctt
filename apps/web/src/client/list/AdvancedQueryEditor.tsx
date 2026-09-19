import { type KeyboardEvent as ReactKeyboardEvent, useId, useRef, useState } from "react";

import { useValidateQuery } from "../api/hooks/useValidateQuery.ts";
import { Button } from "../ui/Button.tsx";
import { dslToSearch } from "./dslToSearch.ts";
import { QUERY_SYNTAX_HELP } from "./querySyntaxHelp.ts";

/**
 * The advanced (raw DSL) half of the saved-view editor — M4.5.
 *
 * Responsibilities, by case:
 *
 *  - **VUE-8**: a textbox whose parse-error marker updates live.
 *  - **VUE-31..34 / A11Y-53**: four *distinct* error states, each
 *    naming the offending token and its position. The caret line under
 *    the box is the non-colour equivalent of the highlight, so the
 *    position is conveyed as text, not only visually.
 *  - **VUE-11**: the Basic toggle is disabled with the reason, never
 *    silently rewriting the query to fit.
 *  - **VUE-9**: the syntax popover, dismissible with Esc without
 *    discarding the query.
 *  - **VUE-23**: a 2,000-character query stays editable and is never
 *    truncated — the box scrolls.
 *
 * The error *classification* is the server's (`/api/query/validate`),
 * which reads core's error classes. This component only renders it.
 */

/** Renders the caret line that marks `position` under the query. */
function caretLine(query: string, position: number): string {
  // Clamped, so a position past the end (e.g. "unexpected end of
  // query") still lands under the last character rather than
  // overflowing the row.
  const at = Math.max(0, Math.min(position, Math.max(0, query.length - 1)));
  return `${" ".repeat(at)}^`;
}

/**
 * The token beginning at `position` — quoted in the message so the
 * offending token is identifiable without seeing the highlight
 * (A11Y-53's second bullet).
 */
function tokenAt(query: string, position: number): string {
  if (position >= query.length) return "end of query";
  const rest = query.slice(position);
  const m = /^\S+/.exec(rest);
  return m ? m[0] : "end of query";
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  syntax: "Syntax error",
  unknown_field: "Unknown field",
  unknown_value: "Unknown value",
};

export function AdvancedQueryEditor({
  value,
  onChange,
  onSwitchToBasic,
  onRun,
  onClose,
  dirty = false,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  /**
   * Called with the reconstructed basic-mode filters. Absent when the
   * editor is used somewhere with no basic mode to return to.
   */
  readonly onSwitchToBasic?: ((search: Record<string, unknown>) => void) | undefined;
  /** Runs the query. VUE-29 requires a keyboard trigger for this. */
  readonly onRun?: (() => void) | undefined;
  /** Closes the editor. VUE-29: Esc, warning first when dirty. */
  readonly onClose?: (() => void) | undefined;
  /** Whether there are unsaved changes, for the Esc warning. */
  readonly dirty?: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const { result, settled } = useValidateQuery(value);

  /**
   * VUE-29. Esc closes, but warns first when there are unsaved
   * changes — closing straight through would discard the query the
   * user is mid-way through writing. Ctrl/Cmd-Enter runs, which is the
   * keyboard trigger the case asks for; plain Enter must stay
   * available because the box is a textarea holding multi-line queries.
   */
  const onEditorKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.key === "Escape" && onClose !== undefined) {
      e.preventDefault();
      if (dirty && !confirmingClose) {
        setConfirmingClose(true);
        return;
      }
      onClose();
    }
  };

  const basic = dslToSearch(value);
  const invalid = result !== null && !result.valid;

  return (
    <div
      data-testid="advanced-query-editor"
      className="flex flex-col gap-2"
      onKeyDown={onEditorKeyDown}
    >
      <div className="flex items-center justify-between">
        <label
          htmlFor={`${errorId}-input`}
          className="text-[0.9286rem] font-medium text-text-secondary"
        >
          Query (DSL)
        </label>
        <Button
          ref={helpButtonRef}
          variant="secondary"
          size="sm"
          testId="dsl-help-toggle"
          aria-expanded={helpOpen}
          onClick={() => { setHelpOpen(o => !o); }}
        >
          Syntax help
        </Button>
      </div>

      <textarea
        id={`${errorId}-input`}
        data-testid="dsl-input"
        value={value}
        rows={4}
        spellCheck={false}
        onChange={e => { onChange(e.target.value); }}
        // A11Y-53: the message is associated with the input, so it is
        // read as the field's error rather than as loose page text.
        aria-invalid={invalid}
        aria-describedby={invalid ? `${errorId}-error` : undefined}
        // VUE-23: the box scrolls rather than clipping; no maxLength,
        // so a long query cannot be truncated on the way in.
        className="w-full resize-y overflow-auto whitespace-pre-wrap break-all rounded-md border border-border-default bg-bg-surface px-2.5 py-2 text-[0.8571rem] text-text-primary"
      />

      {/*
        VUE-8: the marker. Rendered only once the request has settled so
        it does not flicker mid-keystroke, and announced politely so it
        is not read on every character (A11Y-53's third bullet).
      */}
      <div
        id={`${errorId}-error`}
        data-testid="dsl-error"
        data-error-kind={invalid ? result.kind : "none"}
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem]"
      >
        {invalid && settled && (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-[0.8571rem] text-danger-fg">
              <strong>{KIND_LABEL[result.kind ?? "syntax"] ?? "Query error"}:</strong>{" "}
              {result.message}
              {result.position !== undefined && (
                <>
                  {" "}
                  <span data-testid="dsl-error-token">
                    Offending token: “{tokenAt(value, result.position)}” at
                    character {result.position + 1}.
                  </span>
                </>
              )}
            </p>

            {result.position !== undefined && (
              <pre
                data-testid="dsl-error-caret"
                aria-hidden="true"
                className="m-0 overflow-x-auto whitespace-pre text-[0.8571rem] leading-none text-danger-fg"
              >
                {caretLine(value, result.position)}
              </pre>
            )}

            {result.suggestions !== undefined && result.suggestions.length > 0 && (
              <p data-testid="dsl-error-suggestions" className="m-0 text-[0.8571rem] text-text-secondary">
                Did you mean {result.suggestions.map(s => `“${s}”`).join(" or ")}?
              </p>
            )}
          </div>
        )}
      </div>

      {/*
        VUE-29: the run action, with its keyboard trigger named in the
        control itself so the shortcut is discoverable rather than
        folded knowledge.
      */}
      {onRun !== undefined && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            testId="dsl-run"
            onClick={() => { onRun(); }}
          >
            Run
          </Button>
          <span className="text-[0.7857rem] text-text-tertiary">
            or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd>
          </span>
        </div>
      )}

      {/*
        VUE-29: Esc warns before discarding unsaved work rather than
        closing straight through.
      */}
      {confirmingClose && (
        <div
          data-testid="dsl-close-confirm"
          role="alertdialog"
          aria-label="Discard unsaved query?"
          className="flex items-center gap-2 rounded border border-border-default bg-bg-surface-raised p-2 text-[0.8571rem]"
        >
          <span className="text-text-primary">
            You have unsaved changes to this query. Close anyway?
          </span>
          <Button
            variant="secondary"
            size="sm"
            testId="dsl-close-discard"
            onClick={() => { setConfirmingClose(false); onClose?.(); }}
          >
            Discard
          </Button>
          <Button
            variant="secondary"
            size="sm"
            testId="dsl-close-keep"
            onClick={() => { setConfirmingClose(false); }}
          >
            Keep editing
          </Button>
        </div>
      )}

      {/*
        VUE-11. Disabled with the reason *stated*, not merely greyed —
        and the query is untouched either way.
      */}
      {onSwitchToBasic !== undefined && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            testId="switch-to-basic"
            disabled={!basic.expressible}
            {...(basic.expressible ? {} : { title: basic.reason })}
            onClick={() => {
              if (basic.expressible) onSwitchToBasic(basic.search as Record<string, unknown>);
            }}
          >
            Switch to basic
          </Button>
          {!basic.expressible && (
            <span data-testid="switch-to-basic-reason" className="text-[0.8571rem] text-text-tertiary">
              Basic mode cannot show this query: {basic.reason}.
            </span>
          )}
        </div>
      )}

      {helpOpen && (
        <div
          role="dialog"
          aria-label="Query syntax help"
          data-testid="dsl-help-popover"
          // VUE-9: Esc dismisses. It closes the popover only — the
          // query in progress is untouched, which is the bullet a
          // modal-style "cancel" would break.
          onKeyDown={e => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setHelpOpen(false);
              helpButtonRef.current?.focus();
            }
          }}
          tabIndex={-1}
          ref={el => { el?.focus(); }}
          className="max-h-80 overflow-y-auto rounded-md border border-border-default bg-bg-surface-raised p-3"
        >
          {QUERY_SYNTAX_HELP.map(section => (
            <section key={section.title} className="mb-3 last:mb-0">
              <h3 className="mb-1 text-[0.8571rem] font-semibold text-text-primary">
                {section.title}
              </h3>
              <ul className="m-0 list-none p-0">
                {section.entries.map(e => (
                  <li key={e.syntax} className="flex flex-col gap-0.5 border-b border-border-subtle py-1 last:border-0">
                    <code className="text-[0.8571rem] text-text-primary">{e.syntax}</code>
                    <span className="text-[0.8571rem] text-text-secondary">{e.meaning}</span>
                    <code className="text-[0.7857rem] text-text-tertiary">{e.example}</code>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
