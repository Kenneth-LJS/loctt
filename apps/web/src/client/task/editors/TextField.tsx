import { useEffect, useId, useRef, useState } from "react";

import { fieldSlug } from "./OptionPicker.tsx";

/**
 * An inline text or number editor, used by the estimate row and by
 * `string` / `number` custom fields.
 *
 * ## Client-side validation, and why it is not the only validation
 *
 * TSK-49 requires a `number` field given text to report at the field,
 * name the field's label and what is acceptable, **not write the
 * invalid value to disk, and keep the user's input so it can be
 * corrected**. That last clause is what forces the check to happen
 * here rather than only on the server: a rejected round-trip would
 * roll the optimistic value back, and rolling back is precisely wiping
 * the input the case says to keep.
 *
 * The server still validates — it is the surface the CLI and MCP share
 * — and this does not replace it. This decides whether the request is
 * worth sending at all, and holds the draft while the user fixes it.
 *
 * ## The type mismatch (TSK-31)
 *
 * A field declared `number` can already hold a string from an earlier
 * `string` declaration. Rendering `<input type="number">` over it
 * shows an empty box, and the next save writes that emptiness over the
 * user's data — the exact failure TSK-31 names. So the control is a
 * plain text input with its own numeric check: `inputMode="numeric"`
 * gets the phone keypad without the browser silently discarding a
 * value it cannot parse. The mismatch itself is surfaced by the
 * caller, which knows the declared type and the stored value.
 */
export function TextField({
  label,
  value,
  numeric,
  suffix,
  placeholder = "—",
  onCommit,
  onClear,
  /** A problem the caller detected, e.g. a stored/declared type clash. */
  problem,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly numeric?: boolean;
  /** Rendered after the value, e.g. an estimation `unit_label`. */
  readonly suffix?: string | undefined;
  readonly placeholder?: string;
  readonly onCommit: (value: string) => void;
  readonly onClear: () => void;
  readonly problem?: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const slug = fieldSlug(label);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) { setDraft(value ?? ""); setLocalError(null); }
  }, [value, editing]);

  const commit = (): void => {
    const next = draft.trim();
    if (next === (value ?? "")) { setEditing(false); setLocalError(null); return; }
    if (next === "") {
      // TSK-42: an emptied optional field is removed, not stored blank.
      setEditing(false);
      setLocalError(null);
      onClear();
      return;
    }
    if (numeric === true && !isNumeric(next)) {
      // Stays in edit mode, keeps the draft, sends nothing (TSK-49).
      setLocalError(`${label} must be a number.`);
      return;
    }
    setEditing(false);
    setLocalError(null);
    onCommit(next);
  };

  const shown = localError ?? problem;

  if (!editing) {
    return (
      <div>
        <button
          ref={triggerRef}
          type="button"
          data-testid={`meta-edit-${slug}`}
          aria-label={`${label}: ${value ?? "not set"}. Change`}
          onClick={() => { setEditing(true); }}
          className="-mx-1 w-full rounded px-1 py-0.5 text-left text-[13px] text-text-primary hover:bg-bg-muted"
        >
          {value === undefined ? (
            <span className="text-text-tertiary">{placeholder}</span>
          ) : (
            <span className="break-words">
              {value}
              {suffix !== undefined && (
                <span className="text-text-tertiary"> {suffix}</span>
              )}
            </span>
          )}
        </button>
        {problem !== undefined && (
          <span
            role="alert"
            data-testid={`meta-problem-${slug}`}
            className="mt-0.5 block text-[11px] text-danger-fg"
          >
            {problem}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        {...(numeric === true ? { inputMode: "decimal" as const } : {})}
        data-testid={`meta-input-${slug}`}
        aria-label={label}
        aria-invalid={shown !== undefined && shown !== null}
        aria-describedby={shown === undefined || shown === null ? undefined : errorId}
        value={draft}
        onChange={e => { setDraft(e.target.value); setLocalError(null); }}
        // No commit-on-blur while a local error stands: blurring would
        // unmount the input and take the draft with it, wiping the
        // value TSK-49 says to keep.
        onBlur={() => { if (localError === null) commit(); }}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(value ?? "");
            setLocalError(null);
            setEditing(false);
            // A11Y-18's second bullet: focus returns to the field's
            // trigger row.
            //
            // Deferred, and that is the whole of it. The trigger only
            // renders while `!editing`, so at this point
            // `triggerRef.current` is still **null** — `setEditing`
            // has not re-rendered yet — and the `?.` swallowed it
            // silently, leaving focus on the unmounting input and
            // therefore on `document.body`. Measured: Escape closed
            // the editor and the next Tab went to the top of the
            // document.
            //
            // A microtask is not enough (React has not re-rendered
            // either); this waits for the paint that mounts the
            // trigger.
            requestAnimationFrame(() => { triggerRef.current?.focus(); });
          }
        }}
        className="w-full rounded border border-border-subtle bg-bg-surface px-1.5 py-0.5 text-[13px] text-text-primary"
      />
      {shown !== undefined && shown !== null && (
        <span
          id={errorId}
          role="alert"
          data-testid={`meta-problem-${slug}`}
          className="mt-0.5 block text-[11px] text-danger-fg"
        >
          {shown}
        </span>
      )}
    </div>
  );
}

/**
 * Whether `text` is a number LocTT would store as one.
 *
 * `Number()` alone is too permissive: it accepts `""`, `"0x10"`,
 * `"Infinity"` and leading/trailing whitespace, none of which is what
 * a user means by a story-point count. The shape check comes first.
 */
export function isNumeric(text: string): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return false;
  return Number.isFinite(Number(text));
}
