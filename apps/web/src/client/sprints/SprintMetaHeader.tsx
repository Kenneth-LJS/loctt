import type { SprintDef } from "@loctt/contracts";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import type { SprintMetaPatch } from "../api/hooks/useSprintDetail.ts";
import { useUpdateSprintMeta } from "../api/hooks/useSprintDetail.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { SelectCombobox } from "../ui/Combobox.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The sprint metadata header (M4.7 · SPR-7, SPR-8, SPR-25, SPR-26,
 * SPR-28, SPR-33, SPR-37).
 *
 * ## Read-by-default, then Edit (SPR-8)
 *
 * The header is **read-only until an explicit Edit control opens it**.
 * The earlier version committed each field on blur (and `state` on
 * change) in place — SPR-8 supersedes that framing: "inline is for
 * tasks", and sprint config is not a task field, so it is gated behind
 * Edit like the other config surfaces. The persistence guarantees are
 * unchanged; only the trigger moved.
 *
 * Editing collects every field into a single draft and commits them
 * together on Save in **one combined PUT** of all changed fields (A147
 * option 2), rather than one write per blur or one PUT per field. Cancel
 * discards the draft and returns to the read view with nothing written.
 *
 * ## Why one combined PUT, not one per field (A147)
 *
 * Core's `editSprint` validates the window rule (`end < start`) against
 * the *merged* record. A per-field sequence would send `{start_date}`
 * first, merge it against the old `end_date`, and 400 a forward window
 * move (new start after old end) that is valid as a whole. The server's
 * `handleUpdateSprint` already merges every field in the body, so a
 * single `{name?,start_date?,end_date?,state?,goal?}` request validates
 * against the final record. SPR-28's concurrent-goal guarantee still
 * holds: only the fields the user changed are in the request, so a CLI
 * edit to a field the user did not touch is not overwritten.
 *
 * ## Why nothing here is optimistic
 *
 * SPR-37 requires that a save which fails does not leave the attempted
 * value on screen looking saved, and SPR-33 requires the previous valid
 * value to remain on disk. On a rejected save the header stays open in
 * edit mode with the error anchored (SET-51) and the draft intact so the
 * user can correct it without reloading (SPR-33); the value on disk is
 * whatever the server last accepted, never the rejected draft.
 */

/**
 * The three states a sprint may be in — SPR-7 requires exactly these
 * and no invented fourth.
 */
const STATES = ["active", "completed", "future"] as const;
type SprintState = (typeof STATES)[number];

const STATE_LABELS: Record<SprintState, string> = {
  active: "Active",
  completed: "Completed",
  future: "Future",
};

interface Props {
  readonly sprint: SprintDef;
  /**
   * Fold the read-mode name/dates/state presentation OUT of this header,
   * because the host (SprintDetail's PageHeader) is showing them as the
   * page title + subtitle (Ken 2026-09-20 "fold the meta into
   * PageHeader"). When set, the read view drops the Name/Start/End/State
   * fields but keeps the Goal block, the Archived badge and the Edit
   * control — so opening the editor still edits every field. Edit mode is
   * untouched by this flag: the full five-field editor and its single
   * combined PUT are exactly as before, so none of the persistence
   * guarantees (SPR-28/33/37, A147) move. Defaults to false, which is the
   * standalone presentation every existing test renders.
   */
  readonly foldReadMeta?: boolean;
}

/** Which field a save is in flight for, or failed on. */
type FieldKey = "name" | "start_date" | "end_date" | "state" | "goal";

/**
 * Which field a rejected save should anchor its problem to.
 *
 * The server (`handleUpdateSprint`) labels every `SprintError` as
 * `field: "end_date"`, so its `field` alone cannot be trusted — a
 * rejection of ANY field arrives falsely labelled `end_date`. We correct
 * that from the message, which core writes distinctly:
 *  - `state transition '…' -> '…' is not allowed …` → `state`
 *  - `state must be one of …` → `state`
 *  - `end_date (…) must not be before start_date (…)` → `end_date`
 *    (the window rule — the one error that genuinely belongs to end_date)
 *  - `start_date must be YYYY-MM-DD, got: …` → `start_date`
 *  - `end_date must be YYYY-MM-DD, got: …` → `end_date`
 * The server's own `field` is deliberately NOT trusted as a fallback
 * (it is always `end_date`); anything the message does not identify
 * returns `null` and shows only in the generic Callout, never stapled
 * under End date. `field` is accepted only when it is one core does not
 * over-label — in practice the message always wins first.
 */
