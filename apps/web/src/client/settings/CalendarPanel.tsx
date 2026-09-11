import type { CalendarConfig, HolidayDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useSaveCalendar } from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { Select } from "../ui/Select.tsx";
import { TextField } from "../ui/TextField.tsx";
import {
  blankHoliday,
  duplicateHolidayIndices,
  invalidHolidayIndices,
  supportedTimezones,
  timezoneResolves,
} from "./workflowEdits.ts";

/**
 * Settings → Tracker → Calendar (SET-10, SET-22, SET-23, SET-24,
 * SET-25, SET-36, SET-41, XS-31).
 *
 * The panel edits `.loctt/config/calendar.yaml` through the
 * `PUT /api/calendar` route that already existed. Four of its cases are
 * about a config the schema will not accept, so the panel's job is to
 * say *which row* and *why* before the request goes out:
 *
 *  - SET-36: one unparseable date marks that row and blocks the save;
 *    the other rows are not discarded, and the message names the value.
 *  - SET-23: duplicate dates are shown as duplicates, not deduplicated.
 *  - SET-24: an unresolvable timezone is shown as stored, marked, and
 *    kept out of the picker's options.
 *  - SET-22: an empty working week is refused by
 *    `CalendarConfigSchema` — see the note on the working-days row.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function CalendarPanel() {
  const calendar = useCalendar();

  if (calendar.isError) {
    return (
      <div className="p-8">
        <h1 className="mb-2 text-lg font-semibold text-text-primary">Calendar</h1>
        <ErrorState
          error={calendar.error}
          onRetry={() => { void calendar.refetch(); }}
          context="reading .loctt/config/calendar.yaml"
        />
      </div>
    );
  }
  if (calendar.isLoading || calendar.data === undefined) {
    return <LoadingState>Loading calendar…</LoadingState>;
  }
  return <CalendarEditor stored={calendar.data} />;
}

function CalendarEditor({ stored }: { readonly stored: CalendarConfig }) {
  const save = useSaveCalendar();
  const [draft, setDraft] = useState<CalendarConfig>(stored);
  /**
   * Adopt a *new* server document without discarding the save result.
   *
   * This was a `key={JSON.stringify(stored)}` remount, which was wrong
   * in a way that only showed under test: a successful save invalidates
   * the calendar query, the refetched document differs from the one the
   * editor mounted with, and the remount destroyed `save.isSuccess`
   * along with the "Saved." confirmation the user had not read yet.
   * Comparing the *stored* documents instead means the draft is only
   * reset when the file genuinely changed underneath (XS-31), and a
   * save that produced the document we already hold leaves the
   * confirmation standing.
   */
  const [seen, setSeen] = useState(stored);
  if (seen !== stored && JSON.stringify(seen) !== JSON.stringify(stored)) {
    setSeen(stored);
    setDraft(stored);
  } else if (seen !== stored) {
    setSeen(stored);
  }

  const invalid = invalidHolidayIndices(draft.holidays);
  const duplicates = duplicateHolidayIndices(draft.holidays);
  const tzOk = timezoneResolves(draft.timezone);
  const zones = supportedTimezones();
  // SET-24: the current value is not offered as a choice when it does
  // not resolve. When it does, it is included even if this runtime's
  // list omits it (an alias that resolves but is not enumerated).
  const options = tzOk && !zones.includes(draft.timezone)
    ? [draft.timezone, ...zones]
    : zones;

  // SET-22: `CalendarConfigSchema` rejects an empty `working_days`
  // outright, so the panel cannot "accept it with a warning" as the
  // case's first bullet asks — it warns *before* the save and blocks,
  // which is the honest version of the same intent. Recorded as A67.
  const noWorkingDays = draft.working_days.length === 0;
  const blocked = invalid.length > 0 || noWorkingDays || !tzOk || save.isPending;

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;
  // SET-41: a payload rejected for size names the limit and what
  // exceeded it, rather than surfacing a bare 413.
  const tooLarge = save.error instanceof ApiError && save.error.status === 413;

  const setHoliday = (i: number, next: HolidayDef): void => {
    setDraft(prev => ({
      ...prev,
      holidays: prev.holidays.map((h, j) => (j === i ? next : h)),
    }));
  };

  return (
    <div className="p-8" data-testid="calendar-panel">
      <h1 className="mb-1 text-lg font-semibold text-text-primary">Calendar</h1>
      <p className="mb-4 text-[13px] text-text-secondary">
        Working days, holidays and the workspace timezone. Date pickers
        and the timeline read this.
      </p>

      <div className="grid max-w-2xl gap-4 text-[13px]">
        <label className="grid gap-1">
          <span className="text-text-secondary">Timezone</span>
          <Select
            data-testid="calendar-timezone"
            value={tzOk ? draft.timezone : ""}
            onChange={e => { setDraft(prev => ({ ...prev, timezone: e.target.value })); }}
            className="w-64"
          >
            {!tzOk && <option value="">Pick a valid timezone…</option>}
            {options.map(z => <option key={z} value={z}>{z}</option>)}
          </Select>
          {!tzOk && (
            <div
              role="alert"
              data-testid="calendar-timezone-unresolvable"
              className="text-[11px] text-danger-fg"
            >
              <p>
                <code className="font-mono">{draft.timezone}</code> is the
                value stored in .loctt/config/calendar.yaml, and this
                browser cannot resolve it — it may have been renamed or
                removed from the IANA database.
              </p>
              <p data-testid="calendar-timezone-fallback">
                Dates are being rendered in UTC until a valid zone is
                picked. It is not offered in the list above.
              </p>
            </div>
          )}
        </label>

        <fieldset className="border-0 p-0">
          <legend className="mb-1 text-text-secondary">First day of week</legend>
          <Select
            data-testid="calendar-first-day"
            value={String(draft.first_day_of_week)}
            onChange={e => {
              setDraft(prev => ({ ...prev, first_day_of_week: Number(e.target.value) }));
            }}
            aria-label="First day of week"
            className="w-40"
          >
            {DAY_NAMES.map((n, i) => <option key={n} value={String(i)}>{n}</option>)}
          </Select>
        </fieldset>

        <fieldset className="border-0 p-0" data-testid="calendar-working-days">
          <legend className="mb-1 text-text-secondary">Working days</legend>
          <div className="flex flex-wrap gap-3">
            {DAY_NAMES.map((n, i) => (
              <label key={n} className="flex items-center gap-1 text-[12px]">
                <Checkbox
                  data-testid={`calendar-working-day-${String(i)}`}
                  checked={draft.working_days.includes(i)}
                  onChange={e => {
                    setDraft(prev => ({
                      ...prev,
                      working_days: e.target.checked
                        ? [...prev.working_days, i].sort((a, b) => a - b)
                        : prev.working_days.filter(d => d !== i),
                    }));
                  }}
                />
                {n.slice(0, 3)}
              </label>
            ))}
          </div>
          {noWorkingDays && (
            <p
              role="alert"
              data-testid="calendar-no-working-days"
              className="mt-1 text-[11px] text-danger-fg"
            >
              No working days are left. Working-day computations —
              &quot;due this week&quot;, &quot;N working days from
              today&quot; — cannot resolve against an empty week, and
              calendar.yaml will not accept one. Pick at least one day.
            </p>
          )}
        </fieldset>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-text-secondary">Holidays</span>
            <span data-testid="calendar-holiday-count" className="text-[12px] text-text-tertiary">
              {String(draft.holidays.length)} entr
              {draft.holidays.length === 1 ? "y" : "ies"}
            </span>
          </div>
          {/* SET-23: 500 rows scroll inside their own box rather than
              rendering into a single unscrollable block. */}
          <div
            data-testid="calendar-holidays"
            className="max-h-72 overflow-y-auto rounded-md border border-border-subtle"
          >
            <table className="w-full border-collapse text-left text-[12px]">
              <tbody>
                {draft.holidays.map((h, i) => {
                  const isInvalid = invalid.includes(i);
                  const isDuplicate = duplicates.includes(i);
                  return (
                    <tr
                      key={`${h.date}-${String(i)}`}
                      data-testid={`calendar-holiday-${String(i)}`}
                      data-holiday-invalid={isInvalid ? "true" : undefined}
                      data-holiday-duplicate={isDuplicate ? "true" : undefined}
                    >
                      <td className="p-1">
                        <TextField
                          size="sm"
                          data-testid={`calendar-holiday-date-${String(i)}`}
                          value={h.date}
                          invalid={isInvalid}
                          aria-label={`Holiday date, row ${String(i + 1)}`}
                          onChange={e => { setHoliday(i, { ...h, date: e.target.value }); }}
                          className="w-32 font-mono"
                        />
                      </td>
                      <td className="p-1">
                        <TextField
                          size="sm"
                          data-testid={`calendar-holiday-label-${String(i)}`}
                          value={h.label}
                          aria-label={`Holiday label, row ${String(i + 1)}`}
                          onChange={e => { setHoliday(i, { ...h, label: e.target.value }); }}
                          className="w-48"
                        />
                      </td>
                      <td className="p-1">
                        {isInvalid && (
                          <span
                            role="alert"
                            data-testid={`calendar-holiday-problem-${String(i)}`}
                            className="text-[11px] text-danger-fg"
                          >
                            &quot;{h.date}&quot; is not a date. Expected
                            YYYY-MM-DD.
                          </span>
                        )}
                        {!isInvalid && isDuplicate && (
                          <span
                            data-testid={`calendar-holiday-duplicate-${String(i)}`}
                            className="text-[11px] text-warn-fg"
                          >
                            {h.date} appears more than once.
                          </span>
                        )}
                      </td>
                      <td className="p-1 text-right">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          testId={`calendar-holiday-remove-${String(i)}`}
                          onClick={() => {
                            setDraft(prev => ({
                              ...prev,
                              holidays: prev.holidays.filter((_, j) => j !== i),
                            }));
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            testId="calendar-holiday-add"
            className="mt-2"
            onClick={() => {
              setDraft(prev => ({ ...prev, holidays: [...prev.holidays, blankHoliday()] }));
            }}
          >
            Add holiday
          </Button>
        </div>

        {/* SET-25: the panel states which fields move with the zone. */}
        <p data-testid="calendar-timezone-note" className="text-[12px] text-text-tertiary">
          Changing the timezone rewrites nothing already stored. Task{" "}
          <code className="font-mono">due_date</code> and{" "}
          <code className="font-mono">start_date</code> are date-only and
          are unaffected; only datetimes such as{" "}
          <code className="font-mono">created_at</code> and{" "}
          <code className="font-mono">updated_at</code> change how they
          are displayed. Reverting the zone restores the previous display
          exactly.
        </p>

        {invalid.length > 0 && (
          <p role="alert" data-testid="calendar-blocked" className="text-[12px] text-danger-fg">
            {invalid.length === 1 ? "One holiday row is" : `${String(invalid.length)} holiday rows are`}{" "}
            not a valid date. Fix or remove{" "}
            {invalid.length === 1 ? "it" : "them"} — the other{" "}
            {String(draft.holidays.length - invalid.length)} entries are
            kept and nothing is saved until then.
          </p>
        )}

        {save.isError && (
          <p role="alert" data-testid="calendar-save-error" className="text-[12px] text-danger-fg">
            {tooLarge
              ? `The calendar was too large to send: ${String(draft.holidays.length)} holidays exceeded the request size limit. The configuration already on disk is still in effect — trim the list and save again.`
              : `Not saved to .loctt/config/calendar.yaml: ${saveError ?? "unknown error"}`}
          </p>
        )}
        {save.isSuccess && !save.isPending && (
          <p data-testid="calendar-saved" className="text-[12px] text-text-tertiary">Saved.</p>
        )}

        <div>
          <Button
            type="button"
            variant="primary"
            testId="calendar-save"
            disabled={blocked}
            onClick={() => {
              if (blocked) return;
              save.mutate(draft);
            }}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
