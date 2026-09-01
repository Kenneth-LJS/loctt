import type { SprintDef } from "@loctt/contracts";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client.ts";
import type { SprintMetaPatch } from "../api/hooks/useSprintDetail.ts";
import { useUpdateSprintMeta } from "../api/hooks/useSprintDetail.ts";

/**
 * The editable sprint metadata header (M4.7 · SPR-7, SPR-8, SPR-25,
 * SPR-26, SPR-28, SPR-33, SPR-37).
 *
 * Every field commits on blur (and on Enter for the text inputs); the
 * `state` select commits on change, because a select has no
 * meaningful "still editing" state.
 *
 * ## Why nothing here is optimistic
 *
 * SPR-37 requires that a save which fails does not leave the attempted
 * value on screen looking saved, and SPR-33 requires the previous
 * valid value to remain on disk. Both are satisfied by the same rule:
 * the input is a *draft* until the server accepts it, and on rejection
 * the draft is reverted to the server's value rather than kept. The
 * user's text is not lost — the error names it and the field stays
 * focusable, which is SPR-33's "correct it without reloading".
 */

/**
 * The three states a sprint may be in — SPR-7 requires exactly these
 * and no invented fourth. Sourced from the contract's own union rather
 * than retyped, so a schema change cannot leave this list behind.
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
}

/** Which field a save is in flight for, or failed on. */
type FieldKey = "name" | "start_date" | "end_date" | "state" | "goal";

