import type {
  MilestoneDef,
  ProjectDef,
  SprintDef,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";
import { MAX_BULK_REFS } from "@loctt/contracts";
import { useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";

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
  resultAction,
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
  /**
   * Rendered beside the result message. Archive passes an Undo here
   * (BLK-10); the affordance belongs where the user is already reading
   * the outcome, and it must appear whether or not the action cleared
   * the selection.
   */
  readonly resultAction?: React.ReactNode;
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
  // Over the cap, every action would be refused by the server. Offering
  // them anyway is a click that can only fail.
  const overCap = count > MAX_BULK_REFS;
  /**
   * BLK-6: by `value` when present, alphabetically when not. Config
   * order is the wrong default here — a priority list is ranked, and
   * showing Low above Critical because that is how the file happens to
   * read is a picker the user has to think about.
   */
  const orderedPriorities = [...priorities].sort((a, b) => {
    if (a.value !== undefined && b.value !== undefined) return a.value - b.value;
    if (a.value !== undefined) return -1;
    if (b.value !== undefined) return 1;
    return a.label.localeCompare(b.label);
  });

  return (
    <div
      // Sticky so scrolling to row 50 keeps it visible (BLK-2).
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border-divider bg-bg-surface px-4 py-2.5 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]"
      role="region"
      aria-label="Bulk actions"
      onKeyDown={e => {
        // Esc clears from inside the bar (BLK-13).
        if (e.key === "Escape") onClear();
      }}
    >
      {count > MAX_BULK_REFS && (
        <p role="status" className="w-full text-[0.8571rem] text-danger-fg">
          {/* Stated at selection time, before anything is sent (BLK-47).
              Letting the server's validator be the first mention leaks
              its own jargon to the user (ERR-16) and wastes a round
              trip on a request that cannot succeed. */}
          Bulk actions apply to at most {MAX_BULK_REFS} tasks at once.
          {" "}{count} are selected. Clear some, or act in batches.
        </p>
      )}
      <p aria-live="polite" className="text-[0.9286rem] font-medium text-text-primary">
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
        disabled={busy || overCap}
        onPick={v => { onSetField("status", v); }}
      />
      <BulkPicker
        label="Set priority"
        options={orderedPriorities.map(p => ({ id: p.key, label: p.label }))}
        clearLabel="Clear priority"
        disabled={busy || overCap}
        onPick={v => { onSetField("priority", v); }}
      />
      <BulkPicker
        label="Set assignee"
        options={active(users).map(u => ({ id: u.id, label: u.name ?? u.id }))}
        clearLabel="Unassign"
        disabled={busy || overCap}
        onPick={v => { onSetField("assignee", v); }}
      />
      <BulkPicker
        label="Set milestone"
        emptyReason="No milestones defined. Add one in Settings → Milestones"
        options={active(milestones).map(m => ({ id: m.id, label: m.name }))}
        clearLabel="No milestone"
        disabled={busy || overCap}
        onPick={v => { onSetField("milestone", v); }}
      />
      <BulkPicker
        label="Set sprint"
        emptyReason="No sprints defined. Add one in Settings → Sprints"
        options={active(sprints).map(sp => ({
          id: sp.id,
          label: sp.name,
          // BLK-8: state is shown so nobody assigns work to a sprint
          // that already finished without noticing.
          hint: sp.state,
        }))}
        clearLabel="No sprint"
        disabled={busy || overCap}
        onPick={v => { onSetField("sprint", v); }}
      />

      <BulkPicker
        label="Move to project"
        emptyReason="Only one project. Create another in Settings → Projects"
        options={active(projects).map(pr => ({ id: pr.id, label: pr.name }))}
        disabled={busy || overCap}
        onPick={v => { if (v !== null) onMove(v); }}
      />

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onArchive}
        disabled={busy || overCap}
      >
        Archive
      </Button>

      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={onDeleteRequested}
        disabled={busy || overCap}
      >
        Delete
      </Button>

      {result !== undefined && (
        <BulkResult result={result} action={resultAction} />
      )}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-auto"
      >
        Clear <Icon name="close" size={14} />
      </Button>
    </div>
  );
}

/**
 * The outcome of the last bulk action.
 *
 * Exported because it renders in two places: inside the bar while a
 * selection is held, and standalone once an action has cleared it. The
 * bar unmounts at zero selection, so an action that clears — archive,
 * move — would otherwise destroy the message reporting what it did.
 */
export function BulkResult({
  result,
  action,
}: {
  readonly result: { readonly message: string; readonly failures: readonly string[] };
  readonly action?: React.ReactNode;
}) {
  return (
    <span
      role="status"
      className={[
        "text-[0.8571rem]",
        result.failures.length > 0 ? "text-danger-fg" : "text-text-tertiary",
      ].join(" ")}
    >
      {result.message}
      {/* Each failure named individually, not summarised as a count
          (BLK-38) — and each is keyboard-reachable (A11Y-51): a `<ul>`
          of `tabIndex={0}` items a user can Tab through to read which
          tasks failed and why, rather than a single inert text join they
          could not land on. Each entry already names its task key. */}
      {result.failures.length > 0 && (
        <ul
          data-testid="bulk-failure-list"
          className="ml-1 inline-flex list-none flex-wrap gap-1 p-0 align-baseline text-text-tertiary"
        >
          {result.failures.map((f, i) => (
            <li
              // Failure strings are `key: error`; the key disambiguates,
              // but two tasks could share an error text, so index guards
              // the React key.
              key={`${f}-${String(i)}`}
              tabIndex={0}
              data-testid="bulk-failure-item"
              className="rounded bg-bg-muted px-1"
            >
              {f}
            </li>
          ))}
        </ul>
      )}
      {action}
    </span>
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
 * A one-shot value picker. Deliberately not `FilterFacet`: that one
 * is multi-select, holds a selected set, and labels itself "Filter by
 * X" — all wrong for an action that applies one value and is done.
 */
function BulkPicker({
  label,
  options,
  clearLabel,
  emptyReason,
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
  /**
   * Shown in place of the options when the workspace has none (BLK-17).
   *
   * A picker that opens onto nothing looks broken; one that says why,
   * and where to fix it, is a workspace that has not been set up yet.
   * The trigger is disabled so the state is reachable without a click
   * that leads nowhere.
   */
  readonly emptyReason?: string | undefined;
  readonly disabled: boolean;
  readonly onPick: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled || (emptyReason !== undefined && options.length === 0)}
        {...(options.length === 0 && emptyReason !== undefined ? { title: emptyReason } : {})}
        onClick={() => { setOpen(o => !o); }}
      >
        {label} <Icon name="chevronDown" size={12} />
      </Button>

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
              className="block w-full border-b border-border-subtle px-3 py-1.5 text-left text-[0.8571rem] italic text-text-secondary hover:bg-bg-muted"
            >
              {clearLabel}
            </button>
          )}
          {options.length === 0 && emptyReason !== undefined ? (
            <div className="px-3 py-2 text-[0.8571rem] italic text-text-tertiary">
              {emptyReason}
            </div>
          ) : options.length === 0 ? (
            clearLabel === undefined && (
              <div className="px-3 py-2 text-[0.8571rem] italic text-text-tertiary">
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
                className="block w-full px-3 py-1.5 text-left text-[0.8571rem] text-text-primary hover:bg-bg-muted"
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
