import type {
  LabelDef,
  PriorityDef,
  ProjectDef,
  StatusDef,
  TaskTypeDef,
  UserProfile,
} from "@loctt/contracts";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { avatarPalette, initials } from "../ui/avatar.ts";

/**
 * Cell renderers for the list table. Each takes an already-resolved
 * def (from ListLookups) and falls back gracefully when the def is
 * missing — a task can reference a status/label that was later
 * deleted, and the table must still render the raw key rather than
 * crash or show a blank.
 */

/** Maps a status category to its token-backed badge colour classes. */
const STATUS_CATEGORY_CLASS: Record<string, string> = {
  pending: "bg-status-pending-bg text-status-pending-fg",
  active: "bg-status-active-bg text-status-active-fg",
  completed: "bg-status-completed-bg text-status-completed-fg",
  discarded: "bg-status-discarded-bg text-status-discarded-fg",
};

export function StatusBadge({ def, raw }: { def: StatusDef | undefined; raw: string | undefined }) {
  if (raw === undefined) return <Dash />;
  const cls = def ? STATUS_CATEGORY_CLASS[def.category] ?? "" : "";
  // A status the workflow no longer defines is drift, not an ordinary
  // uncategorised value (BLK-29). Rendering the raw key in the same
  // grey as a valid status makes the two indistinguishable, so the user
  // cannot tell a config change happened underneath their tasks. Marked
  // with a glyph and a title, not colour alone.
  const orphaned = def === undefined;
  return (
    <span
      title={orphaned ? `"${raw}" is not defined in workflow.yaml` : undefined}
      className={[
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium",
        orphaned
          ? "border border-dashed border-danger-fg/50 text-danger-fg"
          : cls || "bg-bg-muted text-text-secondary",
      ].join(" ")}
    >
      {orphaned && <span aria-hidden="true">⚠</span>}
      {def?.label ?? raw}
      {orphaned && <span className="sr-only"> (unknown status)</span>}
    </span>
  );
}

const PRIORITY_DOT_CLASS: Record<string, string> = {
  critical: "bg-priority-critical",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

export function PriorityCell({ def, raw }: { def: PriorityDef | undefined; raw: string | undefined }) {
  if (raw === undefined) return <Dash />;
  // Prefer the workflow's own colour; else fall back to a key-based
  // dot class so the common critical/high/medium/low keys still tint.
  const dotStyle = def?.color ? { background: def.color } : undefined;
  const dotClass = def?.color ? "" : PRIORITY_DOT_CLASS[raw] ?? "bg-text-tertiary";
  // LST-27: a priority the workflow no longer declares is flagged, not
  // rendered as an ordinary value. Same treatment as an unknown status
  // (BLK-29) — a config change that orphaned rows is invisible
  // otherwise.
  if (!def) return <UnknownValue raw={raw} />;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary">
      <span className={["h-2 w-2 rounded-full", dotClass].join(" ")} style={dotStyle} />
      {def.label}
    </span>
  );
}

/**
 * An enum value stored on a task that the workflow no longer declares.
 *
 * The raw key is kept — it is the only handle the user has on what the
 * task actually stores — but marked so it is distinguishable from a
 * legitimate value, and with a glyph rather than colour alone.
 */
function UnknownValue({ raw }: { raw: string }) {
  return (
    <span
      title={`"${raw}" is not defined in workflow.yaml`}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-danger-fg/50 px-1.5 py-0.5 text-[12px] font-medium text-danger-fg"
    >
      <span aria-hidden="true">⚠</span>
      {raw}
      <span className="sr-only"> (unrecognised)</span>
    </span>
  );
}

export function TypeBadge({ def, raw }: { def: TaskTypeDef | undefined; raw: string | undefined }) {
  if (raw === undefined) return <Dash />;
  if (!def) return <UnknownValue raw={raw} />;
  return (
    <span
      className="inline-flex items-center rounded-md border border-border-default px-1.5 py-0.5 text-[12px] text-text-secondary"
      style={def?.color ? { borderColor: def.color, color: def.color } : undefined}
    >
      {def?.label ?? raw}
    </span>
  );
}

export function ProjectChip({ def, raw }: { def: ProjectDef | undefined; raw: string | undefined }) {
  if (raw === undefined) return <Dash />;
  return (
    <span
      // BRD-23's bullet 1 turns on this chip being *present* on every
      // card of an all-projects board. It had no testid, so the case
      // could only assert the key text — and deleting the chip
      // entirely left BRD-23 green (the M3 gate measured it).
      data-testid="project-chip"
      className={[
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        def
          ? "bg-bg-muted text-text-secondary"
          : "border border-dashed border-danger-fg/50 text-danger-fg",
      ].join(" ")}
      title={def?.name ?? `No project matches ${raw}`}
    >
      {/* A project the config no longer defines is marked as drift, not
          printed as its raw id — P-4 keeps ULIDs out of UI content, and
          the raw value read as a legitimate prefix. */}
      {def ? def.prefix.replace(/-$/, "") : "unknown"}
    </span>
  );
}

