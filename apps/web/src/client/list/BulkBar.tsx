import type { WorkflowConfig } from "@loctt/contracts";
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
  busy,
  result,
  onClear,
  onSetField,
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
  /** Disables every action while one is in flight (BLK-31). */
  readonly busy: boolean;
  /** Outcome of the last action, shown until the next one starts. */
  readonly result?:
    | { readonly message: string; readonly failures: readonly string[] }
    | undefined;
  readonly onClear: () => void;
  readonly onSetField: (field: string, value: string) => void;
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
 * A one-shot value picker. Deliberately not `FilterDropdown`: that one
 * is multi-select, holds a selected set, and labels itself "Filter by
 * X" — all wrong for an action that applies one value and is done.
 */
function BulkPicker({
  label,
  options,
  disabled,
  onPick,
}: {
  readonly label: string;
  readonly options: readonly { id: string; label: string }[];
  readonly disabled: boolean;
  readonly onPick: (value: string) => void;
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
          {options.length === 0 ? (
            <div className="px-3 py-2 text-[12px] italic text-text-tertiary">
              No options
            </div>
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
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
