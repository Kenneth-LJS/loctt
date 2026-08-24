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
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary">
      <span className={["h-2 w-2 rounded-full", dotClass].join(" ")} style={dotStyle} />
      {def?.label ?? raw}
    </span>
  );
}

export function TypeBadge({ def, raw }: { def: TaskTypeDef | undefined; raw: string | undefined }) {
  if (raw === undefined) return <Dash />;
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
    <span className="inline-flex items-center rounded bg-bg-muted px-1.5 py-0.5 text-[11px] font-medium text-text-secondary" title={def?.name}>
      {def ? def.prefix.replace(/-$/, "") : raw}
    </span>
  );
}

export function AssigneeCell({ user, raw }: { user: UserProfile | undefined; raw: string | undefined }) {
  if (raw === undefined) return <Dash />;
  if (!user) {
    // Assigned to a now-deleted user: show the raw id truncated rather
    // than a blank, so the row isn't silently mis-readable.
    return <span className="text-[12px] text-text-tertiary">{raw.slice(0, 8)}…</span>;
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

export function LabelsCell({ labels }: { labels: readonly (LabelDef | { id: string })[] }) {
  if (labels.length === 0) return <Dash />;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map(l => {
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
            {named?.name ?? l.id.slice(0, 6)}
          </span>
        );
      })}
    </span>
  );
}

export function Dash() {
  return <span className="text-text-tertiary">—</span>;
}
