import type { SidebarGroupId, TrackerInfoResponse } from "@loctt/contracts";
import { SIDEBAR_FILTER_IDS, SIDEBAR_GROUP_IDS } from "@loctt/contracts";
import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";

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
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { RegionErrorBoundary } from "../error/RegionErrorBoundary.tsx";
import { readSidebarGroups, resolveSidebarOrder } from "../settings/sidebarGroups.ts";
import { readSidebarPins } from "../settings/sidebarPins.ts";
import { ViewFormDialog } from "../settings/ViewFormDialog.tsx";
import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";
import { Chip } from "../ui/Chip.tsx";
import { ICON } from "../ui/icons.ts";
import { TextField } from "../ui/TextField.tsx";
import { requestSidebarCollapse } from "./useSidebarCollapse.ts";
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
/** Below this the sidebar behaves as a mobile overlay (mirrors `NARROW_PX`). */
const NARROW_PX = 900;

/**
 * Tracks whether the viewport is narrow enough for the sidebar to act as
 * a dismissible overlay (R2).
 *
 * `useSidebarCollapse` owns the same breakpoint, but it lives above the
 * router and only hands `Sidebar` the resolved `collapsed` flag. Rather
 * than widen that prop contract through `AppShell` (a file this lane does
 * not own), `Sidebar` reads the viewport itself — it only needs to know
 * *how* to render the expanded state (in-grid column vs. floating
 * overlay), and the hook already decides *whether* it is expanded.
 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < NARROW_PX,
  );
  useEffect(() => {
    const onResize = (): void => {
      setNarrow(window.innerWidth < NARROW_PX);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

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
  const narrow = useIsNarrow();
  // R2: on a narrow viewport an *expanded* sidebar is a temporary
  // overlay, not the in-grid column. It floats over the main pane so it
  // does not steal layout width, and a backdrop behind it makes the rest
  // of the screen a tap-away dismiss target.
  const overlay = narrow && !collapsed;
  // A navigation dismisses the mobile overlay (following a link should
  // reveal the destination, not leave the drawer covering it). Watched
  // here because `Sidebar` is inside the router; the collapse itself is
  // performed by the hook, which listens for `requestSidebarCollapse`.
  const pathname = useRouterState({ select: s => s.location.pathname });
  const firstRoute = useRef(true);
  useEffect(() => {
    // Skip the initial mount — only an actual route *change* dismisses,
    // so opening the drawer (which does not change the path) never
    // closes itself, and the first render does not fire a spurious
    // collapse. `overlay` is read, not depended on, deliberately: the
    // trigger is the navigation, and re-running when the overlay toggles
    // would close it the instant it opened.
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    requestSidebarCollapse();
  }, [pathname]);

  return (
    <>
      {/* R2 backdrop: only while the overlay is open. A tap anywhere off
          the panel dismisses it (tap-away), and it dims the content
          behind so the drawer reads as a temporary layer. */}
      {overlay ? (
        <div
          data-testid="sidebar-overlay-backdrop"
          aria-hidden="true"
          onClick={() => { requestSidebarCollapse(); }}
          className="fixed inset-0 z-30 bg-black/40"
        />
      ) : null}
      <aside
        className={[
          "row-start-2 flex min-h-0 flex-col border-r border-border-subtle bg-bg-surface py-3",
          "transition-[width] duration-150 ease-out",
          collapsed ? "w-14 px-2" : "w-60 px-2",
          // While overlaying, float the expanded panel above the main
          // pane (fixed, full-height, z above the backdrop) instead of
          // widening the grid column.
          overlay ? "fixed bottom-0 left-0 top-0 z-40 shadow-lg" : "",
        ].join(" ")}
        data-collapsed={collapsed}
        data-overlay={overlay ? "true" : undefined}
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
            sidebar, the header and the main pane keep working.

            SHL-45: the groups render in the user's chosen order, and a
            group the user hid is not rendered at all. `resolveSidebarOrder`
            turns the (tolerant) `sidebar_groups` setting into the ordered,
            hide-annotated list; an absent setting yields the default order
            with everything visible. */}
        <SidebarGroups
          collapsed={collapsed}
          currentUserId={currentUserId}
          today={today}
        />
      </div>
      <Footer collapsed={collapsed} info={info} />
      </aside>
    </>
  );
}

