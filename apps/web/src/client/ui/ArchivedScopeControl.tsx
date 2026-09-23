import type { ArchivedScope } from "@loctt/contracts";
import { useId, useRef } from "react";

import { cn } from "./cn.ts";
import { TOOLBAR_ACTIVE } from "./ToolbarButton.tsx";

/**
 * The one tri-state "archived scope" control (K107). Every archivable
 * list — the task list's FilterBar and the Sprints/Users/Milestones/
 * Labels/Projects/Saved-views panels — reveals archived entities through
 * this one control instead of the two hand-rolled boolean "Show archived"
 * checkboxes that drifted before (SprintsPanel/UsersPanel had one;
 * Milestones/Labels/Projects/Views had none — K107 adds it everywhere).
 *
 * `active` (the default everywhere) hides archived; `archived` shows only
 * archived; `all` shows both — the same three values core's
 * `applyArchivedScope` / the task list's `archivedScope` understand, so the
 * control's value flows straight to the server's `?archived=` param.
 *
 * ## Why this is a segmented radiogroup, not a native `<select>`
 *
 * It *was* a themed native `<select>`, on the argument that a fixed set of
 * three is what a `<select>` is for, that it is natively accessible, and
 * that mobile gets the OS picker for free. Ken overruled that on
 * 2026-09-22: replace the primitive everywhere, desktop and mobile alike,
 * with no responsive native/custom branch. The reasons, so this is not
 * "restored" by the next agent who reads the old docstring:
 *
 * 1. **The mobile branch is viewport-width only.** `shell/useIsNarrow`
 *    is `matchMedia("(max-width: 639px)")` — no touch or pointer probe.
 *    A desktop window dragged narrow would hand a mouse user an OS wheel
 *    picker. "Mobile gets the native picker" was never the condition
 *    actually being tested.
 * 2. **Its siblings can never be native.** The filter row's `FilterFacet`
 *    controls are `ui/Dropdown` custom multi-selects with
 *    `menuitemcheckbox` semantics; a native `<select>` cannot express
 *    that. Half-native / half-custom in one row is the inconsistency
 *    being removed.
 * 3. **The native picker's real advantage is scrolling a long list.**
 *    This control has three fixed options — a segmented control shows
 *    all three at once, so there is nothing to scroll and the current
 *    scope is readable without opening anything.
 *
 * What the `<select>` gave for free and is now implemented here (see
 * `ui/Dropdown`'s A11Y-10 menu mode, whose roving-focus model this
 * follows): `role="radiogroup"` named by the visible label through
 * `aria-labelledby`; three `role="radio"` children carrying `aria-checked`;
 * arrow-key **selection-follows-focus** (Left/Right/Up/Down, plus
 * Home/End), which is the ARIA radiogroup pattern and matches what a
 * `<select>`'s arrow keys did; and a **single tab stop** via roving
 * `tabIndex` so Tab leaves the group rather than walking its options.
 * The focus ring is the app's global `:focus-visible` outline — nothing
 * hand-rolled here.
 *
 * `testId` lands on the group, which also carries `data-value` (the
 * parity `Dropdown`'s `dataValue` was added for): assert on `data-value`
 * or on `aria-checked`, not on `HTMLSelectElement.value`.
 */

/** The label rendered for each scope. */
const SCOPE_LABEL: Record<ArchivedScope, string> = {
  active: "Active",
  archived: "Archived",
  all: "All",
};

/** The three scopes in the order they appear in the control. */
const SCOPE_ORDER: readonly ArchivedScope[] = ["active", "archived", "all"];

/** Segment sizes, matched to the `Select`/`Button` heights they sit beside. */
export type ArchivedScopeSize = "sm" | "md";

const SIZE_CLASS: Record<ArchivedScopeSize, string> = {
  sm: "h-7 px-2.5 text-label",
  md: "h-8 px-3 text-body",
};

