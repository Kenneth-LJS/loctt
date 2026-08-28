import type { TrackerInfoResponse } from "@loctt/contracts";
import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useLabels,
  useMilestones,
  useProjects,
  useRecents,
  useSprints,
  useViews,
} from "../api/hooks/sidebarData.ts";
import { useBuiltinCounts } from "../api/hooks/useBuiltinCounts.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { RegionErrorBoundary } from "../error/RegionErrorBoundary.tsx";
import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";
import { useVanishedViews } from "./useVanishedViews.ts";

/**
 * The app's left sidebar. Renders, top to bottom: the view switcher
 * (List / Board / Timeline), then data-driven groups — Projects, Saved
 * filters (built-ins + user views + New filter), Milestones, Sprints,
 * Labels, Recently viewed — and a footer with the tracker's working
 * directory and a Settings link.
 *
 * All groups read live query data. Active-item highlighting is derived
 * from the current route (and, for projects/built-ins, the active
 * search params). When collapsed, labels and group headers hide and
 * items shrink to icon width; the parent grid animates the column.
 */
export function Sidebar({
  collapsed,
  info,
  currentUserId,
  today,
}: {
  readonly collapsed: boolean;
  readonly info: TrackerInfoResponse;
  readonly currentUserId: string | null;
  readonly today: string;
}) {
  return (
    <aside
      className={[
        "row-start-2 flex min-h-0 flex-col border-r border-border-subtle bg-bg-surface py-3",
        "transition-[width] duration-150 ease-out",
        collapsed ? "w-14 px-2" : "w-60 px-2",
      ].join(" ")}
      data-collapsed={collapsed}
    >
      {/* The groups scroll; the footer does not.
          SHL-11 requires the workspace label and Settings to stay
          pinned "and not scroll away with the groups", and SHL-20/21
          put enough entries above them (20 recents, 30 projects, 40
          labels) to make that the normal case rather than the extreme
          one. Scrolling the whole column satisfies "reachable" and
          fails "pinned". */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-sidebar-scroll="true">
        {/* ERR-34: a render throw in one group must not white-page the
            app. Each group is its own boundary, so the rest of the
            sidebar, the header and the main pane keep working. */}
        <RegionErrorBoundary region="the view switcher">
          <ViewSwitcher collapsed={collapsed} />
        </RegionErrorBoundary>
        <RegionErrorBoundary region="the projects list">
          <ProjectsGroup collapsed={collapsed} />
        </RegionErrorBoundary>
        <RegionErrorBoundary region="the saved filters">
          <SavedFiltersGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />
        </RegionErrorBoundary>
        <RegionErrorBoundary region="the milestones list">
          <MilestonesGroup collapsed={collapsed} />
        </RegionErrorBoundary>
        <RegionErrorBoundary region="the sprints list">
          <SprintsGroup collapsed={collapsed} />
        </RegionErrorBoundary>
        <RegionErrorBoundary region="the labels list">
          <LabelsGroup collapsed={collapsed} />
        </RegionErrorBoundary>
        <RegionErrorBoundary region="recently viewed">
          <RecentsGroup collapsed={collapsed} />
        </RegionErrorBoundary>
      </div>
      <Footer collapsed={collapsed} info={info} />
    </aside>
  );
}

/* ---------- shared item primitives ---------- */

function GroupLabel({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (collapsed) return null;
  return (
    <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
      {children}
    </div>
  );
}

function ItemShell({
  active,
  collapsed,
  title,
  children,
}: {
  active?: boolean;
  collapsed: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-active={active ? "true" : undefined}
      // The tooltip lives on the enclosing <a> so keyboard focus
      // surfaces it too (SHL-19, SHL-22); repeating it here would nest
      // two tooltips on the same target. Kept for the non-link rows —
      // the deferred "Mentions me" and the collapsed icons — which have
      // no anchor of their own.
      title={title}
      className={[
        "flex h-8 items-center rounded-md text-[13px] font-medium",
        collapsed ? "w-10 justify-center px-0" : "gap-2.5 px-2.5",
        active
          ? "bg-accent-muted text-accent"
          : "text-text-secondary hover:bg-bg-muted hover:text-text-primary",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/**
 * A built-in's count badge.
 *
 * The slot is reserved before the number arrives (ONB-14, SHL-23):
 * rendering nothing while a count is in flight and then inserting a
 * pill shifts every row below it, so a click aimed mid-load lands on
 * the wrong item. `min-w` holds the width of a three-digit count,
 * which covers the overwhelming majority; a wider number grows the
 * pill rather than being clipped.
 *
 * `pending` and "no badge at all" are different: "Mentions me" has no
 * count to wait for (VUE-2) and gets no slot, while a slow query
 * (SHL-23) shows a pending affordance in a slot that is already the
 * right size.
 */
function Badge({
  value,
  pending = false,
  unavailable = false,
}: {
  value: number | undefined;
  pending?: boolean;
  unavailable?: boolean;
}) {
  if (value === undefined && !pending && !unavailable) return null;
  return (
    <span
      data-pending={pending ? "true" : undefined}
      data-unavailable={unavailable ? "true" : undefined}
      title={unavailable ? "Count unavailable" : undefined}
      className="ml-auto min-w-[1.75rem] rounded-full bg-bg-muted px-1.5 text-center text-[11px] tabular-nums text-text-tertiary"
    >
      {value !== undefined ? value : unavailable ? "—" : "\u00b7\u00b7\u00b7"}
    </span>
  );
}

function ColorDot({ color }: { color?: string | undefined }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color ?? "var(--text-tertiary)" }}
    />
  );
}

/* ---------- groups ---------- */

const VIEWS = [
  { to: "/list" as const, label: "List", icon: <ListIcon /> },
  { to: "/board" as const, label: "Board", icon: <BoardIcon /> },
  { to: "/timeline" as const, label: "Timeline", icon: <TimelineIcon /> },
];

function ViewSwitcher({ collapsed }: { collapsed: boolean }) {
  const pathname = useRouterState({ select: s => s.location.pathname });
  return (
    <div className="flex flex-col gap-0.5">
      {VIEWS.map(v => (
        <Link key={v.to} to={v.to} title={v.label} className="no-underline">
          <ItemShell active={pathname === v.to} collapsed={collapsed} title={v.label}>
            <span className="shrink-0">{v.icon}</span>
            {!collapsed ? <span>{v.label}</span> : null}
          </ItemShell>
        </Link>
      ))}
    </div>
  );
}

/**
 * A sidebar group whose data could not be loaded.
 *
 * Every group used `data?.items ?? []`, so a failed fetch rendered as an
 * empty group — indistinguishable from a tracker that genuinely has no
 * projects, no labels, no sprints. ERR-1's rule is the same here as in
 * the list: a failure and an absence must not look alike.
 *
 * Deliberately compact rather than the full `ErrorState`. The sidebar is
 * a narrow column and six groups can fail at once; a headline, a data
 * state and a Retry button per group would bury the navigation this
 * component exists to provide. Retry is offered on the marker itself,
 * which is the control ERR-15 asks for.
 *
 * Compact is not the same as uninformative. The M1 gate found (F4) that
 * a `labels.yaml` the user had broken by hand reported only "Could not
 * load. Retry" — the filename never appeared anywhere in the UI, though
 * the server had already sent it along with the YAML parse position.
 * SHL-43 requires the specific file named, the parse location when the
 * server provides one, and a next action.
 *
 * So the *cause* is named inline when the server told us one, and the
 * technical detail sits behind a disclosure — the same shape
 * `ErrorState` uses for ERR-6, at sidebar scale.
 */
function GroupError({
  collapsed,
  error,
  onRetry,
}: {
  collapsed: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const envelope = error instanceof ApiError ? error.envelope : undefined;
  // A config that will not parse is the user's own edit, and the one
  // failure here they can actually fix. Anything else stays terse.
  const isConfig = envelope?.code === "config_invalid";
  const headline = isConfig ? envelope?.message : undefined;

  if (collapsed) {
    return (
      <div
        role="alert"
        title={headline ?? "Could not load — click to retry"}
        onClick={onRetry}
        className="mx-auto my-1 cursor-pointer text-[11px] text-danger-fg"
      >
        !
      </div>
    );
  }
  return (
    <div role="alert" className="px-2 py-1 text-[12px] text-text-tertiary">
      {headline ?? "Could not load."}{" "}
      <button
        type="button"
        onClick={onRetry}
        className="underline hover:text-text-primary"
      >
        Retry
      </button>
      {isConfig ? (
        <>
          {" · "}
          <span className="text-text-tertiary">
            or run <code className="font-mono">loctt doctor</code>
          </span>
        </>
      ) : null}
      {envelope?.detail !== undefined && (
        <>
          {" "}
          <button
            type="button"
            onClick={() => { setShowDetail(v => !v); }}
            className="underline hover:text-text-primary"
          >
            {showDetail ? "Hide details" : "Show details"}
          </button>
          {showDetail && (
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-text-tertiary">
              {envelope.detail}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A group with nothing in it.
 *
 * ONB-9 and SHL-9 both forbid the group simply vanishing: on an empty
 * tracker a missing Labels group is indistinguishable from a build
 * where labels do not exist, and once entries arrive the group appears
 * and pushes everything below it down. Saying "no labels yet" costs one
 * line and answers both.
 */
function GroupEmpty({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (collapsed) return null;
  return (
    <div className="px-2.5 py-1 text-[12px] italic text-text-tertiary">{children}</div>
  );
}

function ProjectsGroup({ collapsed }: { collapsed: boolean }) {
  const projects = useProjects();
  const activeProjects = useRouterState({
    select: s => (s.location.search as { project?: string[] }).project ?? [],
  });
  const items = (projects.data?.items ?? []).filter(p => p.archived !== true);
  const failed = projects.isError;
  // SHL-5: mark where a new task would land for *this* user, falling
  // back to the workspace default on a server that predates the field.
  // `??` would be wrong here: an explicit `null` means the chain
  // resolved to nothing (several projects, no default anywhere), which
  // is an answer. Only an *absent* field — an older server — falls back
  // to the workspace default.
  const defaultProjectId =
    projects.data === undefined
      ? null
      : "effective_default" in projects.data
        ? (projects.data.effective_default ?? null)
        : (projects.data.default ?? null);
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Projects</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={projects.error} onRetry={() => { void projects.refetch(); }} />
      )}
      {!failed && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No projects yet</GroupEmpty>
      ) : null}
      {items.map(p => {
        const active = activeProjects.includes(p.id);
        return (
          <Link
            key={p.id}
            to="/list"
            // Selecting a project is a single-facet jump (clears other
            // filters, like the built-ins); clicking the already-active
            // project clears it. Multi-project selection lives in the
            // M1.3 filter bar, not the sidebar.
            search={prev =>
              active
                ? clearFilters(prev)
                : { ...clearFilters(prev), project: [p.id] }
            }
            title={p.name}
            className="no-underline"
          >
            <ItemShell active={active} collapsed={collapsed} title={p.name}>
              {/* ProjectDef has no per-project color yet; the mockup
                  uses one shared blue dot for every project. */}
              <ColorDot color="#1E6FCB" />
              {!collapsed ? (
                <>
                  <span className="truncate">{p.name}</span>
                  {p.id === defaultProjectId ? (
                    <span className="text-text-tertiary" title="Default project">★</span>
                  ) : null}
                </>
              ) : null}
            </ItemShell>
          </Link>
        );
      })}
    </div>
  );
}

function SavedFiltersGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const views = useViews();
  const workflow = useWorkflow();
  const priorities = workflow.data?.priorities;
  const ctx = { currentUserId, today, priorities };
  const counts = useBuiltinCounts(BUILTIN_FILTERS, ctx);
  const userViews = views.data?.queries ?? [];
  const failed = views.isError;
  // SHL-32: a pin that vanished from `queries.yaml` is explained
  // rather than silently dropped. Only once the list has actually
  // loaded — a failed or in-flight read is not a deletion.
  const { vanished, dismiss } = useVanishedViews(
    views.isSuccess ? views.data.queries : undefined,
  );

  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Saved filters</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={views.error} onRetry={() => { void views.refetch(); }} />
      )}

      {BUILTIN_FILTERS.map(f => {
        const search = f.resolve(ctx);
        const count = counts[f.id]?.count;
        const countPending = counts[f.id]?.isLoading === true;
        const countUnavailable = counts[f.id]?.unavailable === true;
        // Non-resolvable built-ins (no current user, or deferred
        // "Mentions me") render as inert text, not a link.
        if (search === null) {
          return (
            // SHL-8: says why it is inert and when it arrives, rather
            // than being silently dead. `aria-disabled` carries the
            // state to assistive tech, so the dimming is not the only
            // signal (A11Y-31).
            <div
              key={f.id}
              aria-disabled="true"
              title={inertReason(f.id, f.label)}
              className="opacity-50"
            >
              <ItemShell collapsed={collapsed} title={f.label}>
                <span className="w-4 shrink-0 text-center">{f.icon}</span>
                {!collapsed ? <span className="truncate">{f.label}</span> : null}
              </ItemShell>
            </div>
          );
        }
        return (
          <Link
            key={f.id}
            to="/list"
            search={prev => ({ ...clearFilters(prev), ...search })}
            title={f.label}
            className="no-underline"
          >
            <ItemShell collapsed={collapsed} title={f.label}>
              <span className="w-4 shrink-0 text-center">{f.icon}</span>
              {!collapsed ? (
                <>
                  <span className="truncate">{f.label}</span>
                  <Badge
                    value={count}
                    pending={countPending}
                    unavailable={countUnavailable}
                  />
                </>
              ) : null}
            </ItemShell>
          </Link>
        );
      })}

      {userViews.map(v => (
        <Link
          key={v.id}
          to="/list"
          search={prev => ({ ...prev, view: v.id })}
          title={v.name}
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title={v.name}>
            <span className="w-4 shrink-0 text-center text-text-tertiary">★</span>
            {!collapsed ? <span className="truncate">{v.name}</span> : null}
          </ItemShell>
        </Link>
      ))}

      {!collapsed && vanished.map(v => (
        // Not `role="alert"`: this is an explanation, not an error
        // (SHL-32's last bullet), and a config the user edited
        // themselves must not fire a toast.
        <div
          key={v.id}
          role="status"
          data-vanished-view={v.id}
          className="flex items-start gap-1 px-2.5 py-1 text-[12px] text-text-tertiary"
        >
          <span className="flex-1">
            &ldquo;{v.name}&rdquo; was removed from queries.yaml.
          </span>
          <button
            type="button"
            aria-label={`Dismiss: ${v.name} was removed`}
            onClick={() => { dismiss(v.id); }}
            className="shrink-0 hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      ))}

      {!collapsed ? (
        <button
          type="button"
          disabled
          title="Saved-view editor arrives in a later milestone"
          className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium text-accent hover:bg-bg-muted disabled:cursor-not-allowed disabled:opacity-70"
        >
          <span className="w-4 shrink-0 text-center">+</span>
          New filter…
        </button>
      ) : null}
    </div>
  );
}

function MilestonesGroup({ collapsed }: { collapsed: boolean }) {
  const milestones = useMilestones();
  const items = (milestones.data?.items ?? []).filter(m => m.archived !== true);
  const failed = milestones.isError;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Milestones</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={milestones.error} onRetry={() => { void milestones.refetch(); }} />
      )}
      {!failed && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No milestones yet</GroupEmpty>
      ) : null}
      {items.map(m => (
        <Link
          key={m.id}
          to="/list"
          search={prev => ({ ...prev, milestone: [m.id] })}
          title={m.name}
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title={m.name}>
            <span className="w-4 shrink-0 text-center text-text-tertiary">◇</span>
            {!collapsed ? <span className="truncate">{m.name}</span> : null}
          </ItemShell>
        </Link>
      ))}
    </div>
  );
}

function SprintsGroup({ collapsed }: { collapsed: boolean }) {
  const sprints = useSprints();
  // Match the mockup: hide completed sprints from the sidebar.
  const items = (sprints.data?.items ?? []).filter(
    s => s.archived !== true && s.state !== "completed",
  );
  const failed = sprints.isError;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Sprints</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={sprints.error} onRetry={() => { void sprints.refetch(); }} />
      )}
      {!failed && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No active sprints</GroupEmpty>
      ) : null}
      {items.map(s => (
        <Link
          key={s.id}
          to="/list"
          search={prev => ({ ...prev, sprint: [s.id] })}
          title={`${s.name} (${s.state})`}
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title={`${s.name} (${s.state})`}>
            <ColorDot color={s.state === "active" ? "#1F8A4C" : "var(--text-tertiary)"} />
            {!collapsed ? (
              <>
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-[11px] text-text-tertiary">{s.state}</span>
              </>
            ) : null}
          </ItemShell>
        </Link>
      ))}
    </div>
  );
}