export function AssigneeCell({ user, raw }: { user: UserProfile | undefined; raw: string | undefined }) {
  if (raw === undefined) return <Dash />;
  if (!user) {
    // Assigned to someone the tracker no longer knows. Named as
    // unresolved rather than shown as eight characters of a ULID, which
    // P-4 keeps out of UI content and which told the reader nothing
    // anyway. An *archived* user is not this case — those resolve, with
    // their name (LST-25).
    return (
      <span title={`No user matches ${raw}`} className="text-[12px] italic text-text-tertiary">
        unknown user
      </span>
    );
  }
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={["grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold", avatarPalette(user.id)].join(" ")}>
        {initials(user.name)}
      </span>
      <span className={["truncate text-[13px]", user.archived ? "text-text-tertiary" : "text-text-secondary"].join(" ")}>
        {firstName}
        {user.archived ? " (archived)" : ""}
      </span>
    </span>
  );
}
/**
 * A text colour that stays legible on a 13%-alpha wash of `hex`.
 *
 * The wash sits over the surface, so the effective background is close
 * to the surface itself — which means the *theme* decides readability
 * far more than the label colour does. Returning a token rather than a
 * computed value lets both themes stay legible without the pill
 * knowing which one is active (MSL-23).
 *
 * The label's own colour is kept where it reads on that wash;
 * otherwise the pill hands back to the surface's own text colour,
 * which is legible by construction.
 */
function readableOn(hex: string): string {
  const n = hex.length === 4
    ? hex.slice(1).split("").map(c => parseInt(c + c, 16))
    : [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r = 0, g = 0, b = 0] = n;
  // Rec. 601 luma, which is what browsers' own contrast heuristics use.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // Too pale to read on a light background, too dark on a dark one:
  // hand back to the theme rather than guessing.
  return luma > 0.75 || luma < 0.25 ? "var(--text-primary)" : hex;
}


/**
 * How many label pills a row shows before collapsing the rest.
 *
 * LST-19: 25 labels wrapped freely and turned one row into a block
 * tall enough to push every later column out of view. The overflow is
 * *stated* rather than silently dropped, so the user can tell labels
 * are hidden.
 */
const MAX_LABEL_PILLS = 3;

/**
 * One label pill.
 *
 * Extracted from `LabelsCell` under K12: MSL-20's second bullet wants
 * the labels behind the `+N` to stay "individually clickable to
 * filter", which means the revealed ones must be the *same* control as
 * the visible ones, not a text list that looks similar. Two renderings
 * of a pill is exactly how the hidden ones end up subtly less
 * functional than the shown ones.
 */
function LabelPill({
  label,
  onFilter,
}: {
  readonly label: LabelDef | { id: string };
  readonly onFilter?: ((id: string) => void) | undefined;
}) {
  const named = "name" in label ? label : undefined;
  // Only a real hex reaches CSS. `${color}22` on "notahex" is not
  // a colour, so the pill rendered unstyled — MSL-22 requires a
  // defined neutral fallback instead, and the schema rejects
  // non-hex, so anything else here is config drift.
  const color = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(named?.color ?? "")
    ? named?.color
    : undefined;
  const Pill = onFilter ? "button" : "span";
  return (
    <Pill
      {...(onFilter
        ? {
            type: "button" as const,
            // The row itself navigates to the task, so a pill
            // click has to stop there — LST-5 is explicit that
            // clicking a label filters rather than opening.
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              onFilter(label.id);
            },
          }
        : {})}
      title={named?.name}
      className="inline-flex items-center rounded border border-border-subtle px-1.5 py-0.5 text-[11px]"
      style={
        color
          // MSL-23: text contrast is computed against the
          // pill's *own* background. Using the label colour for
          // both meant a very pale yellow rendered pale-on-pale
          // and a very dark navy dark-on-dark — legible in the
          // middle of the range, invisible at the ends.
          ? {
              background: `${color}22`,
              color: readableOn(color),
              borderColor: `${color}66`,
            }
          : { background: "var(--bg-muted)", color: "var(--text-secondary)" }
      }
    >
      {/* A label the config no longer defines is named as
          unresolved rather than shown as six characters of its
          ULID, which P-4 keeps out of UI content entirely.
          MSL-26: a 100-character name truncates within the pill,
          with the full text on hover. */}
      <span className="max-w-[14ch] truncate">
        {named?.name ?? "unknown label"}
      </span>
    </Pill>
  );
}

