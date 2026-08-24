import type {
  MilestoneDef,
  ProjectDef,
  SprintDef,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";
import { useState } from "react";

/**
 * The bulk action bar, shown once at least one row is selected.
 *
 * Absent from the DOM at zero selection rather than hidden with
 * opacity (BLK-2): a bar that is present but invisible is still
 * reachable by Tab and still announced, which is worse than not being
 * there.
 *
 * Archive and Delete are deliberately asymmetric (BLK-10, BLK-11).
 * Archive is reversible, so it is one click; Delete is not, so it goes
 * through a typed confirmation the caller renders. Gating archive
 * behind the same friction would be a violation rather than extra
 * safety — it trains people to type through dialogs.
 */
export function BulkBar({
  count,
  scopeLabel,
  workflow,
  users,
  milestones,
  sprints,
  projects,
  busy,
  result,
  onClear,
  onSetField,
  onMove,
  onArchive,
  onDeleteRequested,
}: {
  readonly count: number;
  /**
   * How the selection was made, stated next to the count (BLK-3). The
   * bar must never imply a scope wider than what is selected.
   */
  readonly scopeLabel?: string | undefined;
  readonly workflow?: WorkflowConfig | undefined;
  /**
   * Entity vocabularies for the assignee / milestone / sprint pickers
   * (BLK-7, BLK-8). Archived entries are filtered out here rather than
   * by the caller, so every call site gets the same rule.
   */
  readonly users?: readonly UserProfile[] | undefined;
  readonly milestones?: readonly MilestoneDef[] | undefined;
  readonly sprints?: readonly SprintDef[] | undefined;
  /** Move-to-project options (BLK-9). */
  readonly projects?: readonly ProjectDef[] | undefined;
  /** Disables every action while one is in flight (BLK-31). */
  readonly busy: boolean;
  /** Outcome of the last action, shown until the next one starts. */
  readonly result?:
    | { readonly message: string; readonly failures: readonly string[] }
    | undefined;
  readonly onClear: () => void;
  /**
   * `null` clears the field. The bulk endpoint maps null to core's
   * `undefined`, which is why "Unassign" / "No milestone" need no
   * separate call (BLK-7, BLK-8).
   */
  readonly onSetField: (field: string, value: string | null) => void;
  /** BLK-9: relocates and rekeys every selected task. */
  readonly onMove: (projectId: string) => void;
  readonly onArchive: () => void;
  readonly onDeleteRequested: () => void;
}) {
  if (count === 0) return null;

  // Config order, by label — never a hardcoded To Do / Doing / Done
  // (BLK-5). Absent config means the picker offers nothing rather than
  // inventing options.
  const statuses = workflow?.statuses ?? [];
  const priorities = workflow?.priorities ?? [];

  return (
    <div
      // Sticky so scrolling to row 50 keeps it visible (BLK-2).
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border-subtle bg-bg-surface px-4 py-2.5 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]"
      role="region"
      aria-label="Bulk actions"
      onKeyDown={e => {
        // Esc clears from inside the bar (BLK-13).
        if (e.key === "Escape") onClear();
      }}
    >
      <p aria-live="polite" className="text-[13px] font-medium text-text-primary">
        {/* Singular at one, plural above — the count is of selected
            rows, never the page size or the filter total. */}
        {count} {count === 1 ? "task" : "tasks"} selected
        {scopeLabel !== undefined && (
          <span className="ml-1 font-normal text-text-tertiary">· {scopeLabel}</span>
        )}
      </p>

      <BulkPicker
        label="Set status"
        options={statuses.map(s => ({ id: s.key, label: s.label }))}
        disabled={busy}
        onPick={v => { onSetField("status", v); }}
      />
      <BulkPicker
        label="Set priority"
        options={priorities.map(p => ({ id: p.key, label: p.label }))}
        disabled={busy}
        onPick={v => { onSetField("priority", v); }}
      />
      <BulkPicker
        label="Set assignee"
        options={active(users).map(u => ({ id: u.id, label: u.name }))}
        clearLabel="Unassign"
        disabled={busy}
        onPick={v => { onSetField("assignee", v); }}
      />
      <BulkPicker
        label="Set milestone"
        options={active(milestones).map(m => ({ id: m.id, label: m.name }))}
        clearLabel="No milestone"
        disabled={busy}
        onPick={v => { onSetField("milestone", v); }}
      />
      <BulkPicker
        label="Set sprint"
        options={active(sprints).map(sp => ({
          id: sp.id,
          label: sp.name,
          // BLK-8: state is shown so nobody assigns work to a sprint
          // that already finished without noticing.
          hint: sp.state,
        }))}
        clearLabel="No sprint"
        disabled={busy}
        onPick={v => { onSetField("sprint", v); }}
      />

      <BulkPicker
        label="Move to project"
        options={active(projects).map(pr => ({ id: pr.id, label: pr.name }))}
        disabled={busy}
        onPick={v => { if (v !== null) onMove(v); }}
      />

      <button
        type="button"
        onClick={onArchive}
        disabled={busy}
        className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-text-secondary hover:bg-bg-muted disabled:opacity-50"
      >
        Archive
      </button>

      <button
        type="button"
        onClick={onDeleteRequested}
        disabled={busy}
        className="rounded-md border border-danger-fg/40 px-2.5 py-1 text-[12px] font-medium text-danger-fg hover:bg-danger-fg/10 disabled:opacity-50"
      >
        Delete
      </button>

      {result !== undefined && (
        <span
          role="status"
          className={[
            "text-[12px]",
            result.failures.length > 0 ? "text-danger-fg" : "text-text-tertiary",
          ].join(" ")}
        >
          {result.message}
          {/* Each failure named individually, not summarised as a
              count (BLK-38). */}
          {result.failures.length > 0 && (
            <span className="ml-1 text-text-tertiary">
              ({result.failures.join("; ")})
            </span>
          )}
        </span>
      )}

      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-auto rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-text-secondary hover:bg-bg-muted"
      >
        Clear ×
      </button>
    </div>
  );
}