function LabelsGroup({ collapsed }: { collapsed: boolean }) {
  const labels = useLabels();
  const items = (labels.data?.items ?? []).filter(l => l.archived !== true);
  const failed = labels.isError;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Labels</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={labels.error} onRetry={() => { void labels.refetch(); }} />
      )}
      {!failed && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No labels yet</GroupEmpty>
      ) : null}
      {items.map(l => (
        <Link
          key={l.id}
          to="/list"
          search={prev => ({ ...prev, labels: [l.id] })}
          title={l.name}
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title={l.name}>
            <ColorDot color={l.color} />
            {!collapsed ? <span className="truncate">{l.name}</span> : null}
          </ItemShell>
        </Link>
      ))}
    </div>
  );
}

function RecentsGroup({ collapsed }: { collapsed: boolean }) {
  const recents = useRecents();
  const items = recents.data?.items ?? [];
  const failed = recents.isError;
  if (collapsed) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Recently viewed</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={recents.error} onRetry={() => { void recents.refetch(); }} />
      )}
      {/* `!failed` matters: on a failed fetch `items` is empty too, and
          rendering the empty copy beside the alert makes two
          contradictory claims about the same data (ERR-1, ONB-34). */}
      {!failed && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>
          No recent tasks — this fills in as you open them
        </GroupEmpty>
      ) : (
        items.map(t => (
          <Link
            key={t.key}
            to="/tasks/$key"
            params={{ key: t.key }}
            title={t.title}
            className="no-underline"
          >
            <ItemShell collapsed={collapsed} title={t.title}>
              <span className="shrink-0 font-mono text-[10px] text-text-tertiary">{t.key}</span>
              <span className="truncate">{t.title}</span>
            </ItemShell>
          </Link>
        ))
      )}
    </div>
  );
}

