import type { TrackerInfoResponse } from "@loctt/contracts";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  useLabels,
  useMilestones,
  useProjects,
  useRecents,
  useSprints,
  useViews,
} from "../api/hooks/sidebarData.ts";
import { useBuiltinCounts } from "../api/hooks/useBuiltinCounts.ts";
import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";

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
        "row-start-2 flex flex-col gap-4 overflow-y-auto border-r border-border-subtle bg-bg-surface py-3",
        "transition-[width] duration-150 ease-out",
        collapsed ? "w-14 px-2" : "w-60 px-2",
      ].join(" ")}
      data-collapsed={collapsed}
    >
      <ViewSwitcher collapsed={collapsed} />
      <ProjectsGroup collapsed={collapsed} />
      <SavedFiltersGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />
      <MilestonesGroup collapsed={collapsed} />
      <SprintsGroup collapsed={collapsed} />
      <LabelsGroup collapsed={collapsed} />
      <RecentsGroup collapsed={collapsed} />
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
      title={collapsed ? title : undefined}
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

function Badge({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <span className="ml-auto rounded-full bg-bg-muted px-1.5 text-[11px] tabular-nums text-text-tertiary">
      {value}
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
        <Link key={v.to} to={v.to} className="no-underline">
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
 */
function GroupError({ collapsed, onRetry }: { collapsed: boolean; onRetry: () => void }) {
  if (collapsed) {
    return (
      <div
        role="alert"
        title="Could not load — click to retry"
        onClick={onRetry}
        className="mx-auto my-1 cursor-pointer text-[11px] text-danger-fg"
      >
        !
      </div>
    );
  }
  return (
    <div role="alert" className="px-2 py-1 text-[12px] text-text-tertiary">
      Could not load.{" "}
      <button
        type="button"
        onClick={onRetry}
        className="underline hover:text-text-primary"
      >
        Retry
      </button>
    </div>
  );
}

function ProjectsGroup({ collapsed }: { collapsed: boolean }) {
  const projects = useProjects();
  const activeProjects = useRouterState({
    select: s => (s.location.search as { project?: string[] }).project ?? [],
  });
  const items = (projects.data?.items ?? []).filter(p => p.archived !== true);
  const failed = projects.isError;
  const defaultProjectId = projects.data?.default ?? null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Projects</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} onRetry={() => { void projects.refetch(); }} />
      )}
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
  const counts = useBuiltinCounts(BUILTIN_FILTERS, { currentUserId, today });
  const userViews = views.data?.queries ?? [];
  const failed = views.isError;

  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Saved filters</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} onRetry={() => { void views.refetch(); }} />
      )}

      {BUILTIN_FILTERS.map(f => {
        const search = f.resolve({ currentUserId, today });
        const count = counts[f.id]?.count;
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
              title={`${f.label} — available once comments land (M2)`}
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
            className="no-underline"
          >
            <ItemShell collapsed={collapsed} title={f.label}>
              <span className="w-4 shrink-0 text-center">{f.icon}</span>
              {!collapsed ? (
                <>
                  <span className="truncate">{f.label}</span>
                  <Badge value={count} />
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
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title={v.name}>
            <span className="w-4 shrink-0 text-center text-text-tertiary">★</span>
            {!collapsed ? <span className="truncate">{v.name}</span> : null}
          </ItemShell>
        </Link>
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
  // A failed fetch must not make the group vanish — that is the
  // same conflation as rendering it empty (ERR-1).
  if (items.length === 0 && !failed) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Milestones</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} onRetry={() => { void milestones.refetch(); }} />
      )}
      {items.map(m => (
        <Link
          key={m.id}
          to="/list"
          search={prev => ({ ...prev, milestone: [m.id] })}
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
  // A failed fetch must not make the group vanish — that is the
  // same conflation as rendering it empty (ERR-1).
  if (items.length === 0 && !failed) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Sprints</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} onRetry={() => { void sprints.refetch(); }} />
      )}
      {items.map(s => (
        <Link
          key={s.id}
          to="/list"
          search={prev => ({ ...prev, sprint: [s.id] })}
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
  // A failed fetch must not make the group vanish — that is the
  // same conflation as rendering it empty (ERR-1).
  if (items.length === 0 && !failed) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Labels</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} onRetry={() => { void labels.refetch(); }} />
      )}
      {items.map(l => (
        <Link
          key={l.id}
          to="/list"
          search={prev => ({ ...prev, labels: [l.id] })}
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
        <GroupError collapsed={collapsed} onRetry={() => { void recents.refetch(); }} />
      )}
      {items.length === 0 ? (
        <div className="px-2.5 py-1 text-[12px] italic text-text-tertiary">No recent tasks</div>
      ) : (
        items.map(t => (
          <Link
            key={t.key}
            to="/tasks/$key"
            params={{ key: t.key }}
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
    <div className="mt-auto flex flex-col gap-1 border-t border-border-subtle pt-2">
      {!collapsed ? (
        <div className="px-2.5 text-[11px] text-text-tertiary">
          <div className="truncate font-mono" title={info.cwd}>{info.cwd}</div>
          <div className="mt-0.5">
            {info.taskCount} task{info.taskCount === 1 ? "" : "s"}
            {info.nextKey ? ` · next ${info.nextKey}` : ""}
          </div>
        </div>
      ) : null}
      <Link to="/settings/$section" params={{ section: "general" }} className="no-underline">
        <ItemShell collapsed={collapsed} title="Settings">
          <SettingsIcon />
          {!collapsed ? <span>Settings</span> : null}
        </ItemShell>
      </Link>
    </div>
  );
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