export interface ArchivedScopeControlProps {
  readonly value: ArchivedScope;
  readonly onChange: (scope: ArchivedScope) => void;
  /**
   * Optional per-scope count suffixes, e.g. `{ archived: 3 }` renders the
   * segment as "Archived (3)". Only shown for scopes present in the map.
   */
  readonly counts?: Partial<Record<ArchivedScope, number>>;
  /** Visible label to the left of the control. Defaults to "Show". */
  readonly label?: string;
  readonly size?: ArchivedScopeSize;
  /** The group's `data-testid`; defaults to `archived-scope`. */
  readonly testId?: string;
  /**
   * A stable id for the group. The visible label is derived from it, so
   * `aria-labelledby` can point at the label. Defaults to a value derived
   * from `testId`, which is unique per surface.
   */
  readonly id?: string;
  /** Greys out and blocks every segment; the group stays focusable. */
  readonly disabled?: boolean;
  /** Escape hatch on the wrapper: layout/spacing only. */
  readonly className?: string;
}

export function ArchivedScopeControl({
  value,
  onChange,
  counts,
  label = "Show",
  size = "sm",
  testId = "archived-scope",
  id,
  disabled = false,
  className,
}: ArchivedScopeControlProps) {
  const groupId = id ?? `${testId}-group`;
  const labelId = `${groupId}-label`;
  const reactId = useId();
  const groupRef = useRef<HTMLDivElement>(null);

  /** The rendered radios, in DOM order — the roving-focus travel set. */
  const radios = (): HTMLElement[] =>
    groupRef.current
      ? Array.from(groupRef.current.querySelectorAll<HTMLElement>('[role="radio"]'))
      : [];

  /**
   * The ARIA radiogroup key model: arrows move focus AND selection
   * (selection-follows-focus), wrapping; Home/End jump to the ends.
   * Left/Up and Right/Down are deliberately both bound — a radiogroup's
   * orientation should not decide whether a key works.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    const items = radios();
    if (items.length === 0) return;
    const current = items.findIndex(el => el === document.activeElement);
    const moveTo = (i: number): void => {
      e.preventDefault();
      const n = items.length;
      const idx = ((i % n) + n) % n;
      items[idx]?.focus();
      const scope = SCOPE_ORDER[idx];
      if (scope !== undefined && scope !== value) onChange(scope);
    };
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        moveTo(current === -1 ? 0 : current + 1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        moveTo(current === -1 ? items.length - 1 : current - 1);
        return;
      case "Home":
        moveTo(0);
        return;
      case "End":
        moveTo(items.length - 1);
        return;
      default:
        return;
    }
  };

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <span id={labelId} className="text-label text-text-secondary">
        {label}
      </span>
      <div
        ref={groupRef}
        id={groupId}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-disabled={disabled ? true : undefined}
        data-testid={testId}
        data-value={value}
        className="inline-flex items-center"
        onKeyDown={onKeyDown}
      >
        {SCOPE_ORDER.map((scope, i) => {
          const checked = scope === value;
          const count = counts?.[scope];
          const first = i === 0;
          const last = i === SCOPE_ORDER.length - 1;
          return (
            <button
              key={scope}
              type="button"
              // A native `<button>` would be `role="button"`; the group
              // promises radios, so the role is overridden and the
              // checked state carried by `aria-checked`.
              role="radio"
              id={`${reactId}-${scope}`}
              aria-checked={checked}
              // The single tab stop: only the checked segment is
              // tabbable, so Tab enters the group once and leaves it.
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              data-scope={scope}
              data-testid={`${testId}-${scope}`}
              onClick={() => { if (!checked) onChange(scope); }}
              className={cn(
                // The joined-button seam: one shared border, square
                // inner edges, and the segments overlapping by a pixel
                // so the divider is one line rather than two.
                "inline-flex items-center justify-center whitespace-nowrap border " +
                  "border-border-default bg-bg-surface text-text-secondary " +
                  "cursor-pointer transition-colors hover:bg-bg-muted-hover " +
                  "disabled:cursor-not-allowed disabled:bg-bg-muted disabled:text-text-disabled",
                SIZE_CLASS[size],
                first && "rounded-l-md",
                last && "rounded-r-md",
                !first && "-ml-px",
                // Selected reuses the toolbar's documented active look
                // (ToolbarButton's TOOLBAR_ACTIVE) rather than a new
                // one, and sits above its neighbours so its accent
                // border is not overlapped by the next segment's.
                checked && "relative z-10 " + TOOLBAR_ACTIVE,
              )}
            >
              {count !== undefined ? `${SCOPE_LABEL[scope]} (${String(count)})` : SCOPE_LABEL[scope]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