function Footer({ collapsed, info }: { collapsed: boolean; info: TrackerInfoResponse }) {
  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border-subtle pt-2">
      {!collapsed ? (
        <div className="px-2.5 text-[11px] text-text-tertiary">
          <div className="truncate font-mono" title={info.cwd}>{info.cwd}</div>
          <div className="mt-0.5">
            {info.taskCount} task{info.taskCount === 1 ? "" : "s"}
            {info.nextKey ? ` · next ${info.nextKey}` : ""}
          </div>
        </div>
      ) : null}
      <Link to="/settings/$section" params={{ section: "general" }} title="Settings" className="no-underline">
        <ItemShell collapsed={collapsed} title="Settings">
          <SettingsIcon />
          {!collapsed ? <span>Settings</span> : null}
        </ItemShell>
      </Link>
    </div>
  );
}

/**
 * Why a built-in is inert.
 *
 * SHL-8 requires the row to say why it cannot be used and when it
 * arrives. One message for every null resolution was wrong once
 * VUE-24 gave a *second* reason to be inert: a workspace whose
 * priority scale cannot express "high" is not waiting for comments,
 * and telling it so is a false promise.
 */
function inertReason(id: string, label: string): string {
  if (id === "mentions-me") return `${label} — available once comments land (M2)`;
  if (id === "high-priority") {
    return `${label} — this workspace's priorities don't distinguish a high one`;
  }
  return `${label} — not available yet`;
}

/**
 * The filter-bearing search keys. Applying a built-in clears all of
 * these before layering its own state on top, so clicking "Overdue"
 * doesn't inherit a previously-applied "High priority" query. Sort /
 * pagination / other params are preserved.
 */
const FILTER_KEYS = [
  "q", "project", "status", "priority", "type", "assignee",
  "reporter", "labels", "milestone", "sprint", "view",
] as const;

function clearFilters(prev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (!(FILTER_KEYS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

/* ---------- icons ---------- */

function ListIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>;
}
function BoardIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="10" y="3" width="6" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></svg>;
}
function TimelineIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M3 6h12M3 12h18M3 18h8" /></svg>;
}
function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z" /></svg>;
}
