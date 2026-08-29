import { useEffect, useId, useRef, useState } from "react";

/**
 * One selectable option in a picker.
 *
 * `label` is what the user sees; `key` is what lands on disk. P3 is the
 * whole reason this shape exists: statuses, priorities, types, enum
 * custom-field values, milestones and sprints all store a key or a
 * ULID and all display something the user configured, and none of them
 * may be shown by their stored value.
 *
 * `disabled` is for archived entities. An archived milestone must not
 * be *choosable* (TSK-10, TSK-33) but must still be *displayable* when
 * a task already references one — so the option stays in the list,
 * marked, rather than being filtered out and rendering the current
 * value as blank.
 */
export interface PickerOption {
  readonly key: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Rendered after the label, e.g. "(archived)". */
  readonly suffix?: string;
  /** Distinguishes options whose labels collide (TSK-7). */
  readonly hint?: string;
  readonly color?: string | undefined;
}

/**
 * A listbox that edits one field inline.
 *
 * ## Why not `<select>`
 *
 * Three of the case's requirements are not expressible in a native
 * select: an option that is present but unselectable *and explains
 * why* (archived), a per-option disambiguating hint (TSK-7's two users
 * sharing a display name), and a value that is set but not in the
 * option list at all (TSK-30 / XS-27's stale enum value, which must
 * render flagged rather than blank). A native select silently drops a
 * value it has no `<option>` for, which is the exact failure XS-27
 * names.
 *
 * ## Escape (TSK-41)
 *
 * Escape closes the list, leaves the value alone, sends nothing, and
 * returns focus to the trigger. The last part is not decoration: a
 * keyboard user whose focus is dropped on the body has to tab from the
 * top of the document to get back, which is what P8 means by a
 * frequent path staying keyboard-reachable.
 */
export function OptionPicker({
  label,
  value,
  options,
  onSelect,
  onClear,
  clearLabel,
  emptyText = "—",
  disabledReason,
}: {
  /** The field's own label, for the trigger's accessible name. */
  readonly label: string;
  /** The stored key, or undefined when unset. */
  readonly value: string | undefined;
  readonly options: readonly PickerOption[];
  readonly onSelect: (key: string) => void;
  /** Omit to make the field non-clearable. */
  readonly onClear?: (() => void) | undefined;
  readonly clearLabel?: string;
  readonly emptyText?: string;
  /**
   * Why a given option cannot be picked, rendered once under the list.
   * Archived entities are the only current use.
   */
  readonly disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    // TSK-41's third bullet. Only on a deliberate close — on an
    // outside click the user has already moved focus somewhere they
    // chose, and yanking it back would be worse than leaving it.
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (
        listRef.current?.contains(t) !== true &&
        triggerRef.current?.contains(t) !== true
      ) {
        close(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const current = options.find(o => o.key === value);
  // Set, but the config no longer declares it. TSK-30, XS-27, and the
  // status/priority equivalents all land here. Rendering the raw key
  // would violate P3; rendering nothing would lose the fact that the
  // file holds a value.
  const unrecognized = value !== undefined && current === undefined;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid={`meta-edit-${fieldSlug(label)}`}
        aria-label={`${label}: ${current?.label ?? (unrecognized ? value : "not set")}. Change`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => { setOpen(o => !o); }}
        className="-mx-1 w-full rounded px-1 py-0.5 text-left text-[13px] text-text-primary hover:bg-bg-muted"
      >
        {current !== undefined ? (
          <span className="inline-flex items-center gap-1.5">
            {current.color !== undefined && (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: current.color }}
              />
            )}
            <span className="break-words">{current.label}</span>
            {current.suffix !== undefined && (
              <span className="text-text-tertiary">{current.suffix}</span>
            )}
          </span>
        ) : unrecognized ? (
          // Flagged, and the stored value shown, because the user has
          // to know *which* value to fix. "Unrecognized" alone would
          // send them to the file to find out what it says.
          <span data-testid={`meta-unrecognized-${fieldSlug(label)}`} className="text-warning-fg">
            {value} — not in the current config
          </span>
        ) : (
          <span className="text-text-tertiary">{emptyText}</span>
        )}
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          data-testid={`meta-options-${fieldSlug(label)}`}
          className="absolute right-0 z-20 mt-1 max-h-64 min-w-[200px] overflow-auto rounded-md border border-border-subtle bg-bg-surface py-1 shadow-lg"
        >
          {onClear !== undefined && value !== undefined && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { onClear(); close(true); }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-text-tertiary hover:bg-bg-muted"
            >
              {clearLabel ?? `Clear ${label.toLowerCase()}`}
            </button>
          )}
          {options.map(opt => (
            <button
              key={opt.key}
              type="button"
              role="option"
              aria-selected={opt.key === value}
              disabled={opt.disabled === true}
              // The archived option is present and named, so the user
              // learns the entity exists and is archived rather than
              // wondering where it went (P7).
              title={opt.disabled === true ? disabledReason : undefined}
              onClick={() => {
                if (opt.disabled === true) return;
                onSelect(opt.key);
                close(true);
              }}
              className={
                "block w-full px-3 py-1.5 text-left text-[13px] " +
                (opt.disabled === true
                  ? "cursor-not-allowed text-text-tertiary opacity-60"
                  : "text-text-primary hover:bg-bg-muted")
              }
            >
              <span className="inline-flex items-center gap-1.5">
                {opt.color !== undefined && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: opt.color }}
                  />
                )}
                {opt.label}
                {opt.suffix !== undefined && (
                  <span className="text-text-tertiary">{opt.suffix}</span>
                )}
                {opt.hint !== undefined && (
                  <span className="font-mono text-[11px] text-text-tertiary">
                    {opt.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
          {disabledReason !== undefined && options.some(o => o.disabled === true) && (
            <p className="border-t border-border-subtle px-3 pb-1 pt-1.5 text-[11px] text-text-tertiary">
              {disabledReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Stable test/DOM id from a field label ("Start date" → "start-date"). */
export function fieldSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