export function SprintMetaHeader({ sprint }: Props) {
  const update = useUpdateSprintMeta();

  // Drafts, keyed by field. Reset from the server's value whenever the
  // sprint changes — which is also how a rejected save reverts, and
  // how SPR-28's CLI-set `goal` appears after an unrelated save.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<{ field: FieldKey; message: string; saved: boolean } | null>(null);

  useEffect(() => {
    setDraft({});
  }, [sprint.id, sprint.name, sprint.start_date, sprint.end_date, sprint.state, sprint.goal]);

  const valueOf = (field: FieldKey): string => {
    const d = draft[field];
    if (d !== undefined) return d;
    if (field === "goal") return sprint.goal ?? "";
    const v = sprint[field];
    // SPR-7: an absent `goal` must never render the string
    // "undefined". Nothing is stringified without this guard — the
    // empty string is what makes the input show its placeholder.
    return typeof v === "string" ? v : "";
  };

  const commit = (field: FieldKey, raw: string): void => {
    const current =
      field === "goal" ? (sprint.goal ?? "") : (typeof sprint[field] === "string" ? sprint[field] : "");
    if (raw === current) {
      // Nothing changed — no write. A blur is not an edit.
      setDraft(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      return;
    }

    const patch: SprintMetaPatch =
      field === "goal"
        // An emptied goal is *removed*, not stored as "". A blank
        // string would render as a goal that exists and says nothing,
        // which is not the same fact as having none.
        ? { goal: raw === "" ? null : raw }
        : field === "state"
          ? { state: raw as SprintState }
          : { [field]: raw };

    setFailed(null);
    update.mutate(
      { id: sprint.id, patch },
      {
        onSuccess: () => {
          setDraft(prev => {
            const next = { ...prev };
            delete next[field];
            return next;
          });
        },
        onError: err => {
          // ERR-18 / SPR-37: the envelope says whether the write
          // landed. Never guess — "not saved" asserted over a write
          // that actually landed is the worse of the two errors.
          const envelope = err instanceof ApiError ? err.envelope : undefined;
          const saved = envelope?.data_state === "saved";
          // The server attributes the failure to a field (`end_date`
          // for the window rule); fall back to the edited one so the
          // message still lands somewhere specific.
          const attributed = (envelope?.field ?? field) as FieldKey;
          setFailed({ field: attributed, message: err.message, saved });
          // SPR-33 / SPR-37: the attempted value must not stand as
          // though it were saved. Reverting the draft puts the last
          // known-good value back under the error.
          if (!saved) {
            setDraft(prev => {
              const next = { ...prev };
              delete next[field];
              return next;
            });
          }
        },
      },
    );
  };

  const errorFor = (field: FieldKey): string | null =>
    failed !== null && failed.field === field ? failed.message : null;

  const textField = (
    field: Exclude<FieldKey, "state" | "goal">,
    label: string,
    type: "text" | "date",
  ) => {
    const problem = errorFor(field);
    return (
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</span>
        <input
          data-testid={`sprint-meta-${field}`}
          type={type}
          value={valueOf(field)}
          aria-invalid={problem !== null}
          aria-describedby={problem !== null ? `sprint-meta-${field}-problem` : undefined}
          onChange={e => setDraft(prev => ({ ...prev, [field]: e.target.value }))}
          onBlur={e => commit(field, e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(prev => {
                const next = { ...prev };
                delete next[field];
                return next;
              });
            }
          }}
          className={[
            // SPR-25: a 200-character name truncates inside its own
            // box rather than pushing the `state` control off-screen.
            "min-w-0 truncate rounded border bg-bg-surface px-2 py-1 text-[13px] text-text-primary",
            problem !== null ? "border-danger-fg" : "border-border-default",
          ].join(" ")}
        />
        {problem !== null && (
          // SPR-33: next to the control, not only in a toast.
          <span
            id={`sprint-meta-${field}-problem`}
            data-testid={`sprint-meta-${field}-problem`}
            role="alert"
            className="text-[11px] text-danger-fg"
          >
            {problem}
            {failed?.saved === false && " Your change was not saved; the previous value is still in place."}
          </span>
        )}
      </label>
    );
  };

  return (
    <header data-testid="sprint-meta" className="flex flex-col gap-3 border-b border-border-subtle pb-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] max-w-[380px] flex-1">
          {textField("name", "Name", "text")}
        </div>
        {textField("start_date", "Start", "date")}
        {textField("end_date", "End", "date")}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary">State</span>
          <select
            data-testid="sprint-meta-state"
            value={valueOf("state")}
            onChange={e => commit("state", e.target.value)}
            className="rounded border border-border-default bg-bg-surface px-2 py-1 text-[13px] text-text-primary"
          >
            {/* SPR-7: exactly these three. No blank option, no
                "archived" — archiving is a separate flag edited in
                Settings, and offering it here would invent a fourth
                state the schema does not have. */}
            {STATES.map(s => (
              <option key={s} value={s}>{STATE_LABELS[s]}</option>
            ))}
          </select>
        </label>

        {/* SPR-26: an archived sprint's detail page is reachable, and
            says so, rather than looking like an ordinary one. */}
        {sprint.archived === true && (
          <span
            data-testid="sprint-meta-archived"
            className="rounded-full bg-bg-muted px-2 py-0.5 text-[11px] font-medium text-text-secondary"
          >
            Archived
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wide text-text-tertiary">Goal</span>
        {/* SPR-7: an absent goal is an empty editable field with a
            placeholder inviting one — not the string "undefined", and
            not a row hidden away so a goal cannot be added.
            SPR-25: a multi-paragraph goal scrolls inside a bounded
            box rather than growing the header without limit. */}
        <textarea
          data-testid="sprint-meta-goal"
          value={valueOf("goal")}
          rows={2}
          placeholder="No goal set — describe what this sprint is for."
          onChange={e => setDraft(prev => ({ ...prev, goal: e.target.value }))}
          onBlur={e => commit("goal", e.target.value)}
          className="max-h-32 w-full resize-y overflow-auto rounded border border-border-default bg-bg-surface px-2 py-1 text-[13px] text-text-primary"
        />
        {errorFor("goal") !== null && (
          <span
            data-testid="sprint-meta-goal-problem"
            role="alert"
            className="text-[11px] text-danger-fg"
          >
            {errorFor("goal")}
          </span>
        )}
      </label>

      {/* SPR-37: a failure attributed to a field the header is not
          showing would otherwise vanish. This is the backstop, and it
          states the data outcome explicitly. */}
      {failed !== null && !isShownField(failed.field) && (
        <p data-testid="sprint-meta-error" role="alert" className="text-[12px] text-danger-fg">
          {failed.message}{" "}
          {failed.saved
            ? "The change was saved."
            : "The change was not saved; the previous value is still in place."}
        </p>
      )}
    </header>
  );
}

function isShownField(field: FieldKey): boolean {
  return field === "name" || field === "start_date" || field === "end_date" || field === "goal";
}