/**
 * The ordered, visibility-filtered set of sidebar groups (SHL-45).
 *
 * Reads the per-user `sidebar_groups` setting, resolves it against the
 * built-in group catalog, and renders each visible group in order, each
 * wrapped in its own error boundary (ERR-34). A hidden group is not
 * rendered — a deliberate choice, distinct from the SHL-9 "empty
 * affordance" a group with no *entries* shows.
 *
 * While the setting is still loading (or if it failed), we fall back to
 * the default order with everything visible rather than blanking the
 * sidebar: the customization is a preference, and its absence must never
 * make navigation disappear (P7).
 */
const GROUP_REGION: Record<SidebarGroupId, string> = {
  views: "the view switcher",
  projects: "the projects list",
  "saved-filters": "the saved filters",
  milestones: "the milestones list",
  sprints: "the sprints list",
  labels: "the labels list",
  recents: "recently viewed",
};

function SidebarGroups({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const settings = useUserSettings();
  // A failed / in-flight settings read is not a customization — fall
  // back to the default (every group, default order, all visible).
  const groups = readSidebarGroups(settings.data?.settings);
  const resolved = resolveSidebarOrder(groups, [...SIDEBAR_GROUP_IDS]);
  // Resolved against the group-only catalog, so every id is a group id;
  // the guard narrows `SidebarItemId` to `SidebarGroupId` for TS.
  const isGroupId = (id: string): id is SidebarGroupId =>
    (SIDEBAR_GROUP_IDS as readonly string[]).includes(id);

  const render = (id: SidebarGroupId): ReactNode => {
    switch (id) {
      case "views":
        return <ViewSwitcher collapsed={collapsed} />;
      case "projects":
        return <ProjectsGroup collapsed={collapsed} />;
      case "saved-filters":
        return (
          <SavedFiltersGroup
            collapsed={collapsed}
            currentUserId={currentUserId}
            today={today}
          />
        );
      case "milestones":
        return <MilestonesGroup collapsed={collapsed} />;
      case "sprints":
        return <SprintsGroup collapsed={collapsed} />;
      case "labels":
        return <LabelsGroup collapsed={collapsed} />;
      case "recents":
        return <RecentsGroup collapsed={collapsed} />;
    }
  };

  return (
    <>
      {resolved.map(item =>
        item.hidden || !isGroupId(item.id) ? null : (
          <RegionErrorBoundary key={item.id} region={GROUP_REGION[item.id]}>
            {render(item.id)}
          </RegionErrorBoundary>
        ),
      )}
    </>
  );
}

/* ---------- shared item primitives ---------- */


/**
 * Whether this query's last settled answer was a failure.
 *
 * **Not `isError`.** `fetchState` resets a data-less query to
 * `status: "pending", error: null` on every fetch, so `isError` is
 * false for the whole duration of a retry — and a group keyed on it
 * falls through to its empty state while the request is in flight.
 *
 * The M1 round-6 gate measured the result: pressing "Try now" with the
 * server down showed "No projects yet / No labels yet / No milestones
 * yet" for about a second, in all five groups at once. A user with a
 * populated tracker was told it was empty.
 *
 * `errorUpdatedAt` and `dataUpdatedAt` survive the reset, so they can
 * answer what the query has *ever* done rather than what it is doing
 * this instant. This is the fifth bug traced to that one trap; see
 * known-gaps.md.
 */
function hasFailed(q: {
  isError: boolean;
  errorUpdatedAt: number;
  dataUpdatedAt: number;
}): boolean {
  if (q.isError) return true;
  // Errored at some point and never since answered: still failed, even
  // while a retry has it reading as "pending".
  return q.errorUpdatedAt > 0 && q.errorUpdatedAt >= q.dataUpdatedAt;
}

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
      // A11Y-30's fourth bullet: the active route must be marked by
      // more than a colour change. `bg-accent-muted text-accent` is
      // exactly and only colour, so in greyscale — or to a screen
      // reader — the current entry was indistinguishable from the
      // rest. `aria-current="page"` is the assistive-tech half the
      // bullet names; the `font-semibold` below is the visual half,
      // so the distinction survives a greyscale screenshot too.
      aria-current={active === true ? "page" : undefined}
      // The tooltip lives on the enclosing <a> so keyboard focus
      // surfaces it too (SHL-19, SHL-22); repeating it here would nest
      // two tooltips on the same target. Kept for the non-link rows —
      // the deferred "Mentions me" and the collapsed icons — which have
      // no anchor of their own.
      title={title}
      className={[
        "flex h-8 items-center rounded-md text-[13px]",
        collapsed ? "w-10 justify-center px-0" : "gap-2.5 px-2.5",
        active
          ? "bg-accent-muted font-semibold text-accent"
          : "font-medium text-text-secondary hover:bg-bg-muted hover:text-text-primary",
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
/**
 * Whether the server has ever answered this query.
 *
 * The companion to `hasFailed`, and the same idea: ask what the query
 * has *ever* done, never what it is doing right now.
 *
 * A group whose empty state is gated only on `items.length === 0`
 * claims "No projects yet" from its very first render — before
 * anything has been asked, let alone answered. Measured: ~24ms on a
 * healthy cold load, and **a full second** (1089–2098ms) on a cold
 * load against a dead server, sitting under the unreachable banner
 * while it says the tracker is empty.
 *
 * `hasFailed` cannot cover that window, and honestly so: nothing has
 * failed yet. Nothing has *settled* yet. That is a third state, and
 * P6 says empty, loading, partial and broken are four designed states
 * rather than one — so "we have not asked" must not render as "there
 * is nothing".
 *
 * `dataUpdatedAt` survives `fetchState`'s reset, exactly as
 * `errorUpdatedAt` does.
 */
function hasAnswered(q: { dataUpdatedAt: number }): boolean {
  return q.dataUpdatedAt > 0;
}

function GroupEmpty({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (collapsed) return null;
  return (
    <div className="px-2.5 py-1 text-[12px] italic text-text-tertiary">{children}</div>
  );
}

/**
 * Above this many projects the group becomes searchable (PRU-21): a
 * type-to-filter box, rather than an unbounded scrolling list.
 */
const PROJECT_SEARCH_THRESHOLD = 8;

/**
 * When not searching, at most this many project rows show at once; the
 * rest collapse behind a "+N more" toggle (PRU-21) so a 30-project
 * tracker does not push Milestones, Sprints and Labels off-screen.
 */
const PROJECT_COLLAPSE_LIMIT = 8;

function ProjectsGroup({ collapsed }: { collapsed: boolean }) {
  const projects = useProjects();
  const activeProjects = useRouterState({
    select: s => (s.location.search as { project?: string[] }).project ?? [],
  });
  const items = (projects.data?.items ?? []).filter(p => p.archived !== true);
  const failed = hasFailed(projects);
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

  // PRU-21: type-to-filter and expand state. Both are UI-local — they
  // do not touch the URL, so a filtered switcher never changes what
  // the list is scoped to until a project is actually clicked.
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  // The searchable affordance appears only past the threshold, and
  // never while the sidebar is collapsed to icons (there is no room to
  // type). Below the threshold the old flat list is unchanged.
  const searchable = !collapsed && items.length > PROJECT_SEARCH_THRESHOLD;

  const q = query.trim().toLowerCase();
  const filtered = q === ""
    ? items
    // Filter on both the display name and the key prefix (PRU-21) — a
    // user who thinks in `WEB-` should find Web by typing "web".
    : items.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.prefix.toLowerCase().includes(q),
      );

  // While searching, every match shows (the whole point of the box).
  // Otherwise the list truncates unless the user expanded it.
  const truncate = !searchable || q === "";
  const visible = truncate && !expanded
    ? filtered.slice(0, PROJECT_COLLAPSE_LIMIT)
    : filtered;
  const hiddenCount = filtered.length - visible.length;

  // "All projects" is active exactly when nothing is scoped. Pinned
  // above the (scrollable) list and the search box so it is always
  // reachable without scrolling (PRU-21).
  const allActive = activeProjects.length === 0;

  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Projects</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={projects.error} onRetry={() => { void projects.refetch(); }} />
      )}
      {!failed && hasAnswered(projects) && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No projects yet</GroupEmpty>
      ) : null}

      {!failed && items.length > 0 ? (
        <Link
          to="/list"
          data-testid="project-all"
          // Clears the project facet (and only it — the other filters
          // are left alone, matching a project click). The ambient sort
          // is dropped too (LST-55).
          search={prev => {
            const { project: _drop, ...rest } = prev as { project?: unknown };
            return clearSort(rest);
          }}
          title="All projects"
          className="no-underline"
        >
          <ItemShell active={allActive} collapsed={collapsed} title="All projects">
            <ColorDot color="var(--text-tertiary)" />
            {!collapsed ? <span className="truncate">All projects</span> : null}
          </ItemShell>
        </Link>
      ) : null}

      {searchable ? (
        <TextField
          type="search"
          size="sm"
          value={query}
          onChange={e => { setQuery(e.target.value); }}
          placeholder="Filter projects…"
          aria-label="Filter projects"
          data-testid="project-search"
          className="mx-2.5 mb-0.5"
        />
      ) : null}

      {searchable && q !== "" && filtered.length === 0 ? (
        <div
          data-testid="project-search-empty"
          className="px-2.5 py-1 text-[12px] text-text-tertiary"
        >
          No projects match “{query.trim()}”
        </div>
      ) : null}

      {visible.map(p => {
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
                ? clearSort(clearFilters(prev))
                : { ...clearSort(clearFilters(prev)), project: [p.id] }
            }
            title={p.name}
            className="no-underline"
          >
            <ItemShell active={active} collapsed={collapsed} title={p.name}>
              {/* ProjectDef has no per-project color yet; the mockup
                  uses one shared blue dot for every project. Uses the
                  status-active token (the app's blue) so it tracks the
                  theme instead of a hardcoded hex (S-11). */}
              <ColorDot color="var(--status-active-fg)" />
              {!collapsed ? (
                <>
                  <span className="truncate">{p.name}</span>
                  {p.id === defaultProjectId ? (
                    <span className="text-text-tertiary" title="Default project">{ICON.star}</span>
                  ) : null}
                </>
              ) : null}
            </ItemShell>
          </Link>
        );
      })}

      {!collapsed && hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => { setExpanded(true); }}
          data-testid="project-more"
          className="mx-2.5 rounded-md px-0 py-1 text-left text-[12px] font-medium text-text-tertiary hover:text-text-primary"
        >
          +{hiddenCount} more
        </button>
      ) : null}
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
  // SET-13: pinned views lead the group, in the user's stored pin
  // order; everything else follows in config order. A pin whose view
  // is gone contributes nothing here — it has no row to render — and
  // the pins panel is what tells the user it went.
  const settings = useUserSettings();
  const pins = readSidebarPins(settings.data?.settings);
  // SHL-45: the built-in filters can be hidden/reordered by the same
  // per-user setting. `resolveSidebarOrder` against the filter catalog
  // gives their order + hidden flags; a hidden filter renders nothing.
  const filterOrder = resolveSidebarOrder(
    readSidebarGroups(settings.data?.settings),
    [...SIDEBAR_FILTER_IDS],
  );
  const filterById = new Map(BUILTIN_FILTERS.map(f => [f.id, f]));
  const orderedFilters = filterOrder
    .filter(f => !f.hidden)
    .flatMap(f => {
      const def = filterById.get(f.id);
      return def === undefined ? [] : [def];
    });
  // The create-view dialog (VUE-40): the "+ New filter" entry point.
  // Opens `ViewFormDialog` in create mode — the same dialog the Saved-
  // views settings panel uses, with the reused AdvancedQueryEditor — so
  // the user can type a query. The old wiring opened `SaveViewDialog`
  // with `search={}`, whose read-only DSL was always `archived != true`,
  // silently making every sidebar-created view "all open tasks".
  const [creating, setCreating] = useState(false);
  const allViews = views.data?.queries ?? [];
  const userViews = orderByPins(allViews, pins);
  // VUE-22: views present in queries.yaml whose query no longer parses.
  // Listed, marked broken, still clickable — the list route answers a
  // broken view with the parse error and its position, not an empty
  // table. One bad row never blanks the group (north-star principle 5).
  const brokenViews = views.data?.broken ?? [];
  const failed = hasFailed(views);
  // SHL-32: a pin that vanished from `queries.yaml` is explained
  // rather than silently dropped. Only once the list has actually
  // loaded — a failed or in-flight read is not a deletion.
  // A broken view is still in queries.yaml — it has just moved from
  // `queries` to `broken`. Feed both to the vanished-view tracker so a
  // view that broke is not also reported as *removed* (SHL-32): it
  // already has its own "(broken)" row above, and the two signals would
  // contradict each other.
  const { vanished, dismiss } = useVanishedViews(
    views.isSuccess ? [...views.data.queries, ...(views.data.broken ?? [])] : undefined,
  );

  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Saved filters</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={views.error} onRetry={() => { void views.refetch(); }} />
      )}

      {orderedFilters.map(f => {
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
            search={prev => ({ ...clearSort(clearFilters(prev)), ...search })}
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
          search={prev => ({ ...clearSort(prev), view: v.id })}
          title={v.name}
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title={v.name}>
            <span className="w-4 shrink-0 text-center text-text-tertiary">{ICON.star}</span>
            {!collapsed ? <span className="truncate">{v.name}</span> : null}
          </ItemShell>
        </Link>
      ))}

      {brokenViews.map(v => (
        // VUE-22: still a link — clicking shows the parse error with its
        // position and opens the editor pre-populated, "rather than an
        // empty list". Marked broken so it is not mistaken for a healthy
        // view, and titled with the parser's message for a quick read.
        <Link
          key={v.id}
          to="/list"
          search={prev => ({ ...clearSort(prev), view: v.id })}
          title={`${v.name} — broken: ${v.error}`}
          className="no-underline"
          data-broken-view={v.id}
        >
          <ItemShell collapsed={collapsed} title={v.name}>
            <span
              aria-hidden="true"
              className="w-4 shrink-0 text-center text-danger-fg"
            >
              ⚠
            </span>
            {!collapsed ? (
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="truncate text-text-secondary">{v.name}</span>
                <span className="shrink-0 text-[11px] text-text-tertiary">(broken)</span>
              </span>
            ) : null}
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
          data-testid="sidebar-new-filter"
          onClick={() => { setCreating(true); }}
          title="Create a saved view"
          className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] font-medium text-accent hover:bg-bg-muted"
        >
          <span className="w-4 shrink-0 text-center">+</span>
          New filter…
        </button>
      ) : null}

      {creating ? (
        // Create mode: empty name + query with the advanced query editor,
        // so a view created from the sidebar carries a typed query (VUE-40)
        // rather than the fixed `archived != true` of the old dialog.
        <ViewFormDialog onClose={() => { setCreating(false); }} />
      ) : null}
    </div>
  );
}

