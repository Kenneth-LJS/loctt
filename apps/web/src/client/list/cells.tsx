import type {
  LabelDef,
  PriorityDef,
  ProjectDef,
  StatusDef,
  TaskTypeDef,
  UserProfile,
} from "@loctt/contracts";

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
 * How many label pills a row shows before collapsing the rest.
 *
 * LST-19: 25 labels wrapped freely and turned one row into a block
 * tall enough to push every later column out of view. The overflow is
 * *stated* rather than silently dropped, so the user can tell labels
 * are hidden.
 */
const MAX_LABEL_PILLS = 3;

export function LabelsCell({ labels }: { labels: readonly (LabelDef | { id: string })[] }) {
  if (labels.length === 0) return <Dash />;
  const shown = labels.slice(0, MAX_LABEL_PILLS);
  const hidden = labels.length - shown.length;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      {shown.map(l => {
        const named = "name" in l ? l : undefined;
        const color = named?.color;
        return (
          <span
            key={l.id}
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px]"
            style={
              color
                ? { background: `${color}22`, color }
                : { background: "var(--bg-muted)", color: "var(--text-secondary)" }
            }
          >
            {/* A label the config no longer defines is named as
                unresolved rather than shown as six characters of its
                ULID, which P-4 keeps out of UI content entirely. */}
            {named?.name ?? "unknown label"}
          </span>
        );
      })}
      {hidden > 0 && (
        <span
          title={labels.map(l => ("name" in l ? l.name : "unknown label")).join(", ")}
          className="inline-flex items-center rounded bg-bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary"
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}

export function Dash() {
  return <span className="text-text-tertiary">—</span>;
}