/**
 * The `+N` overflow affordance and the panel it reveals (K12, MSL-20).
 *
 * ## Why a portal, and why `position: fixed`
 *
 * Both call sites clip. The list table lives inside
 * `overflow-x-auto overflow-y-hidden` (ListView) and a board column
 * inside `overflow-y-auto` (BoardView) — an absolutely-positioned
 * panel anchored to the trigger is cut off by whichever ancestor
 * scrolls, which is why `Menu`'s CSS-anchored approach could not be
 * reused here. The panel is portalled to `document.body` and
 * positioned from the trigger's measured rect instead.
 *
 * The cost is that the panel does not follow the trigger when an
 * ancestor scrolls, so it closes on scroll rather than drifting away
 * from the pill it belongs to.
 *
 * ## Interaction
 *
 * Click (and Enter/Space, since the trigger is a real button) toggles;
 * hover opens without stealing focus, so MSL-20's "on click/hover" is
 * satisfied for both input methods. Escape closes and returns focus to
 * the trigger (flow-accessibility § Esc). Outside pointer-down closes.
 * The trigger carries `aria-expanded` and `aria-haspopup`, and the
 * panel is a labelled group whose pills are ordinary buttons, so each
 * revealed label is reachable by Tab and announced with its own name.
 */
function LabelOverflow({
  hidden,
  onFilter,
}: {
  readonly hidden: readonly (LabelDef | { id: string })[];
  readonly onFilter?: ((id: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  /**
   * Placed after layout so the panel's real size is known.
   *
   * MSL-20 is a viewport case: near the right edge the panel is
   * flipped to end-align with the trigger rather than running off
   * screen, and near the bottom it opens upward. Measuring first is
   * the only way to know which — a CSS-only anchor cannot.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current?.getBoundingClientRect();
    const p = panelRef.current?.getBoundingClientRect();
    if (t === undefined || p === undefined) return;
    const margin = 8;
    let left = t.left;
    if (left + p.width > window.innerWidth - margin) {
      left = Math.max(margin, t.right - p.width);
    }
    let top = t.bottom + 4;
    if (top + p.height > window.innerHeight - margin) {
      top = Math.max(margin, t.top - p.height - 4);
    }
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Only this layer. Anything above it (a modal) handles its own
      // Escape, and swallowing the event here would close both.
      e.stopPropagation();
      close(true);
    };
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) === true) return;
      if (panelRef.current?.contains(target) === true) return;
      close(false);
    };
    // Capture: a scrolling ancestor does not bubble its scroll event.
    const onScroll = (): void => { close(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  return (
    <span
      className="inline-flex"
      onMouseEnter={() => { setOpen(true); }}
      // Not closed on the trigger's own mouseleave: the pointer has to
      // cross the gap to reach the panel. The panel's leave handler
      // closes it, and a click elsewhere closes it regardless.
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="label-overflow-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        {...(open ? { "aria-controls": panelId } : {})}
        // "button" alone tells a screen-reader user nothing about what
        // "+3" is for (flow-accessibility § controls announce a
        // specific action).
        aria-label={`Show ${hidden.length} more ${hidden.length === 1 ? "label" : "labels"}`}
        onClick={e => {
          // The row navigates; revealing labels must not open the task.
          e.stopPropagation();
          setOpen(o => !o);
        }}
        className="inline-flex items-center rounded bg-bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
      >
        +{hidden.length}
      </button>
      {open
        && createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            data-testid="label-overflow-panel"
            aria-label={`${hidden.length} more ${hidden.length === 1 ? "label" : "labels"}`}
            onMouseLeave={() => { close(false); }}
            onClick={e => { e.stopPropagation(); }}
            className="fixed z-50 flex max-w-[280px] flex-wrap gap-1 rounded-lg border border-border-default bg-bg-surface-raised p-2 shadow-overlay"
            style={
              // Rendered off-screen for the first paint so it can be
              // measured without flashing in the wrong place.
              pos === null
                ? { left: 0, top: 0, visibility: "hidden" }
                : { left: pos.left, top: pos.top }
            }
          >
            {hidden.map(l => (
              <LabelPill key={l.id} label={l} onFilter={onFilter} />
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

export function LabelsCell({
  labels,
  onFilter,
}: {
  readonly labels: readonly (LabelDef | { id: string })[];
  /**
   * Clicking a pill filters the list to that label (MSL-6).
   *
   * Optional so the cell stays usable where a filter makes no sense —
   * the pill falls back to plain text rather than a dead button.
   */
  readonly onFilter?: ((id: string) => void) | undefined;
}) {
  if (labels.length === 0) return <Dash />;
  const shown = labels.slice(0, MAX_LABEL_PILLS);
  const hidden = labels.slice(MAX_LABEL_PILLS);
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      {shown.map(l => (
        <LabelPill key={l.id} label={l} onFilter={onFilter} />
      ))}
      {hidden.length > 0 && (
        <LabelOverflow hidden={hidden} onFilter={onFilter} />
      )}
    </span>
  );
}

export function Dash() {
  return <span className="text-text-tertiary">—</span>;
}