/**
 * Pinned views first in pin order, then the rest in config order.
 *
 * Pins that name a missing view are skipped rather than rendered as
 * broken entries — SET-13's third bullet and P7's "the sidebar
 * crashing because a pinned view was removed" violation.
 */
function orderByPins<T extends { id: string }>(
  views: readonly T[],
  pins: readonly string[],
): readonly T[] {
  if (pins.length === 0) return views;
  const byId = new Map(views.map(v => [v.id, v]));
  const pinned = pins.flatMap(id => {
    const v = byId.get(id);
    return v === undefined ? [] : [v];
  });
  const pinnedIds = new Set(pinned.map(v => v.id));
  return [...pinned, ...views.filter(v => !pinnedIds.has(v.id))];
}

function MilestonesGroup({ collapsed }: { collapsed: boolean }) {
  const milestones = useMilestones();
  const items = (milestones.data?.items ?? []).filter(m => m.archived !== true);
  const failed = hasFailed(milestones);
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Milestones</GroupLabel>
      {/* M4.9: the group's entries filter the list to one milestone;
          this opens the milestones *progress* view, which is a
          different surface and otherwise reachable only by URL. */}
      {!collapsed && (
        <Link to="/milestones" data-testid="sidebar-milestones-link" className="no-underline">
          <ItemShell collapsed={collapsed} title="All milestones">
            <span className="w-4 shrink-0 text-center text-text-tertiary">◈</span>
            <span className="truncate">All milestones</span>
          </ItemShell>
        </Link>
      )}
      {failed && (
        <GroupError collapsed={collapsed} error={milestones.error} onRetry={() => { void milestones.refetch(); }} />
      )}
      {!failed && hasAnswered(milestones) && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No milestones yet</GroupEmpty>
      ) : null}
      {items.map(m => (
        <Link
          key={m.id}
          to="/list"
          search={prev => ({ ...clearSort(prev), milestone: [m.id] })}
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
  const failed = hasFailed(sprints);
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Sprints</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={sprints.error} onRetry={() => { void sprints.refetch(); }} />
      )}
      {!failed && hasAnswered(sprints) && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No active sprints</GroupEmpty>
      ) : null}
      {items.map(s => (
        <Link
          key={s.id}
          to="/list"
          search={prev => ({ ...clearSort(prev), sprint: [s.id] })}
          title={`${s.name} (${s.state})`}
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title={`${s.name} (${s.state})`}>
            <ColorDot color={s.state === "active" ? "var(--feedback-success-fg)" : "var(--text-tertiary)"} />
            {!collapsed ? (
              <>
                <span className="truncate">{s.name}</span>
                {/* The sprint's lifecycle state as a plain meta pill —
                    migrated to the B1 Chip so it shares the app's one
                    pill shape/height (K-6). */}
                <span className="ml-auto">
                  <Chip variant="neutral">{s.state}</Chip>
                </span>
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
  const failed = hasFailed(labels);
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Labels</GroupLabel>
      {failed && (
        <GroupError collapsed={collapsed} error={labels.error} onRetry={() => { void labels.refetch(); }} />
      )}
      {!failed && hasAnswered(labels) && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No labels yet</GroupEmpty>
      ) : null}
      {items.map(l => (
        <Link
          key={l.id}
          to="/list"
          search={prev => ({ ...clearSort(prev), labels: [l.id] })}
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
  const failed = hasFailed(recents);
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
      {!failed && hasAnswered(recents) && items.length === 0 ? (
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
          {/* The count is omitted rather than shown as zero when the
              tracker could not be read. `TrackerInfoResponse.taskCount`
              is a number, so the placeholder the shell falls back to
              during an outage has to say *something* — and "0 tasks"
              in front of a user with two is a claim about their data,
              not a missing value. ERR-1's rule, at footer scale: a
              server that is down and a tracker that is empty must not
              look alike.
              `cwd === ""` is that placeholder's signature. */}
          <div className="mt-0.5">
            {info.cwd === "" ? (
              <span className="italic">task count unavailable</span>
            ) : (
              <>
                {info.taskCount} task{info.taskCount === 1 ? "" : "s"}
                {info.nextKey ? ` · next ${info.nextKey}` : ""}
              </>
            )}
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
 * doesn't inherit a previously-applied "High priority" query.
 * Pagination / other params are preserved; the ambient sort is dropped
 * separately by `clearSort` (LST-55).
 */
const FILTER_KEYS = [
  "q", "project", "status", "priority", "type", "assignee",
  "reporter", "labels", "milestone", "sprint", "view",
] as const;

/**
 * The sort keys carried in the URL. Stripped from every sidebar
 * navigation target (LST-55 / UX-3).
 */
const SORT_KEYS = ["sort", "dir"] as const;

function clearFilters(prev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (!(FILTER_KEYS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

/**
 * Drop the ambient sort from a navigation target (LST-55 / UX-3).
 *
 * A sidebar link is a jump to a *destination* — a project, a saved
 * filter, a milestone — not a re-sort of the current table. Carrying the
 * URL's `sort`/`dir` into it meant a saved "Blocked" filter opened
 * Low-first only because the user happened to be sorting ascending when
 * they clicked, and a saved view's own configured order was overridden
 * by whatever the last table was sorted by. The destination is left to
 * render in its natural / configured order; the user re-sorts there if
 * they want to.
 */
function clearSort(prev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (!(SORT_KEYS as readonly string[]).includes(k)) out[k] = v;
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
