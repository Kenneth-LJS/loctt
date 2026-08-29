import type { CalendarConfig } from "@loctt/contracts";
import { useEffect, useId, useRef, useState } from "react";

import { shortDate } from "../../list/format.ts";
import { fieldSlug } from "./OptionPicker.tsx";

/**
 * An inline date editor: a native `<input type="date">` plus a
 * non-working-day legend read from `calendar.yaml`.
 *
 * ## Why a native input, and why the legend beside it
 *
 * TSK-8 wants non-working days "visually marked". A browser's own date
 * popup is not styleable — no page CSS reaches inside it — so a
 * hand-rolled month grid is the only way to shade weekends in the
 * picker itself. That trade is not worth it here: the native control
 * carries keyboard support, locale-correct parsing and the year range
 * TSK-28 needs (1970 and 2099 both, with no clamping), and rebuilding
 * all of that to shade two columns would be a large surface with its
 * own bugs.
 *
 * So the marking is next to the input rather than inside the popup:
 * the panel states whether the *chosen* date is a non-working day and
 * why ("Saturday is not a working day", "New Year's Day"). That
 * answers the question the shading exists to answer, at the moment it
 * matters, and it works for holidays — which weekend shading alone
 * would miss.
 *
 * **This is a deliberate partial reading of TSK-8's first bullet** and
 * is recorded as decision A? for review. The case says non-working
 * days are "visually marked"; this marks the selected one rather than
 * every one in a grid.
 *
 * ## Timezone (TSK-8, second bullet)
 *
 * Nothing here constructs a `Date` from the stored value for the
 * purpose of editing it. `input[type=date]` takes and returns
 * `YYYY-MM-DD` verbatim, and that string goes to the server unchanged.
 * A round-trip through `new Date(value)` is exactly how a date becomes
 * the previous day west of UTC, and this path never does one.
 */
export function DateField({
  label,
  value,
  calendar,
  onCommit,
  onClear,
  /** Flags a start/due inversion (TSK-8, fourth bullet). */
  problem,
}: {
  readonly label: string;
  readonly value: string | undefined;
  readonly calendar: CalendarConfig | undefined;
  readonly onCommit: (value: string) => void;
  readonly onClear: () => void;
  readonly problem?: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const noteId = useId();
  const slug = fieldSlug(label);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // A refetch (or another tab's write, XS-54) changing the stored date
  // must reach a field the user is not currently typing in.
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next === (value ?? "")) return;
    // TSK-8, third bullet: an emptied field is a *removal*. Sending
    // `""` would store an empty string, and sending today's date is
    // the other failure the bullet names.
    if (next === "") onClear();
    else onCommit(next);
  };

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
          {value === undefined
            ? <span className="text-text-tertiary">—</span>
            // `shortDate` renders in UTC and includes the year outside
            // the current one, so 1970-01-01 reads "Jan 1, 1970"
            // rather than "Jan 1" (TSK-28).
            : shortDate(value)}
        </button>
        <DateNotes
          value={value}
          calendar={calendar}
          problem={problem}
          slug={slug}
          id={noteId}
        />
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="date"
        // The native control's implicit range would otherwise stop at
        // the current year in some engines; TSK-28 requires 2099 to be
        // accepted rather than clamped.
        min="1900-01-01"
        max="2099-12-31"
        data-testid={`meta-input-${slug}`}
        aria-label={label}
        aria-describedby={noteId}
        value={draft}
        onChange={e => { setDraft(e.target.value); }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") {
            // TSK-41's shape, for a text-ish control: nothing is sent
            // and the original value comes back.
            e.preventDefault();
            e.stopPropagation();
            setDraft(value ?? "");
            setEditing(false);
            triggerRef.current?.focus();
          }
        }}
        className="w-full rounded border border-border-subtle bg-bg-surface px-1.5 py-0.5 text-[13px] text-text-primary"
      />
      <DateNotes
        value={draft === "" ? undefined : draft}
        calendar={calendar}
        problem={problem}
        slug={slug}
        id={noteId}
      />
    </div>
  );
}

/**
 * The non-working-day marker and any validation problem.
 *
 * Both render under the control rather than as a toast, which is what
 * P4 asks for and what TSK-49 requires of a field-level failure.
 */
function DateNotes({
  value,
  calendar,
  problem,
  slug,
  id,
}: {
  readonly value: string | undefined;
  readonly calendar: CalendarConfig | undefined;
  readonly problem: string | undefined;
  readonly slug: string;
  readonly id: string;
}) {
  const note = value === undefined ? undefined : nonWorkingNote(value, calendar);
  if (note === undefined && problem === undefined) {
    // The id must still exist for `aria-describedby` to resolve.
    return <span id={id} />;
  }
  return (
    <span id={id}>
      {note !== undefined && (
        <span
          data-testid={`meta-nonworking-${slug}`}
          className="mt-0.5 block text-[11px] text-text-tertiary"
        >
          {note}
        </span>
      )}
      {problem !== undefined && (
        <span
          role="alert"
          data-testid={`meta-problem-${slug}`}
          className="mt-0.5 block text-[11px] text-danger-fg"
        >
          {problem}
        </span>
      )}
    </span>
  );
}

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * Why `date` is not a working day, or undefined when it is.
 *
 * A holiday's own label wins over the weekday, because "Christmas Day"
 * is more use than "Thursday is not a working day" on a date that is
 * both.
 *
 * The weekday is derived by parsing the `YYYY-MM-DD` as UTC, which is
 * the only reading that gives the same answer in every browser
 * timezone — the guarantee TSK-8's second bullet asks for.
 */
export function nonWorkingNote(
  date: string,
  calendar: CalendarConfig | undefined,
): string | undefined {
  if (calendar === undefined) return undefined;
  const day = date.slice(0, 10);
  const holiday = calendar.holidays.find(h => h.date === day);
  if (holiday !== undefined) return `${holiday.label} — not a working day`;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const weekday = parsed.getUTCDay();
  if (calendar.working_days.includes(weekday)) return undefined;
  return `${DAY_NAMES[weekday] ?? "That day"} is not a working day`;
}