export function attributeSprintError(message: string): FieldKey | null {
  // The window rule names both dates; check it before the bare
  // "start_date must be…" match so it is not mis-read as a start_date fault.
  if (/must not be before start_date/i.test(message)) return "end_date";
  if (/state transition/i.test(message) || /^state must be/i.test(message)) return "state";
  if (/^start_date must be/i.test(message)) return "start_date";
  if (/^end_date must be/i.test(message)) return "end_date";
  if (/^name /i.test(message)) return "name";
  // Do NOT fall back to the server's `field` (always "end_date"): an
  // unrecognised message is shown generically, not anchored anywhere.
  return null;
}

/** The persisted string value of a field, "" when absent. */
function serverValue(sprint: SprintDef, field: FieldKey): string {
  if (field === "goal") return sprint.goal ?? "";
  const v = sprint[field];
  // SPR-7: an absent field must never render the string "undefined".
  return typeof v === "string" ? v : "";
}

export function SprintMetaHeader({ sprint, foldReadMeta = false }: Props) {
  const update = useUpdateSprintMeta();

  // `editing` is the SPR-8 gate: null when reading, a full draft of the
  // five fields when the Edit control has been opened.
  const [editing, setEditing] = useState<Record<FieldKey, string> | null>(null);
  // The server values captured when the editor opened. Save diffs the
  // draft against THIS snapshot, not the live `sprint` prop — otherwise a
  // concurrent CLI edit that refreshes the same sprint (same id, so the
  // reset effect below does not fire) would make an *untouched* field's
  // draft differ from the refreshed prop and get sent, clobbering the
  // external change (the SPR-28 concurrent-goal case).
  const [baseline, setBaseline] = useState<Record<FieldKey, string> | null>(null);
  // `field` is null when the error has no per-field anchor (e.g. a state
  // transition, or an unattributed failure) — it shows only in the
  // generic Callout, never stapled to End date.
  const [failed, setFailed] = useState<{ field: FieldKey | null; message: string; saved: boolean } | null>(null);

  // a11y: after Save/Cancel the focused Button unmounts (edit → read),
  // so focus is lost to <body>. Return it to the Edit control that the
  // read view re-renders, so keyboard users are not dropped to the top.
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wantFocusEdit = useRef(false);
  useEffect(() => {
    if (editing === null && wantFocusEdit.current) {
      wantFocusEdit.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  // If the sprint changes underneath an open editor (a CLI edit, a
  // navigation), drop the draft rather than keep stale values that would
  // clobber the newer server state on Save. SPR-28's concurrent-goal
  // case is still safe: Save sends only the fields the user changed.
  useEffect(() => {
    setEditing(null);
    setBaseline(null);
    setFailed(null);
  }, [sprint.id]);

  const openEditor = (): void => {
    setFailed(null);
    const snapshot: Record<FieldKey, string> = {
      name: serverValue(sprint, "name"),
      start_date: serverValue(sprint, "start_date"),
      end_date: serverValue(sprint, "end_date"),
      state: serverValue(sprint, "state"),
      goal: serverValue(sprint, "goal"),
    };
    setBaseline(snapshot);
    setEditing({ ...snapshot });
  };

  const cancel = (): void => {
    wantFocusEdit.current = true;
    setEditing(null);
    setBaseline(null);
    setFailed(null);
  };

  const setField = (field: FieldKey, value: string): void => {
    setEditing(prev => (prev === null ? prev : { ...prev, [field]: value }));
  };

  /**
   * A single combined patch of the fields whose draft differs from disk
   * (A147 option 2), or `null` when nothing changed. `state` and `goal`
   * need special encoding; the date/name fields are plain strings.
   */
  const buildPatch = (
    draft: Record<FieldKey, string>,
    base: Record<FieldKey, string>,
  ): SprintMetaPatch | null => {
    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const field of ["name", "start_date", "end_date", "state", "goal"] as const) {
      const raw = draft[field];
      // Diff against the snapshot from when the editor opened, NOT the live
      // prop: a field the user never touched must never be sent, even if the
      // prop refreshed underneath from a concurrent edit.
      if (raw === base[field]) continue;
      changed = true;
      if (field === "goal") {
        // An emptied goal is *removed*, not stored as "". A blank string
        // would render as a goal that exists and says nothing.
        patch.goal = raw === "" ? null : raw;
      } else if (field === "state") {
        patch.state = raw as SprintState;
      } else {
        patch[field] = raw;
      }
    }
    return changed ? (patch as SprintMetaPatch) : null;
  };

  const save = (): void => {
    if (editing === null || baseline === null) return;
    const patch = buildPatch(editing, baseline);
    if (patch === null) {
      // Nothing changed — Save is a no-op close, no write.
      wantFocusEdit.current = true;
      setEditing(null);
      setBaseline(null);
      return;
    }

    setFailed(null);

    // One combined PUT of every changed field (A147). The server merges
    // them and validates the window rule against the final record, so a
    // forward window move is not rejected by a stale-partial merge. On
    // rejection the editor stays open with the draft intact, so the
    // previous valid value stays on disk (SPR-33) and the attempted
    // value is not shown as saved (SPR-37).
    update.mutate(
      { id: sprint.id, patch },
      {
        onSuccess: () => {
          wantFocusEdit.current = true;
          setEditing(null);
          setBaseline(null);
        },
        onError: err => {
          // ERR-18 / SPR-37: the envelope says whether the write landed.
          // Never guess — "not saved" over a write that actually landed
          // is the worse of the two errors.
          const envelope = err instanceof ApiError ? err.envelope : undefined;
          const saved = envelope?.data_state === "saved";
          // Attribute the failure to a field so the problem renders next
          // to the control it is about.
          //
          // The server's `handleUpdateSprint` stamps EVERY `SprintError`
          // with `field: "end_date"` (its most common cause is the
          // window rule), so a state-transition rejection arrives falsely
          // labelled `end_date`. Anchoring it there would be a lie, so we
          // read the message: a `state transition … not allowed` error is
          // attributed to `state`; the window rule keeps `end_date`;
          // anything else (or no field) falls back to the generic Callout
          // rather than borrowing the End-date anchor.
          const field = attributeSprintError(err.message);
          setFailed({ field, message: err.message, saved });
          // Leave `editing` in place so the draft (SPR-33) survives.
        },
      },
    );
  };

  const errorFor = (field: FieldKey): string | null =>
    failed !== null && failed.field === field ? failed.message : null;

  // ── Read view (SPR-8: read-by-default) ──────────────────────────────
  if (editing === null) {
    return (
      <header
        data-testid="sprint-meta"
        data-sprint-meta-mode="read"
        className="flex flex-col gap-3 border-b border-border-subtle pb-3"
      >
        <div className="flex flex-wrap items-start gap-4">
          {/* Folded out when the host PageHeader shows name/dates/state as
              the title + subtitle (Ken 2026-09-20). The editor still edits
              all of them — only this read presentation moves. */}
          {!foldReadMeta && (
            <>
              <ReadField label="Name" value={serverValue(sprint, "name")} testId="sprint-meta-name-value" />
              <ReadField label="Start" value={serverValue(sprint, "start_date")} testId="sprint-meta-start_date-value" />
              <ReadField label="End" value={serverValue(sprint, "end_date")} testId="sprint-meta-end_date-value" />
              <div className="flex flex-col gap-1">
                <span className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">State</span>
                <span data-testid="sprint-meta-state-value" className="text-[0.9286rem] text-text-primary">
                  {STATE_LABELS[serverValue(sprint, "state") as SprintState] ?? serverValue(sprint, "state")}
                </span>
              </div>
            </>
          )}

          {/* SPR-26: an archived sprint's detail page says so. Kept here in
              both modes so this header remains SPR-26's carrier. */}
          {sprint.archived === true && (
            <span
              data-testid="sprint-meta-archived"
              className="rounded-full bg-bg-muted px-2 py-0.5 text-[0.7857rem] font-medium text-text-secondary"
            >
              Archived
            </span>
          )}

          <div className="ml-auto">
            <Button ref={editButtonRef} variant="secondary" size="sm" testId="sprint-meta-edit" onClick={openEditor}>
              Edit
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">Goal</span>
          {/* SPR-7: an absent goal reads as an explicit "no goal", never
              the string "undefined". */}
          {serverValue(sprint, "goal") === "" ? (
            <span data-testid="sprint-meta-goal-value" className="text-[0.9286rem] italic text-text-tertiary">
              No goal set.
            </span>
          ) : (
            <p
              data-testid="sprint-meta-goal-value"
              className="max-h-32 overflow-auto whitespace-pre-wrap text-[0.9286rem] text-text-primary"
            >
              {serverValue(sprint, "goal")}
            </p>
          )}
        </div>
      </header>
    );
  }

  // ── Edit view (SPR-8: behind the Edit control) ──────────────────────
  return (
    <header
      data-testid="sprint-meta"
      data-sprint-meta-mode="edit"
      className="flex flex-col gap-3 border-b border-border-subtle pb-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] max-w-[380px] flex-1">
          <MetaTextField
            field="name"
            label="Name"
            type="text"
            value={editing.name}
            problem={errorFor("name")}
            notSaved={failed?.saved === false && failed.field === "name"}
            onChange={v => setField("name", v)}
          />
        </div>
        <MetaTextField
          field="start_date"
          label="Start"
          type="date"
          value={editing.start_date}
          problem={errorFor("start_date")}
          notSaved={failed?.saved === false && failed.field === "start_date"}
          onChange={v => setField("start_date", v)}
        />
        <MetaTextField
          field="end_date"
          label="End"
          type="date"
          value={editing.end_date}
          problem={errorFor("end_date")}
          notSaved={failed?.saved === false && failed.field === "end_date"}
          onChange={v => setField("end_date", v)}
        />

        <div className="flex flex-col gap-1">
          <span className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">State</span>
          {/* SPR-7: exactly these three. No blank option, no "archived". */}
          <SelectCombobox
            testId="sprint-meta-state"
            size="sm"
            value={editing.state}
            aria-label="State"
            aria-describedby={errorFor("state") !== null ? "sprint-meta-state-problem" : undefined}
            onChange={v => setField("state", v)}
            options={STATES.map(s => ({ value: s, label: STATE_LABELS[s] }))}
          />
          {/* SPR-37: a rejected state transition anchors here, next to the
              control it is about — never under End date. */}
          {errorFor("state") !== null && (
            <span
              id="sprint-meta-state-problem"
              data-testid="sprint-meta-state-problem"
              role="alert"
              className="text-[0.7857rem] text-danger-fg"
            >
              {errorFor("state")}
              {failed?.saved === false && failed.field === "state"
                && " Your change was not saved; the previous value is still in place."}
            </span>
          )}
        </div>

        {sprint.archived === true && (
          <span
            data-testid="sprint-meta-archived"
            className="rounded-full bg-bg-muted px-2 py-0.5 text-[0.7857rem] font-medium text-text-secondary"
          >
            Archived
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">Goal</span>
        {/* SPR-25: a multi-paragraph goal scrolls inside a bounded box. */}
        <TextArea
          data-testid="sprint-meta-goal"
          value={editing.goal}
          rows={2}
          placeholder="No goal set — describe what this sprint is for."
          onChange={e => setField("goal", e.target.value)}
          className="max-h-32 resize-y overflow-auto"
        />
        {errorFor("goal") !== null && (
          <span
            data-testid="sprint-meta-goal-problem"
            role="alert"
            className="text-[0.7857rem] text-danger-fg"
          >
            {errorFor("goal")}
          </span>
        )}
      </label>

      {/* SET-51 / SPR-37: a save failure keeps the editor open with the
          error anchored here. A failure attributed to a field the header
          is not showing would otherwise vanish; this states the data
          outcome explicitly for every failure. */}
      {failed !== null && (
        <Callout tone="danger" role="alert" testId="sprint-meta-error">
          <span>
            {failed.message}{" "}
            {failed.saved
              ? "The change was saved."
              : "The change was not saved; the previous value is still in place."}
          </span>
        </Callout>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" testId="sprint-meta-cancel" onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          testId="sprint-meta-save"
          loading={update.isPending}
          aria-label="Save"
          onClick={save}
        >
          Save
        </Button>
      </div>
    </header>
  );
}

/** A read-mode label/value pair. */
function ReadField({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">{label}</span>
      <span data-testid={testId} className="max-w-[380px] truncate text-[0.9286rem] text-text-primary">
        {value}
      </span>
    </div>
  );
}

/** An edit-mode text/date field wired to a draft value. */
function MetaTextField({
  field,
  label,
  type,
  value,
  problem,
  notSaved,
  onChange,
}: {
  field: Exclude<FieldKey, "state" | "goal">;
  label: string;
  type: "text" | "date";
  value: string;
  problem: string | null;
  notSaved: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[0.7857rem] uppercase tracking-wide text-text-tertiary">{label}</span>
      <TextField
        data-testid={`sprint-meta-${field}`}
        type={type}
        size="sm"
        value={value}
        invalid={problem !== null}
        aria-describedby={problem !== null ? `sprint-meta-${field}-problem` : undefined}
        onChange={e => onChange(e.target.value)}
        // SPR-25: a 200-character name truncates inside its own box.
        className="min-w-0 truncate"
      />
      {problem !== null && (
        // SPR-33: next to the control, not only in a toast.
        <span
          id={`sprint-meta-${field}-problem`}
          data-testid={`sprint-meta-${field}-problem`}
          role="alert"
          className="text-[0.7857rem] text-danger-fg"
        >
          {problem}
          {notSaved && " Your change was not saved; the previous value is still in place."}
        </span>
      )}
    </label>
  );
}