/**
 * Drops archived entries.
 *
 * BLK-7 and BLK-8 exclude archived users, milestones and sprints from
 * the pickers, and the archived-reference guard would refuse them
 * anyway — offering one produces a rejection the user cannot act on.
 * Existing references are untouched: archiving hides an entity from
 * *new* assignments without breaking the tasks already pointing at it.
 */
function active<T extends { readonly archived?: boolean | undefined }>(
  items: readonly T[] | undefined,
): readonly T[] {
  return (items ?? []).filter(i => i.archived !== true);
}

/**
 * A one-shot value picker. Deliberately not `FilterDropdown`: that one
 * is multi-select, holds a selected set, and labels itself "Filter by
 * X" — all wrong for an action that applies one value and is done.
 */
function BulkPicker({
  label,
  options,
  clearLabel,
  disabled,
  onPick,
}: {
  readonly label: string;
  readonly options: readonly {
    id: string;
    label: string;
    /** Secondary text beside the label, e.g. a sprint's state. */
    hint?: string | undefined;
  }[];
  /**
   * When set, the menu opens with an option that clears the field —
   * "Unassign", "No milestone", "No sprint" (BLK-7, BLK-8). It picks
   * `null`, which the bulk endpoint maps to core's "clear this field".
   *
   * Offered even when there are no options: clearing a field that
   * already holds a now-archived value must stay possible.
   */
  readonly clearLabel?: string | undefined;
  readonly disabled: boolean;
  readonly onPick: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => { setOpen(o => !o); }}
        className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-text-secondary hover:bg-bg-muted disabled:opacity-50"
      >
        {label} ▾
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute bottom-full left-0 z-20 mb-1 min-w-[160px] rounded-md border border-border-subtle bg-bg-surface py-1 shadow-lg"
        >
          {clearLabel !== undefined && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(null);
              }}
              className="block w-full border-b border-border-subtle px-3 py-1.5 text-left text-[12px] italic text-text-secondary hover:bg-bg-muted"
            >
              {clearLabel}
            </button>
          )}
          {options.length === 0 ? (
            clearLabel === undefined && (
              <div className="px-3 py-2 text-[12px] italic text-text-tertiary">
                No options
              </div>
            )
          ) : (
            options.map(opt => (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onPick(opt.id);
                }}
                className="block w-full px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-bg-muted"
              >
                {opt.label}
                {opt.hint !== undefined && (
                  <span className="ml-1.5 text-text-tertiary">· {opt.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
