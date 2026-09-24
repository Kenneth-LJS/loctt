import type { EntityColor, LabelDef, MilestoneDef, ProjectDef, SidebarGroupId, SprintDef, UserSettings } from "@loctt/contracts";
import { SIDEBAR_FILTER_IDS, SIDEBAR_GROUP_IDS } from "@loctt/contracts";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { createContext, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";

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
import { useArchiveLabel, useArchiveMilestone } from "../api/hooks/useDataMutations.ts";
import { useDeleteView } from "../api/hooks/useDeleteView.ts";
import { useArchiveProject, useSetDefaultProject } from "../api/hooks/useProjectMutations.ts";
import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { RegionErrorBoundary } from "../error/RegionErrorBoundary.tsx";
import { CreateProjectDialog } from "../settings/CreateProjectDialog.tsx";
import { DeleteViewDialog } from "../settings/DeleteViewDialog.tsx";
import { LabelEditDialog } from "../settings/LabelEditDialog.tsx";
import { MilestoneEditDialog } from "../settings/MilestoneEditDialog.tsx";
import { ProjectEditDialog } from "../settings/ProjectEditDialog.tsx";
import { RowActions } from "../settings/RowActions.tsx";
import { DEFAULT_SECTION } from "../settings/sections.ts";
import { readSidebarGroups, resolveGroupedSidebarOrder, resolveSidebarOrder } from "../settings/sidebarGroups.ts";
import { SidebarGroupsPanel } from "../settings/SidebarGroupsPanel.tsx";
import { readSidebarPins } from "../settings/sidebarPins.ts";
import { SprintEditDialog } from "../settings/SprintEditDialog.tsx";
import { type BrokenViewContext, ViewFormDialog, type ViewFormTarget } from "../settings/ViewFormDialog.tsx";
import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";
import { Chip } from "../ui/Chip.tsx";
import { useResolvedColor } from "../ui/entityColor.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { IconGlyph } from "../ui/IconEmojiPicker.tsx";
import { dataStateOf } from "../ui/InlineFailureNotice.tsx";
import { useInertBackground } from "../ui/Modal.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextField } from "../ui/TextField.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";
import { requestSidebarCollapse } from "./useSidebarCollapse.ts";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STEP,
  useSidebarWidth,
} from "./useSidebarWidth.ts";
import { useVanishedViews } from "./useVanishedViews.ts";

/**
 * The app's left sidebar. Renders, top to bottom: the view switcher
 * (List / Board / Timeline), then data-driven groups — Projects, Saved
 * filters (built-ins + user views + New filter), Milestones, Sprints,
 * Labels, Recently viewed — and a footer with a "Customize sidebar"
 * affordance and a Settings link.
 *
 * The footer USED to show the tracker's working directory; `cc534a0d`
 * removed it (and `f85e5a7e` the task count) as data a user never acts
 * on. Telling two `loctt ui` windows apart (SHL-11 / SHL-31) is the
 * document title's job instead — see `useRouteAnnouncement.ts`. Nothing
 * on the page carries it, deliberately.
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
  currentUserId,
  today,
}: {
  readonly collapsed: boolean;
  readonly currentUserId: string | null;
  readonly today: string;
}) {
  const narrow = useIsNarrow();
  // R2: on a narrow viewport an *expanded* sidebar is a temporary
  // overlay, not the in-grid column. It floats over the main pane so it
  // does not steal layout width, and a backdrop behind it makes the rest
  // of the screen a tap-away dismiss target.
  const overlay = narrow && !collapsed;
  // The drag-to-resize width applies ONLY to the expanded, in-grid,
  // desktop column (not the collapsed rail, not the mobile overlay). The
  // hook is called unconditionally (rules of hooks); its value is only
  // read when that state is active.
  const { width, setWidth } = useSidebarWidth();
  // True while a pointer drag is in progress, so the width transition is
  // suppressed (otherwise the width would animate toward each pointer
  // position and the drag would lag). Collapse/expand still animates.
  const [dragging, setDragging] = useState(false);
  const inGridExpanded = !collapsed && !overlay;
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

  // The scrolling groups + footer, shared by the in-grid column and the
  // mobile overlay drawer.
  const body = (
    <>
      {/* The groups scroll; the footer does not.
          SHL-11 requires the workspace label and Settings to stay
          pinned "and not scroll away with the groups", and SHL-20/21
          put enough entries above them (20 recents, 30 projects, 40
          labels) to make that the normal case rather than the extreme
          one. Scrolling the whole column satisfies "reachable" and
          fails "pinned". */}
      {/* `overflow-y-auto` also clips the X axis, so the global
          `:focus-visible` ring (outline + 2px OUTWARD offset) on a
          full-width row was clipped at the sidebar's left/right edges
          (Ken's report). Draw the ring INSET for focusable rows inside the
          scroll area so it sits within the row box instead of past it —
          one rule for every row, not a per-row override. */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [&_a:focus-visible]:[outline-offset:-2px] [&_button:focus-visible]:[outline-offset:-2px]"
        data-sidebar-scroll="true"
      >
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
      <Footer collapsed={collapsed} overlay={overlay} />
    </>
  );

  // R2 (mobile): the expanded sidebar is a proper modal drawer, not a
  // bare floating <aside>. It is a `role="dialog"` with a scrim, a close
  // button, a focus trap and Escape-to-close (reusing the same a11y
  // machinery Modal/Sheet use), and it starts BELOW the header so it does
  // not cover the hamburger that opened it.
  if (overlay) {
    return <MobileSidebarDrawer onClose={() => { requestSidebarCollapse(); }}>{body}</MobileSidebarDrawer>;
  }

  // R2 (Ken 2026-09-20): on a narrow viewport there is NO persistent
  // in-grid rail. The collapsed narrow state renders nothing at all —
  // the header hamburger is the sole nav, opening the drawer overlay
  // above. Rendering a `w-14` icon rail here (the old behaviour) put an
  // unlabelled dot strip on every phone; the drawer already carries the
  // labels, scrim, focus-trap and Escape, so the rail was pure noise
  // stealing the width the content came for. The grid column is `auto`,
  // so returning null collapses the track to 0 without disturbing the
  // main pane. Desktop (wide) is unchanged: expanded in-grid column,
  // collapsed rail, and the resize handle all still render below.
  if (narrow) {
    return null;
  }

  return (
    <aside
      className={[
        "relative row-start-2 flex min-h-0 flex-col border-r border-border-subtle bg-bg-surface py-3 px-2",
        // The width transition animates the collapse/expand only. During
        // an active drag it is removed so the column tracks the pointer
        // 1:1 instead of easing toward it. (Reduced-motion is handled
        // globally in index.css, SHL-28.)
        dragging ? "" : "transition-[width] duration-150 ease-out",
        // Collapsed keeps the fixed rail width; expanded uses the
        // persisted width via inline style below.
        collapsed ? "w-14" : "",
      ].join(" ")}
      // Only the expanded, in-grid column is width-driven. The grid
      // column is `auto`, so the element's own width sets the track.
      style={inGridExpanded ? { width } : undefined}
      data-collapsed={collapsed}
    >
      {body}
      {/* The grab strip is rendered only for the expanded, in-grid,
          desktop column — never for the collapsed rail or the mobile
          overlay (which has its own width and floats over the content). */}
      {inGridExpanded ? (
        <SidebarResizeHandle width={width} setWidth={setWidth} onDraggingChange={setDragging} />
      ) : null}
    </aside>
  );
}

/**
 * The drag-to-resize grab strip on the expanded sidebar's right edge.
 *
 * Pointer: `setPointerCapture` on pointer-down routes every subsequent
 * move to this element even when the cursor outruns it, and the new
 * width is the pointer's X relative to the sidebar's left edge. The hook
 * clamps; this only measures. Release ends the drag.
 *
 * A11Y (WCAG 2.1.1, mouse-only would fail): the strip is a
 * `role="separator"` with `aria-orientation="vertical"`, an
 * `aria-label`, and `aria-valuenow/min/max`. Left/Right arrows nudge by
 * `SIDEBAR_WIDTH_STEP`; Home/End jump to the min/max. So the whole
 * feature is operable from the keyboard, not just the mouse.
 */
function SidebarResizeHandle({
  width,
  setWidth,
  onDraggingChange,
}: {
  readonly width: number;
  readonly setWidth: (px: number) => void;
  readonly onDraggingChange: (dragging: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // Left button / primary pointer only; ignore secondary buttons.
    if (e.button !== 0) return;
    e.preventDefault();
    const el = ref.current;
    if (el === null) return;
    // The sidebar's left edge is the resize origin — width is the
    // pointer's distance from it. Read once at drag start; the sidebar
    // does not move horizontally during a drag.
    const originX = el.parentElement?.getBoundingClientRect().left ?? 0;
    onDraggingChange(true);
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      setWidth(ev.clientX - originX);
    };
    const onUp = (ev: PointerEvent): void => {
      onDraggingChange(false);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        // The capture may already be gone (pointercancel); harmless.
      }
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null;
    switch (e.key) {
      case "ArrowLeft":
        next = width - SIDEBAR_WIDTH_STEP;
        break;
      case "ArrowRight":
        next = width + SIDEBAR_WIDTH_STEP;
        break;
      case "Home":
        next = MIN_SIDEBAR_WIDTH;
        break;
      case "End":
        next = MAX_SIDEBAR_WIDTH;
        break;
      default:
        return;
    }
    e.preventDefault();
    setWidth(next);
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabIndex={0}
      data-testid="sidebar-resize-handle"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // A thin strip hugging the right border, slightly wider than the
      // 1px border so it is an easy grab target, and reaching full height.
      // Focus ring for keyboard users.
      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize outline-none hover:bg-accent-muted focus-visible:bg-accent-muted focus-visible:ring-1 focus-visible:ring-accent"
    />
  );
}

/** Below this the header is 48px tall (see AppShell's grid rows). */
const HEADER_H = "3rem";

/**
 * The mobile sidebar drawer (R2), as a proper modal dialog.
 *
 * Fixes the live-review blockers: it is a `role="dialog" aria-modal`, has
 * a scrim behind it and a close button, traps focus and restores it on
 * close (`useFocusTrap`), marks the background inert (`useInertBackground`),
 * closes on Escape, and — crucially — starts below the 48px header so it
 * never covers the hamburger toggle that opens and closes it (the toggle
 * stays tappable to dismiss the drawer).
 */
function MobileSidebarDrawer({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useInertBackground(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // A nested modal (the Edit / Delete dialog opened from a saved-filter
      // row's kebab) is itself a `role="dialog" aria-modal` and closes on
      // its own document-level Escape handler. Without this guard, one
      // Escape in that dialog would be seen by both handlers and tear down
      // the whole drawer along with the dialog. Let the inner modal have
      // the keystroke; the drawer only closes on an Escape with nothing
      // stacked over it.
      if (panelRef.current?.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <>
      {/* Scrim: below the header (so the hamburger stays reachable) and a
          tap-away dismiss target that dims the content behind. */}
      <div
        data-testid="sidebar-overlay-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/40"
        style={{ top: HEADER_H }}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        data-collapsed={false}
        data-overlay="true"
        className="fixed bottom-0 left-0 z-40 flex w-60 max-w-[85vw] min-h-0 flex-col border-r border-border-subtle bg-bg-surface px-2 pb-3 pt-2 shadow-lg"
        style={{ top: HEADER_H }}
      >
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <span className="px-1.5 text-[0.7857rem] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
            Navigation
          </span>
          <IconButton
            aria-label="Close navigation"
            testId="sidebar-overlay-close"
            onClick={onClose}
          >
            <Icon name="close" />
          </IconButton>
        </div>
        {children}
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
  "saved-filters": "the saved views",
  // K125 (amended, Ken 2026-09-24): "Nest under 'Filters' — One 'Filters'
  // section you can move as a unit ... They stay together in the
  // sidebar." The first cut of this ticket made `filters` a real,
  // independently orderable/hideable stored group id but gave it no
  // live-sidebar row of its own — moving it in the Customize-sidebar
  // panel changed nothing visible, exactly the "not connected to the
  // sidebar" disconnect Ken's original complaint named. Fixed: `filters`
  // now renders its own section (`FiltersGroup` below), headed
  // "Filters", at this id's own position in the stored order — moving
  // or hiding the group in the panel now moves or hides a real section.
  filters: "the built-in filters",
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
  const sectionCollapse = useSectionCollapse();
  // A failed / in-flight settings read is not a customization — fall
  // back to the default (every group, default order, all visible).
  const groups = readSidebarGroups(settings.data?.settings);
  // K125 gap fix (Ken 2026-09-24): this MUST go through the same
  // migration-aware resolver the Customize-sidebar panel uses
  // (`resolveGroupedSidebarOrder`), not the plain `resolveSidebarOrder`.
  // A pre-K125 stored `order` can only ever have placed an individual
  // filter id at the top level (there was no `filters` id yet); reading
  // it with the plain resolver put `filters` at its bare default
  // catalog slot regardless of where the user's own filters actually
  // sat, so an existing user's Filters section jumped to an unrelated
  // position on first load after this ticket. Mapping the grouped rows
  // back to `{id, hidden}` here keeps the render loop below unchanged.
  const resolved = resolveGroupedSidebarOrder(groups, [...SIDEBAR_GROUP_IDS]).map(r => (
    r.kind === "filters-group"
      ? { id: "filters" as const, hidden: r.hidden }
      : { id: r.id, hidden: r.hidden }
  ));
  // Resolved against the group-only catalog, so every id is a group id;
  // the guard narrows `SidebarItemId` to `SidebarGroupId` for TS.
  const isGroupId = (id: string): id is SidebarGroupId =>
    (SIDEBAR_GROUP_IDS as readonly string[]).includes(id);

  const render = (id: SidebarGroupId): ReactNode => {
    switch (id) {
      case "views":
        return <ViewSwitcher collapsed={collapsed} currentUserId={currentUserId} today={today} />;
      case "projects":
        return <ProjectsGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />;
      case "saved-filters":
        return (
          <SavedViewsGroup
            collapsed={collapsed}
            currentUserId={currentUserId}
            today={today}
          />
        );
      case "milestones":
        return <MilestonesGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />;
      case "sprints":
        return <SprintsGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />;
      case "labels":
        return <LabelsGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />;
      case "recents":
        return <RecentsGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />;
      case "filters":
        return <FiltersGroup collapsed={collapsed} currentUserId={currentUserId} today={today} />;
    }
  };

  return (
    <SectionCollapseContext.Provider value={sectionCollapse}>
      {resolved.map(item =>
        item.hidden || !isGroupId(item.id) ? null : (
          <RegionErrorBoundary key={item.id} region={GROUP_REGION[item.id]}>
            {render(item.id)}
          </RegionErrorBoundary>
        ),
      )}
    </SectionCollapseContext.Provider>
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

// ── Collapsible sections (U22) ───────────────────────────────────────

const SECTION_COLLAPSE_KEY = "loctt.sidebar.collapsedSections";

/**
 * Per-section collapse state for the sidebar groups, persisted per browser
 * in localStorage (Ken: "sections should be collapsible, then save which
 * parts should be collapsed"). Returns the collapsed set and a toggler.
 *
 * Every read/write is wrapped: storage can throw or be absent (private
 * mode, blocked site data, SSR/preview), and the sidebar must render fine
 * without it — a missing value simply means "nothing collapsed".
 */
function useSectionCollapse(): {
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
} {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = localStorage.getItem(SECTION_COLLAPSE_KEY);
      if (raw === null) return new Set();
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? new Set(parsed.filter((x): x is string => typeof x === "string"))
        : new Set();
    } catch {
      return new Set();
    }
  });

  const toggle = (id: string): void => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        // Persistence is best-effort; the in-memory state still updates so
        // the toggle works for this session even when storage is unavailable.
      }
      return next;
    });
  };

  return { isCollapsed: (id: string) => collapsed.has(id), toggle };
}

/**
 * Section collapse state is shared via context so the seven group
 * components don't each grow two props — they render a `SectionShell`,
 * which reads the toggle from here. Provided once in `SidebarGroups`.
 */
const SectionCollapseContext = createContext<{
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
}>({ isCollapsed: () => false, toggle: () => undefined });

/**
 * A sidebar group with a collapsible header (U22). Replaces the bare
 * `GroupLabel` + wrapper `div` each group used: the header is now a real
 * toggle (a `<button>` with a rotating chevron and
 * `aria-expanded`/`aria-controls`), and the group's body is hidden when
 * the section is collapsed. When the WHOLE sidebar is collapsed to icons,
 * there is no header to click and the body renders as before (per-section
 * collapse is a widened-sidebar affordance).
 */
function SectionShell({
  id,
  label,
  collapsed,
  children,
}: {
  readonly id: string;
  readonly label: string;
  /** The whole sidebar is collapsed to an icon rail. */
  readonly collapsed: boolean;
  readonly children: ReactNode;
}) {
  const { isCollapsed, toggle: onToggle } = useContext(SectionCollapseContext);
  const sectionCollapsed = !collapsed && isCollapsed(id);
  const bodyId = `sidebar-section-${id}`;
  return (
    <div className="flex flex-col gap-0.5">
      {!collapsed && (
        <button
          type="button"
          data-testid={`sidebar-section-toggle-${id}`}
          aria-expanded={!sectionCollapsed}
          aria-controls={bodyId}
          onClick={() => onToggle(id)}
          className="group flex items-center gap-1 rounded-md px-2.5 pb-0.5 pt-1.5 text-left text-[0.7857rem] font-semibold uppercase tracking-[0.06em] text-text-tertiary hover:text-text-secondary"
        >
          <Icon
            name="chevronDown"
            size={12}
            className={sectionCollapsed ? "-rotate-90 transition-transform" : "transition-transform"}
          />
          {label}
        </button>
      )}
      {!sectionCollapsed && (
        <div id={bodyId} className="flex flex-col gap-0.5">
          {children}
        </div>
      )}
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
      // no anchor of their own (an inert built-in, or the collapsed icons).
      title={title}
      className={[
        "flex h-8 items-center rounded-md text-[0.9286rem]",
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
 * `pending` and "no badge at all" are different: an inert built-in (a
 * user filter with no current user) has no count to wait for (VUE-2) and
 * gets no slot, while a slow query (SHL-23) shows a pending affordance in
 * a slot that is already the right size.
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
      className="ml-auto min-w-[1.75rem] rounded-full bg-bg-muted px-1.5 text-center text-[0.7857rem] tabular-nums text-text-tertiary"
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

/**
 * `ColorDot` for a STORED entity colour (K103's three shapes) rather
 * than a CSS token.
 *
 * `ColorDot` itself keeps its `string` contract because most of its
 * callers pass a `var(--…)` token, which is not an `EntityColor` and
 * must not be run through the resolver. Only the label row holds a
 * user-configured colour, so the resolution is a thin wrapper rather
 * than a widened prop — a widened prop would have accepted a token and
 * a stored colour interchangeably, which is how a CSS var ends up
 * being asked which palette entry it is.
 *
 * An unresolvable colour yields `undefined`, and `ColorDot`'s own
 * tertiary default then applies — the dot stays visible.
 */
function EntityColorDot({ color }: { color?: EntityColor | undefined }) {
  return <ColorDot color={useResolvedColor(color)} />;
}

/**
 * A saved view's icon, tinted by that view's own colour (K104-view-colour).
 *
 * A component rather than an inline call because the row is rendered
 * inside a `.map()` callback, where a hook cannot be called. Mirrors
 * `EntityColorDot` above, which exists for the same reason.
 *
 * `IconGlyph` applies `color` ONLY to a Lucide glyph — an emoji carries
 * its own colour and is never tinted (Ken, 2026-09-22). So the emoji
 * rule needs no branch here; passing the colour unconditionally is
 * correct, and the resolver yields `undefined` for a view with none.
 *
 * A view with NO icon falls back to the same dot a label row draws
 * (Ken, 2026-09-23: *"fallback icon = the circle (same as how we do for
 * labels)"*), and that dot is **grey, never the view's colour** (Ken,
 * same day: *"fallback icon = circle, and grey"*). Passing the tint
 * here would have made the fallback read as a deliberate, configured
 * mark; grey says "nothing was picked". `ColorDot` with no colour
 * already yields `var(--text-tertiary)`, so the absent-icon case is
 * spelled by omitting the prop rather than by computing a grey.
 *
 * The icon is genuinely optional — the form seeds it `undefined`,
 * offers a Clear button, and neither the web form nor MCP `create_view`
 * requires one — so this branch is reached, and it must fill the row's
 * mark slot or the sidebar's label edge goes ragged (UI-26b). It was a
 * `star`, which collided with the default-project marker: one glyph,
 * two unrelated meanings in one sidebar (UI-26d).
 */
function ViewIcon({ icon, color }: {
  readonly icon: string | undefined;
  readonly color?: EntityColor | undefined;
}) {
  const tint = useResolvedColor(color);
  if (icon === undefined) return <ColorDot />;
  return <IconGlyph icon={icon} size={12} {...(tint !== undefined ? { color: tint } : {})} />;
}

/* ---------- active-row derivation (K118) ---------- */

/**
 * The sidebar's single selected row, as an opaque identity every group
 * compares itself against.
 *
 * K118 (Ken's ruling, 2026-09-23): "the sidebar has exactly one
 * selection". Before this, each group computed its own `active` flag
 * from whatever slice of the route it cared about — Projects read
 * `search.project`, the Views group read `search.q`/`search.view`,
 * and four groups (Milestones, Sprints, Labels, Recently viewed)
 * computed no active state at all. That let a project row and a
 * saved-view row light up together (clicking a view never cleared the
 * project scope, and vice versa), and a saved-view click carried over
 * a built-in's `q`, and it made "no active state" easy to ship by
 * omission because nothing forced every group through one rule.
 *
 * This function is the one rule. It runs once per render, from the
 * pathname and search alone, and returns a single tagged identity (or
 * `null` on a route the sidebar has no selection for, e.g. /settings).
 * Every row in every group asks "is my identity this one?" — never
 * "is some param present" — so two rows lit at once is no longer
 * something a group can do by itself.
 *
 * **The chosen rule** (Ken, offered "one selection, always" vs.
 * "project is a scope, marked differently", chose the former):
 * clicking ANY sidebar row is a full replace of the sidebar-driven URL
 * state, not an addition to it. So:
 *  - On /list, /board, /timeline: exactly one of
 *    {a saved view, a built-in filter, a sprint, a label, a project}
 *    is selected, in that priority order — never two, because the
 *    resolvers below use `else if`. `view`/`q`/`sprint`/`labels`/
 *    `project` are mutually exclusive in practice (every sidebar link
 *    clears the others before setting its own), so the priority order
 *    only matters for a URL edited by hand or bookmarked
 *    mid-transition.
 *  - The view switcher (List/Board/Timeline) lights when nothing else
 *    is scoped — `deriveActiveRow` resolves the nothing-scoped state to
 *    `{kind: "view"}` and the switcher lights from it directly. K118
 *    originally had to arbitrate a tie here against a separate "All
 *    projects" sidebar row that described the identical state; K125
 *    (Ken, 2026-09-24) removed that row as a plain duplicate ("take out
 *    the 'All projects' then? if its duplicate"), so there is no longer
 *    a second row to reconcile against — "click List" (or Board/
 *    Timeline) IS how you get back to the unscoped view, per K125.
 *  - /milestones and /milestones/$id, /sprints (the overview links),
 *    and /tasks/$key each select their own single row.
 *
 * Kept OUT of this function: whether List/Board/Timeline carries the
 * filter scope across a switch and whether a project/view click stays
 * on the current view (`viewTo` in `ProjectsGroup`) — both are just
 * what a click's `search`/`to` should produce, not what is lit
 * afterward. `viewTo`/the cross-view scope fix (Ken, 2026-09-20) is
 * preserved as-is; the view switcher's OWN `search` function is no
 * longer `carryFilters` — see K125 above `ViewSwitcher`, which
 * supersedes the 2026-09-20 carry-across for the sidebar-driven params
 * a view-link click now clears.
 */
type ActiveRow =
  | { readonly kind: "view"; readonly to: "/list" | "/board" | "/timeline" }
  | { readonly kind: "project"; readonly id: string }
  | { readonly kind: "builtin"; readonly id: string }
  | { readonly kind: "saved-view"; readonly id: string }
  | { readonly kind: "milestones" }
  | { readonly kind: "milestone"; readonly id: string }
  | { readonly kind: "sprints" }
  | { readonly kind: "sprint"; readonly id: string }
  | { readonly kind: "label"; readonly id: string }
  | { readonly kind: "recent"; readonly key: string };

/** Structural equality over the small, flat `ActiveRow` shape. */
function sameRow(a: ActiveRow | null, b: ActiveRow | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "view":
      return b.kind === "view" && a.to === b.to;
    case "project":
      return b.kind === "project" && a.id === b.id;
    case "builtin":
      return b.kind === "builtin" && a.id === b.id;
    case "saved-view":
      return b.kind === "saved-view" && a.id === b.id;
    case "milestones":
      return b.kind === "milestones";
    case "milestone":
      return b.kind === "milestone" && a.id === b.id;
    case "sprints":
      return b.kind === "sprints";
    case "sprint":
      return b.kind === "sprint" && a.id === b.id;
    case "label":
      return b.kind === "label" && a.id === b.id;
    case "recent":
      return b.kind === "recent" && a.key === b.key;
  }
}

/**
 * Derives the single active row from the current route.
 *
 * `resolvedBuiltins` is the set of built-ins whose `resolve()` did not
 * return `null` (an inert built-in has nothing to match against), each
 * paired with the exact `q` it resolves to for THIS `ctx` — the same
 * comparison `FiltersGroup` (formerly part of `SavedFiltersGroup`)
 * used to do locally.
 */
/**
 * A csv-codec search param (`project`/`labels`/`sprint`) normally
 * arrives as a `string[]` (see `router/listSearch.ts`'s `csv` codec),
 * but a raw/un-normalized search object — as a bare
 * `URLSearchParams`-derived value, or in a test harness that skips the
 * schema — can hand back a plain `string` for a single value. Treating
 * a bare string as an array of its characters was an actual bug this
 * function had at one point (`"p_api"[0]` is `"p"`, not `"p_api"`), so
 * every array-shaped field is read through this pair of helpers rather
 * than indexed directly.
 */
function firstValue(v: string | readonly string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "string" ? v : v[0];
}

/** Like {@link firstValue}, but only when there is exactly one value — used for the single-select sprint/label rows. */
function soleValue(v: string | readonly string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  return v.length === 1 ? v[0] : undefined;
}

function deriveActiveRow(
  pathname: string,
  search: Record<string, unknown>,
  resolvedBuiltins: readonly { readonly id: string; readonly q: string | undefined }[],
): ActiveRow | null {
  if (pathname === "/milestones") return { kind: "milestones" };
  const milestoneMatch = /^\/milestones\/(.+)$/.exec(pathname);
  if (milestoneMatch?.[1] !== undefined) {
    return { kind: "milestone", id: decodeURIComponent(milestoneMatch[1]) };
  }
  if (pathname === "/sprints") return { kind: "sprints" };
  const taskMatch = /^\/tasks\/(.+)$/.exec(pathname);
  if (taskMatch?.[1] !== undefined) {
    return { kind: "recent", key: decodeURIComponent(taskMatch[1]) };
  }

  if (!isView(pathname)) return null;

  const s = search as {
    view?: string;
    q?: string;
    sprint?: string | string[];
    labels?: string | string[];
    project?: string | string[];
  };

  if (typeof s.view === "string" && s.view !== "") {
    return { kind: "saved-view", id: s.view };
  }
  if (typeof s.q === "string" && s.q !== "") {
    const builtin = resolvedBuiltins.find(f => f.q === s.q);
    if (builtin) return { kind: "builtin", id: builtin.id };
  }
  const sprintId = soleValue(s.sprint);
  if (sprintId !== undefined) {
    return { kind: "sprint", id: sprintId };
  }
  const labelId = soleValue(s.labels);
  if (labelId !== undefined) {
    return { kind: "label", id: labelId };
  }
  const projectId = firstValue(s.project);
  if (projectId !== undefined) {
    return { kind: "project", id: projectId };
  }
  // Nothing scoped: the view itself (or, equivalently, "All projects" —
  // see the type doc above) is the selection.
  return { kind: "view", to: pathname as "/list" | "/board" | "/timeline" };
}

/**
 * The one hook every group calls to find out whether IT is the
 * selection, instead of each computing its own flag from a slice of
 * the route it happens to read.
 *
 * Reads the route itself (pathname + search) and resolves the
 * built-ins against the live workflow config + current user, exactly
 * as `FiltersGroup` (formerly part of `SavedFiltersGroup`) already did
 * locally — moved here so
 * `deriveActiveRow` (route-only, easily unit-tested) stays separate
 * from the query data needed only to resolve a `q` back to a builtin
 * id. Cheap to call from every group: `useWorkflow`/`useRouterState`
 * are cached/selector reads, not new requests.
 */
function useActiveRow(currentUserId: string | null, today: string): ActiveRow | null {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const search = useRouterState({ select: s => s.location.search }) as Record<string, unknown>;
  const workflow = useWorkflow();
  const ctx = { currentUserId, today, priorities: workflow.data?.priorities };
  const resolvedBuiltins = BUILTIN_FILTERS.flatMap(f => {
    const resolved = f.resolve(ctx);
    return resolved === null ? [] : [{ id: f.id, q: resolved.q }];
  });
  return deriveActiveRow(pathname, search, resolvedBuiltins);
}

/* ---------- groups ---------- */

const VIEWS: { to: "/list" | "/board" | "/timeline"; label: string; icon: IconName }[] = [
  { to: "/list", label: "List", icon: "list" },
  { to: "/board", label: "Board", icon: "board" },
  { to: "/timeline", label: "Timeline", icon: "timeline" },
];

function ViewSwitcher({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  // K118: List/Board/Timeline is lit only when it IS the selection —
  // i.e. `deriveActiveRow` returned `{kind: "view", to: <this one>}`,
  // meaning nothing else (a project, a saved view, a builtin, a
  // sprint, a label) is scoped. Previously this compared `pathname`
  // alone, so a project click made from /board left Board lit even
  // though a project row was ALSO lit — two rows at once.
  const active = useActiveRow(currentUserId, today);
  return (
    <div className="flex flex-col gap-0.5">
      {VIEWS.map(v => (
        <Link
          key={v.to}
          to={v.to}
          title={v.label}
          className="no-underline"
          // K125 (Ken, 2026-09-24): a view link is a sidebar row like any
          // other, and K118's rule is "clicking any sidebar row replaces
          // the whole sidebar-driven state" — so List/Board/Timeline now
          // CLEAR the sidebar-driven scope (project, saved view, built-in
          // filter's q, labels, sprint) instead of carrying it, dropping
          // the ambient sort too (LST-55). This supersedes the
          // 2026-09-20 cross-view carry-across (`carryFilters`, removed)
          // for exactly these params: Ken's own framing was "click
          // 'list'?" as the answer to "how do I get back to all tasks",
          // so the result of clicking a view link must be the fully
          // unscoped view.
          //
          // The rule we chose for what ELSE carries: nothing does.
          // `clearFilters` drops every `FILTER_KEYS` entry, which
          // includes the toolbar facets (status/priority/type/assignee/
          // reporter/milestone) as well as the sidebar-driven ones —
          // carrying just the toolbar facets would leave "click List"
          // still scoped to whatever the toolbar had set, contradicting
          // K125's "get back to all tasks" framing. So a view-link click
          // is now a full reset of the query, same as every other
          // sidebar row, and NOT the same click as the in-view toggle
          // between List/Board/Timeline that used to preserve a toolbar
          // search — that carry-across is gone. `viewTo`'s "stay on the
          // current view for a PROJECT click" (2026-09-20) is untouched;
          // this only changes the view switcher's OWN links.
          search={prev => clearSort(clearFilters(prev))}
        >
          <ItemShell
            active={sameRow(active, { kind: "view", to: v.to })}
            collapsed={collapsed}
            title={v.label}
          >
            <Icon name={v.icon} size={14} className="shrink-0" />
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
        className="mx-auto my-1 cursor-pointer text-[0.7857rem] text-danger-fg"
      >
        !
      </div>
    );
  }
  return (
    <div role="alert" className="px-2 py-1 text-[0.8571rem] text-text-tertiary">
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
          <Link
            to="/settings/$section"
            params={{ section: "diagnostics" }}
            data-testid="group-error-diagnostics-link"
            className="underline hover:text-text-primary"
          >
            Open Diagnostics
          </Link>
          <span className="text-text-tertiary">
            {" "}or run <code className="font-mono">loctt doctor</code>
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
            <pre className="mt-1 whitespace-pre-wrap break-words text-[0.7857rem] text-text-tertiary">
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
    <div className="px-2.5 py-1 text-[0.8571rem] italic text-text-tertiary">{children}</div>
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

function ProjectsGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const projects = useProjects();
  // K118: the one derivation every group compares against, replacing
  // this group's own `activeProjects`/`allActive` computation (which
  // read only `search.project` and so stayed lit through a view or
  // filter click that never cleared it).
  const activeRow = useActiveRow(currentUserId, today);
  // Cross-view scope fix (Ken 2026-09-20): a project click made from the
  // board or timeline should stay on that view, not jump to /list.
  // `clearFilters`/`clearSort` already leave the timeline's display state
  // (zoom/grouping/arrows) untouched, so re-scoping the project keeps the
  // rest of the view intact. Milestone/sprint/label/saved-view links stay
  // hardcoded to /list — those are list-shaped destinations.
  const pathname = useRouterState({ select: s => s.location.pathname });
  const viewTo = isView(pathname) ? (pathname as "/list" | "/board" | "/timeline") : "/list";
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
  // K100: the same ProjectEditDialog the Settings panel renders, opened
  // from a row's kebab. Only the id is held; the current ProjectDef is
  // looked up from live data at render, so an external rename is reflected.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingProject = items.find(p => p.id === editingId) ?? null;
  // U10: "+ New project" opens the shared CreateProjectDialog in place.
  const [creating, setCreating] = useState(false);
  const taskCounts = projects.data?.task_counts ?? {};

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

  return (
    <>
    <SectionShell id="projects" label="Projects" collapsed={collapsed}>
      {failed && (
        <GroupError collapsed={collapsed} error={projects.error} onRetry={() => { void projects.refetch(); }} />
      )}
      {!failed && hasAnswered(projects) && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No projects yet</GroupEmpty>
      ) : null}

      {/* K125 (Ken, 2026-09-24): the "All projects" row is removed. It
          described the exact same state as the view switcher's own
          "nothing scoped" row (see the `ActiveRow` type doc's
          tie-breaker discussion, now also removed) — Ken: "take out the
          'All projects' then? if its duplicate". Getting back to all
          tasks is now "click List" (or Board/Timeline), which K125 also
          makes drop the project scope — see `ViewSwitcher` below. */}

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
          className="px-2.5 py-1 text-[0.8571rem] text-text-tertiary"
        >
          No projects match “{query.trim()}”
        </div>
      ) : null}

      {visible.map(p => {
        const active = sameRow(activeRow, { kind: "project", id: p.id });
        const row = (
          <Link
            to={viewTo}
            // Selecting a project is a single-facet jump (clears other
            // filters, like the built-ins); clicking the already-active
            // project clears it. Multi-project selection lives in the
            // M1.3 filter bar, not the sidebar. Route-aware `to` keeps a
            // click made on the board/timeline on that view (cross-view
            // scope fix); `clearFilters` leaves the timeline's display
            // state alone, so only the project scope changes.
            search={prev =>
              active
                ? clearSort(clearFilters(prev))
                : { ...clearSort(clearFilters(prev)), project: [p.id] }
            }
            title={p.name}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell active={active} collapsed={collapsed} title={p.name}>
              {/* UI-20/UI-6: the hardcoded blue `ColorDot` is gone —
                  every project drew the identical dot, so it encoded
                  nothing (a per-item-shaped mark with a constant value).
                  Not replaced with a type glyph either: ProjectDef has
                  no colour field, and inventing one is new scope no
                  decision covers.

                  UI-26d: the `star` default-project marker is gone too
                  (Ken, 2026-09-23: "no star for default project, take it
                  out"). The same star was ALSO the saved-view fallback
                  icon, so one glyph carried two unrelated meanings in
                  one sidebar — and a star conventionally reads
                  "favourite", which is neither of them. Which project is
                  default is stated plainly where it is set: Settings →
                  My preferences, and the project's own edit dialog.

                  NO empty slot: Ken, 2026-09-23, "missing gap is ugly".
                  Reserving 16px that draws nothing is a visible hole —
                  worse than the ragged edge UI-25 fixed, because the eye
                  reads a gap as a missing thing. Rows with no mark close
                  up instead. */}
              {!collapsed ? (
                <>
                  <span className="truncate">{p.name}</span>
                </>
              ) : null}
            </ItemShell>
          </Link>
        );
        // Collapsed rail: icon-only, no room for a kebab (matches the
        // saved-filter rows).
        if (collapsed) return <div key={p.id}>{row}</div>;
        // K100: the kebab is a SIBLING of the <Link> (a <button> inside an
        // <a> is invalid HTML), matching the saved-filter row pattern. Edit
        // opens the shared ProjectEditDialog; Make default / Archive are
        // handled inside that same dialog, so the kebab need only open it.
        // UI-17/K105: no "Manage projects…" deep link — an item-scoped
        // kebab offers actions on THAT item; administering every project
        // is a different scope and lives behind the persistent Settings
        // gear.
        return (
          <div
            key={p.id}
            // UI-16c: a badge-ending row (built-in filters) insets its
            // trailing content by `ItemShell`'s own `px-2.5`, but the
            // kebab here is a SIBLING of `ItemShell`, outside that
            // padding — so it sat flush against the sidebar edge, 8.75px
            // further right than a badge's edge, and the column's right
            // side zig-zagged row to row. `pr-2.5` matches that inset so
            // every row kind ends at the same x.
            className="flex items-center rounded-md pr-2.5 hover:bg-bg-muted"
            data-project-row={p.id}
          >
            {row}
            <ProjectRowActions
              project={p}
              isDefault={p.id === defaultProjectId}
              onEdit={() => { setEditingId(p.id); }}
            />
          </div>
        );
      })}

      {/* PRU-21 + A11Y-12: the project list's collapse is a real
          expand/collapse control, so it carries `aria-expanded` (a
          keyboard/AT user is told whether the extra projects are shown)
          and toggles *both* ways on Enter/Space — a one-way "+N more"
          with no way back exposed no state and could not be collapsed
          again. Shown while collapsed with hidden items, or while
          expanded (as "Show fewer"); a search that reveals everything
          drops it, since there is nothing to collapse. */}
      {!collapsed && (hiddenCount > 0 || expanded) && truncate ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => { setExpanded(v => !v); }}
          data-testid="project-more"
          className="mx-2.5 rounded-md px-0 py-1 text-left text-[0.8571rem] font-medium text-text-tertiary hover:text-text-primary"
        >
          {expanded ? "Show fewer" : `+${hiddenCount} more`}
        </button>
      ) : null}

      {/* "+ New project": the create form is now the shared, self-contained
          CreateProjectDialog (it owns its own mutation + slug/prefix
          uniqueness validation) that the Settings panel ALSO renders. Per
          K100 this earns an in-place affordance — clicking opens the same
          dialog directly, no navigation to Settings first (U10) — instead
          of a deep link, and without forking a second create form. */}
      {!collapsed && !failed ? (
        <button
          type="button"
          data-testid="sidebar-new-project"
          title="New project"
          onClick={() => { setCreating(true); }}
          className="w-full text-left no-underline"
        >
          <ItemShell collapsed={collapsed} title="New project">
            <span className="w-4 shrink-0 text-center text-accent">+</span>
            <span className="truncate text-accent">New project</span>
          </ItemShell>
        </button>
      ) : null}

      </SectionShell>

      {/* Dialogs live OUTSIDE the SectionShell so collapsing the section
          never unmounts an open dialog. */}
      {/* K100: the shared editor, mounted fresh on open so it seeds from
          the current project. Make default / Archive live inside it. */}
      {editingProject !== null ? (
        <ProjectEditDialog
          project={editingProject}
          taskCount={taskCounts[editingProject.id] ?? 0}
          others={items.filter(o => o.id !== editingProject.id)}
          isDefault={editingProject.id === defaultProjectId}
          onClose={() => { setEditingId(null); }}
        />
      ) : null}

      {/* U10 / K100: the same create dialog the Settings panel renders,
          opened directly from "+ New project" (no navigation). The
          uniqueness check must see EVERY project — an archived project
          still holds its prefix/slug — so this passes the unfiltered list,
          not the `items` used for the (archived-excluding) sidebar rows,
          matching what the Settings panel passes. */}
      {creating ? (
        <CreateProjectDialog
          existing={projects.data?.items ?? []}
          onClose={() => { setCreating(false); }}
        />
      ) : null}
    </>
  );
}

/**
 * A project row's kebab (K100). A sibling of the row `<Link>` — a
 * `<button>` inside an `<a>` is invalid HTML — carrying Edit (opens the
 * shared `ProjectEditDialog`, where Make default / Archive also live).
 * UI-17 / K105: no "Manage projects…" deep link — an item-scoped kebab
 * offers actions on THAT item, not administration of every project of
 * its type. The persistent Settings gear (`Footer`, below) already
 * reaches Projects directly.
 */
function ProjectRowActions({
  project,
  isDefault,
  onEdit,
}: {
  readonly project: ProjectDef;
  readonly isDefault: boolean;
  readonly onEdit: () => void;
}) {
  const archive = useArchiveProject();
  const setDefault = useSetDefaultProject();
  return (
    <RowActions
      size="sm"
      label={`Actions for project "${project.name}"`}
      actions={[
        { label: "Edit", testId: "sidebar-project-edit", onSelect: onEdit },
        {
          label: isDefault ? "Default (current)" : "Make default",
          testId: "sidebar-project-set-default",
          disabled: isDefault || setDefault.isPending,
          onSelect: () => { setDefault.reset(); setDefault.mutate({ id: project.id }); },
        },
        {
          // K121 #1: the sidebar lists active projects only; restoring
          // happens in Settings → Archived.
          label: "Archive",
          testId: "sidebar-project-archive",
          disabled: archive.isPending,
          onSelect: () => { archive.reset(); archive.mutate({ id: project.id, archived: true }); },
        },
      ]}
    />
  );
}

/**
 * K125 (amended, Ken 2026-09-24). Was `SavedFiltersGroup` and rendered
 * BOTH the six built-in filters and saved views under one heading
 * ("Views") — the built-ins' rendering moved out to `FiltersGroup`
 * below, in its own section, when the Customize-sidebar panel's
 * "Filters" row was made to actually move/hide a real section (see the
 * `GROUP_REGION` comment above). What is left here is saved views only,
 * so the heading is renamed "Saved views" to match — see the rename
 * note on `SectionShell`'s call below.
 */
function SavedViewsGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const views = useViews();
  // K118: the one derivation every group compares against. Previously
  // this group computed its own active state from `search.q`/
  // `search.view` directly (UI-16b) — which is exactly the "each group
  // decides for itself" shape K118 forbids: a saved-view LINK
  // (`:1543`/`:1610` below) never cleared `q`, so a built-in stayed lit
  // underneath the saved view you had just clicked. `deriveActiveRow`
  // gives `view` priority over `q`, so that carry-over no longer
  // produces two lit rows even though the URL still carries the stale
  // `q` until the next full filter-clearing navigation.
  const activeRow = useActiveRow(currentUserId, today);
  // SET-13: pinned views lead the group, in the user's stored pin
  // order; everything else follows in config order. A pin whose view
  // is gone contributes nothing here — it has no row to render — and
  // the pins panel is what tells the user it went.
  const settings = useUserSettings();
  const pins = readSidebarPins(settings.data?.settings);
  const saveSettings = useUserSettingsMutation();
  const del = useDeleteView();
  // The saved-filter dialog state, mirroring `SavedViewsPanel`'s
  // discriminated union: `null` closed, or one of create / edit / delete.
  // A single state (rather than a bare `creating` boolean) lets the same
  // group host Edit and Delete launched from a row's kebab as well as
  // the "+ New filter…" create.
  //
  // Edit accepts a `SavedQuery` or an entry picked from a
  // `BrokenSavedQuery` (VUE-22's fix path) — the two are not assignable to
  // one another, so the edit target is stored as the minimal shape
  // `ViewFormDialog` actually reads (K102: id + name + the ordered
  // `filters`, plus the view's archived scope and icon so an edit never
  // drops them).
  //
  // A BROKEN view's stored filters did not validate, so there is nothing
  // faithful to seed: the picker opens EMPTY. That much is a deliberate
  // K102 consequence — the dialog has no raw-DSL mode, and showing
  // filters we could not load would be inventing them.
  //
  // What does NOT follow is that Save may then write that empty list
  // over the entry. The broken entry's full original YAML survives on
  // disk in `rawText` and is re-emitted verbatim by every unrelated
  // write (P-11 / K28 / Phase-Z-C2); a plain `editView` from here
  // replaced it with `filters: []`, so the single control offered to
  // repair the entry was the only thing that could destroy it. The edit
  // dialog therefore carries the broken context (`brokenContext` below):
  // it shows the parse error and the on-disk text, and holds Save inert
  // until the user explicitly confirms the replacement. Discarding
  // recoverable text stays possible — it is just never accidental.
  type EditTarget = ViewFormTarget;
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; view: EditTarget; broken?: BrokenViewContext }
    // `broken: true` marks a delete aimed at an entry whose stored
    // filters did not load. Core refuses such a delete without an
    // explicit opt-in (K102-broken-repair), because it discards the
    // original text queries.yaml still preserves.
    | { mode: "delete"; view: EditTarget; broken?: boolean }
    | null
  >(null);
  // VUE-25: archived views are hidden from the sidebar (they stay runnable
  // by id, and are managed from Settings → Saved views). Every other group
  // filters `archived !== true`; this one did not, so an archived view
  // still appeared here — the confirmed defect the spec calls out.
  const allViews = (views.data?.queries ?? []).filter(v => v.archived !== true);
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

  // Where focus returns after a kebab-launched dialog closes: the kebab
  // itself unmounts while the dialog is open (Menu closes on select), so
  // it cannot be the restore target. The "New filter…" button is the
  // stable anchor at the foot of the group.
  const newFilterRef = useRef<HTMLButtonElement>(null);

  /**
   * Deleting a user's own saved view, hard.
   *
   * A328 (B6): before this fix, `dismiss(view.id)`, the pin-removal write
   * and `setDialog(null)` all ran EAGERLY, before the DELETE request had
   * even settled — a FAILED delete still closed the dialog and told
   * `useVanishedViews` the view was gone, so the app believed an
   * unconfirmed delete and showed the user nothing. All three now run
   * only from the mutation's `onSuccess`, once the delete has actually
   * landed:
   *  - `dismiss(view.id)` so `useVanishedViews` does not, on the refetch,
   *    announce "«name» was removed from queries.yaml" for this deliberate
   *    deletion (SHL-32 is for a view that vanished *without* the user's
   *    action here);
   *  - if the view is pinned, drop the pin in the same settings write, the
   *    same pattern `SidebarPinsPanel` uses — leaving it to the pins sweep
   *    would surface a "removed because it no longer exists" notice for a
   *    deletion already confirmed;
   *  - closing the dialog, so a FAILED delete leaves it open with the
   *    inline notice (`DeleteViewDialog`'s `dataState`/`onRetry`) rather
   *    than vanishing as if nothing happened.
   */
  const confirmDelete = (view: EditTarget, broken = false): void => {
    // The DeleteViewDialog the user just confirmed IS the explicit
    // opt-in a broken entry's delete requires (K102-broken-repair); the
    // flag carries that consent to the server. Never sent for a healthy
    // view, whose request is unchanged.
    del.mutate(
      { id: view.id, ...(broken ? { replaceBroken: true } : {}) },
      {
        onSuccess: () => {
          dismiss(view.id);
          if (pins.includes(view.id) && settings.data !== undefined) {
            saveSettings.mutate({
              ...settings.data.settings,
              sidebar_pins: pins.filter(p => p !== view.id),
            } as UserSettings);
          }
          setDialog(null);
        },
      },
    );
  };

  /** Pin the view to the top, or unpin it, via a merged settings write. */
  const togglePin = (view: EditTarget): void => {
    if (settings.data === undefined) return;
    const next = pins.includes(view.id)
      ? pins.filter(p => p !== view.id)
      : [...pins, view.id];
    saveSettings.mutate({
      ...settings.data.settings,
      sidebar_pins: next,
    } as UserSettings);
  };

  return (
    // K125 (amended, Ken 2026-09-24): renamed "Views" → "Saved views" so
    // the sidebar heading matches the Customize-sidebar panel's own row
    // label for this section (both now say "Saved views"), and matches
    // the Settings page "Saved views" heading and the "Save as view"
    // button's own wording — a user can map a customiser row to a
    // sidebar section by name. The stored group id (`saved-filters`,
    // SHL-45's original identity) is UNCHANGED — only the human label
    // moved, so no migration is needed for existing `sidebar_groups`
    // order/hidden entries.
    <SectionShell id="saved-filters" label="Saved views" collapsed={collapsed}>
      {failed && (
        <GroupError collapsed={collapsed} error={views.error} onRetry={() => { void views.refetch(); }} />
      )}

      {userViews.map(v => {
        const active = sameRow(activeRow, { kind: "saved-view", id: v.id });
        const row = (
          <Link
            to="/list"
            // K118: a saved-view click is a full replace, like every
            // other sidebar row — `clearFilters` here (added by this
            // fix) drops a lingering `q`/`project`/`sprint`/`labels`
            // from whatever was active before. Without it, clicking a
            // saved view over an active built-in left the built-in's
            // `q` in the URL, and `deriveActiveRow`'s own view-over-q
            // priority only hides the resulting double-selection for
            // reads coming through this file — a fresh page load or a
            // bookmark of that stale URL would have re-resolved to the
            // builtin instead of the view. Clearing at the source is
            // the actual fix; the derivation's priority order is a
            // second line of defence, not a substitute for it.
            search={prev => ({ ...clearSort(clearFilters(prev)), view: v.id })}
            title={v.name}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell active={active} collapsed={collapsed} title={v.name}>
              {/* UI-19: the view's own icon when set (K104), falling
                  back to the star. `IconGlyph` is the shared read-side
                  renderer (A279) and handles the Lucide-vs-emoji shape
                  sniff, so this must not re-implement it.

                  Views GAINED a colour field (K104-view-colour,
                  2026-09-23) — the comment here previously said they had
                  none. `ViewIcon` resolves it per mode; an emoji is
                  never tinted, which `IconGlyph` already enforces. */}
              <span className="w-4 shrink-0 text-center text-text-tertiary">
                <ViewIcon icon={v.icon} color={v.color} />
              </span>
              {!collapsed ? <span className="truncate">{v.name}</span> : null}
            </ItemShell>
          </Link>
        );
        // Collapsed rail: icon-only, no room for a kebab (matches the
        // built-ins, which also shed their trailing affordance when
        // collapsed).
        if (collapsed) return <div key={v.id}>{row}</div>;
        // The kebab is a SIBLING of the <Link>, not a child: a <button>
        // inside an <a> is invalid HTML. The wrapper carries the row's
        // hover so the whole row (link + kebab) lights up together.
        return (
          <div
            key={v.id}
            // UI-16c: a badge-ending row (built-in filters) insets its
            // trailing content by `ItemShell`'s own `px-2.5`, but the
            // kebab here is a SIBLING of `ItemShell`, outside that
            // padding — so it sat flush against the sidebar edge, 8.75px
            // further right than a badge's edge, and the column's right
            // side zig-zagged row to row. `pr-2.5` matches that inset so
            // every row kind ends at the same x.
            className="flex items-center rounded-md pr-2.5 hover:bg-bg-muted"
            data-view-row={v.id}
          >
            {row}
            <RowActions
              size="sm"
              label={`Actions for saved filter "${v.name}"`}
              actions={[
                { label: "Edit", testId: "view-edit", onSelect: () => { setDialog({ mode: "edit", view: v }); } },
                {
                  label: pins.includes(v.id) ? "Unpin" : "Pin to top",
                  testId: "view-pin",
                  onSelect: () => { togglePin(v); },
                },
                { label: "Delete", testId: "view-delete", danger: true, onSelect: () => { setDialog({ mode: "delete", view: v }); } },
              ]}
            />
          </div>
        );
      })}

      {brokenViews.map(v => {
        // VUE-22: still a link — clicking shows the parse error with its
        // position and opens the editor pre-populated, "rather than an
        // empty list". Marked broken so it is not mistaken for a healthy
        // view, and titled with the parser's message for a quick read.
        // K118: a broken view is stored under the same `view` param a
        // healthy one uses, so `deriveActiveRow`'s `saved-view` case
        // matches it too — it gets the same active mark, and the same
        // `clearFilters` on its link (see the healthy-view comment
        // above for why).
        const active = sameRow(activeRow, { kind: "saved-view", id: v.id });
        const row = (
          <Link
            to="/list"
            search={prev => ({ ...clearSort(clearFilters(prev)), view: v.id })}
            title={`${v.name} — broken: ${v.error}`}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
            data-broken-view={v.id}
          >
            <ItemShell active={active} collapsed={collapsed} title={v.name}>
              <span
                aria-hidden="true"
                className="w-4 shrink-0 text-center text-danger-fg"
              >
                ⚠
              </span>
              {!collapsed ? (
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="truncate text-text-secondary">{v.name}</span>
                  <span className="shrink-0 text-[0.7857rem] text-text-tertiary">(broken)</span>
                </span>
              ) : null}
            </ItemShell>
          </Link>
        );
        if (collapsed) return <div key={v.id}>{row}</div>;
        return (
          <div
            key={v.id}
            // UI-16c: a badge-ending row (built-in filters) insets its
            // trailing content by `ItemShell`'s own `px-2.5`, but the
            // kebab here is a SIBLING of `ItemShell`, outside that
            // padding — so it sat flush against the sidebar edge, 8.75px
            // further right than a badge's edge, and the column's right
            // side zig-zagged row to row. `pr-2.5` matches that inset so
            // every row kind ends at the same x.
            className="flex items-center rounded-md pr-2.5 hover:bg-bg-muted"
            data-broken-view-row={v.id}
          >
            {row}
            <RowActions
              size="sm"
              label={`Actions for saved filter "${v.name}"`}
              actions={[
                // VUE-22's fix path: Edit opens the dialog on the broken
                // entry's id + name with NO filters (K102 — its stored
                // filters did not load, so there is nothing faithful to
                // seed), AND with the broken context so the dialog can
                // show the parse error plus the YAML still on disk and
                // require an explicit confirmation before it replaces it.
                // Passing `broken` is what stops Edit → Save from
                // silently overwriting `rawText` with an empty list.
                {
                  label: "Edit",
                  testId: "broken-view-edit",
                  onSelect: () => {
                    setDialog({
                      mode: "edit",
                      view: { id: v.id, name: v.name, filters: [] },
                      broken: {
                        error: v.error,
                        rawText: v.rawText,
                        ...(v.position !== undefined ? { position: v.position } : {}),
                      },
                    });
                  },
                },
                // No Pin: a broken view is being fixed, not promoted. Delete
                // removes it from queries.yaml like any other.
                { label: "Delete", testId: "broken-view-delete", danger: true, onSelect: () => { setDialog({ mode: "delete", view: { id: v.id, name: v.name, filters: [] }, broken: true }); } },
              ]}
            />
          </div>
        );
      })}

      {!collapsed && vanished.map(v => (
        // Not `role="alert"`: this is an explanation, not an error
        // (SHL-32's last bullet), and a config the user edited
        // themselves must not fire a toast.
        <div
          key={v.id}
          role="status"
          data-vanished-view={v.id}
          className="flex items-start gap-1 px-2.5 py-1 text-[0.8571rem] text-text-tertiary"
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
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}

      {!collapsed ? (
        <button
          ref={newFilterRef}
          type="button"
          data-testid="sidebar-new-filter"
          onClick={() => { setDialog({ mode: "create" }); }}
          title="Create a saved view"
          className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[0.9286rem] font-medium text-accent hover:bg-bg-muted"
        >
          <span className="w-4 shrink-0 text-center">+</span>
          New view
        </button>
      ) : null}

      {/* The create / edit / delete dialogs live INSIDE the group (not
          hoisted to a provider): Modal renders inline, so for the mobile
          drawer's focus trap and DOM containment to hold, the dialog must
          stay within the drawer's subtree. Create + edit share
          ViewFormDialog (existing ⇒ edit, VUE-40/VUE-41); delete routes
          through DeleteViewDialog. */}
      {dialog?.mode === "create" ? (
        // Create mode: empty name + one blank simple-filter row, so a
        // view created from the sidebar starts in the human-readable
        // picker (K102) rather than in a DSL box.
        <ViewFormDialog onClose={() => { setDialog(null); }} />
      ) : null}
      {dialog?.mode === "edit" ? (
        <ViewFormDialog
          existing={dialog.view}
          {...(dialog.broken !== undefined ? { broken: dialog.broken } : {})}
          onClose={() => { setDialog(null); }}
        />
      ) : null}
      {dialog?.mode === "delete" ? (
        <DeleteViewDialog
          name={dialog.view.name}
          pinned={pins.includes(dialog.view.id)}
          returnFocusTo={newFilterRef}
          {...(del.isError ? { dataState: dataStateOf(del.error) } : {})}
          onCancel={() => { del.reset(); setDialog(null); }}
          onConfirm={() => { confirmDelete(dialog.view, dialog.broken === true); }}
          {...(del.isError
            ? { onRetry: () => { confirmDelete(dialog.view, dialog.broken === true); } }
            : {})}
        />
      ) : null}
    </SectionShell>
  );
}

/**
 * The six built-in filters (Assigned to me, Reported by me, Mentions
 * me, Due this week, Overdue, High priority), in their own section
 * headed "Filters" (K125, amended Ken 2026-09-24).
 *
 * Split out of what was `SavedFiltersGroup` (now `SavedViewsGroup`
 * above) specifically so the Customize-sidebar panel's "Filters" row —
 * which the panel already let the user move/hide as one unit — moves
 * and hides a REAL section here. Before this split, the built-ins
 * always rendered inside the saved-views section regardless of the
 * `filters` group's position in the stored top-level order, so
 * reordering "Filters" in the panel changed nothing visible: Ken's
 * original complaint about the pre-K125 customiser ("so its not
 * connected" to the sidebar) reproduced under the very shape the K125
 * ruling was meant to fix. Now `filters`'s resolved position (from
 * `resolveSidebarOrder` against the group catalog, same mechanism every
 * other section uses) is this section's actual position, and hiding
 * the group here (`filtersGroupHidden`) removes the section entirely —
 * not just its contents — matching `MilestonesGroup`/`SprintsGroup`/etc.
 */
function FiltersGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const workflow = useWorkflow();
  const priorities = workflow.data?.priorities;
  const ctx = { currentUserId, today, priorities };
  const counts = useBuiltinCounts(BUILTIN_FILTERS, ctx);
  const activeRow = useActiveRow(currentUserId, today);
  const settings = useUserSettings();
  // SHL-45: the built-in filters can be hidden/reordered by the same
  // per-user setting. `resolveSidebarOrder` against the filter catalog
  // gives their order + hidden flags; a hidden filter renders nothing.
  const storedGroups = readSidebarGroups(settings.data?.settings);
  const filterOrder = resolveSidebarOrder(storedGroups, [...SIDEBAR_FILTER_IDS]);
  const filterById = new Map(BUILTIN_FILTERS.map(f => [f.id, f]));
  // K125: the "Filters" group in the Customize-sidebar panel is one
  // hideable unit — hiding it drops the WHOLE section (not just its
  // contents), regardless of each built-in's own hidden flag (which the
  // panel still lets the user set independently for when the group is
  // back on). `SidebarGroups` (the caller) also skips rendering when
  // `resolveSidebarOrder` marks this group hidden — this local check is
  // for the per-filter contents WITHIN a visible section.
  const filtersGroupHidden = (storedGroups.hidden ?? []).includes("filters");
  const orderedFilters = filtersGroupHidden
    ? []
    : filterOrder
        .filter(f => !f.hidden)
        .flatMap(f => {
          const def = filterById.get(f.id);
          return def === undefined ? [] : [def];
        });

  // A hidden group still renders nothing, but the SECTION itself must
  // also not appear — an empty "Filters" heading with no rows would be
  // a worse signal than no heading at all (SHL-9's carve-out is for a
  // group with genuinely no entries, not one its own user switched off).
  if (filtersGroupHidden) return null;

  return (
    <SectionShell id="filters" label="Filters" collapsed={collapsed}>
      {orderedFilters.map(f => {
        const search = f.resolve(ctx);
        const count = counts[f.id]?.count;
        const countPending = counts[f.id]?.isLoading === true;
        const countUnavailable = counts[f.id]?.unavailable === true;
        // Non-resolvable built-ins (a user filter with no current user, or
        // "High priority" on a scale that cannot express it) render as
        // inert text, not a link.
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
                <span className="flex w-4 shrink-0 justify-center">
                  <Icon name={f.icon} size={14} />
                </span>
                {!collapsed ? <span className="truncate">{f.label}</span> : null}
              </ItemShell>
            </div>
          );
        }
        const active = sameRow(activeRow, { kind: "builtin", id: f.id });
        return (
          <Link
            key={f.id}
            to="/list"
            search={prev => ({ ...clearSort(clearFilters(prev)), ...search })}
            title={f.label}
            className="no-underline"
          >
            <ItemShell active={active} collapsed={collapsed} title={f.label}>
              <span className="flex w-4 shrink-0 justify-center">
                <Icon name={f.icon} size={14} />
              </span>
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
    </SectionShell>
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

function MilestonesGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const milestones = useMilestones();
  // K118: this group previously computed no active state at all.
  const activeRow = useActiveRow(currentUserId, today);
  const items = (milestones.data?.items ?? []).filter(m => m.archived !== true);
  const failed = hasFailed(milestones);
  // K100: the same MilestoneEditDialog the Settings panel and the
  // /milestones view render. Only the id is held; the current
  // MilestoneDef is looked up from live data, so an external edit shows.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingMilestone = items.find(m => m.id === editingId) ?? null;
  // K105: "+ New milestone" opens the shared MilestoneEditDialog in place.
  const [creating, setCreating] = useState(false);
  return (
    <>
    <SectionShell id="milestones" label="Milestones" collapsed={collapsed}>
      {/* M4.9: the group's entries filter the list to one milestone;
          this opens the milestones *progress* view, which is a
          different surface and otherwise reachable only by URL. */}
      {!collapsed && (
        <Link to="/milestones" data-testid="sidebar-milestones-link" className="no-underline">
          <ItemShell
            active={sameRow(activeRow, { kind: "milestones" })}
            collapsed={collapsed}
            title="All milestones"
          >
            {/* UI-20: the `flag` type glyph was decoration — milestones
                are a small, name-discriminated section that never
                scrolls apart from its heading in practice (per-section
                collapse is the escape hatch for a long one), so a
                per-row mark said nothing a screen reader or scan of the
                heading didn't. No empty slot is reserved — see the
                project row above: a blank 16px column reads as a hole
                (Ken, 2026-09-23). */}
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
      {items.map(m => {
        const row = (
          // K105 / U14 merge: a milestone click goes to the milestone
          // DETAIL page (/milestones/$id) — the superset surface (progress
          // + the milestone's task table + in-place edit) — NOT the generic
          // filtered list (/list?milestone=), so the sidebar and the "All
          // milestones" list reach the same one UI.
          <Link
            to="/milestones/$id"
            params={{ id: m.id }}
            title={m.name}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell
              active={sameRow(activeRow, { kind: "milestone", id: m.id })}
              collapsed={collapsed}
              title={m.name}
            >
              {/* UI-20: dropped the `flag` type glyph — see the "All
                  milestones" row above for the rationale. No empty slot
                  — a reserved blank column is a visible gap. */}
              {!collapsed ? <span className="truncate">{m.name}</span> : null}
            </ItemShell>
          </Link>
        );
        if (collapsed) return <div key={m.id}>{row}</div>;
        return (
          <div
            key={m.id}
            // UI-16c: a badge-ending row (built-in filters) insets its
            // trailing content by `ItemShell`'s own `px-2.5`, but the
            // kebab here is a SIBLING of `ItemShell`, outside that
            // padding — so it sat flush against the sidebar edge, 8.75px
            // further right than a badge's edge, and the column's right
            // side zig-zagged row to row. `pr-2.5` matches that inset so
            // every row kind ends at the same x.
            className="flex items-center rounded-md pr-2.5 hover:bg-bg-muted"
            data-milestone-row={m.id}
          >
            {row}
            <MilestoneRowActions milestone={m} onEdit={() => { setEditingId(m.id); }} />
          </div>
        );
      })}

      {/* K105: "+ New milestone" opens the shared dialog in place, mirroring
          "+ New project" / "+ New view" — not a deep link to Settings. */}
      {!collapsed && !failed ? (
        <button
          type="button"
          data-testid="sidebar-new-milestone"
          title="New milestone"
          onClick={() => { setCreating(true); }}
          className="w-full text-left no-underline"
        >
          <ItemShell collapsed={collapsed} title="New milestone">
            <span className="w-4 shrink-0 text-center text-accent">+</span>
            <span className="truncate text-accent">New milestone</span>
          </ItemShell>
        </button>
      ) : null}

    </SectionShell>

      {/* Dialogs outside SectionShell so collapsing never unmounts one. */}
      {/* K100: the shared editor, mounted fresh on open so it seeds from
          the current milestone. */}
      {editingMilestone !== null ? (
        <MilestoneEditDialog
          mode="edit"
          existing={editingMilestone}
          onClose={() => { setEditingId(null); }}
        />
      ) : null}
      {creating ? (
        <MilestoneEditDialog
          mode="create"
          onClose={() => { setCreating(false); }}
        />
      ) : null}
    </>
  );
}

/**
 * A milestone row's kebab (K100). Sibling of the row `<Link>`. Edit opens
 * the shared `MilestoneEditDialog`; Archive is a clean single mutation.
 * UI-17 / K105: no "Manage milestones…" deep link — delete (behind the
 * remap picker, panel-owned and not extracted) lives in Settings, reached
 * through the persistent Settings gear (`Footer`, below), not a
 * milestone-scoped menu item.
 */
function MilestoneRowActions({
  milestone,
  onEdit,
}: {
  readonly milestone: MilestoneDef;
  readonly onEdit: () => void;
}) {
  const archive = useArchiveMilestone();
  return (
    <RowActions
      size="sm"
      label={`Actions for milestone "${milestone.name}"`}
      actions={[
        { label: "Edit", testId: "sidebar-milestone-edit", onSelect: onEdit },
        {
          label: "Archive",
          testId: "sidebar-milestone-archive",
          disabled: archive.isPending,
          onSelect: () => { archive.reset(); archive.mutate({ id: milestone.id, archived: true }); },
        },
      ]}
    />
  );
}

function SprintsGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const sprints = useSprints();
  // K118: this group previously computed no active state at all.
  const activeRow = useActiveRow(currentUserId, today);
  // Match the mockup: hide completed sprints from the sidebar.
  const items = (sprints.data?.items ?? []).filter(
    s => s.archived !== true && s.state !== "completed",
  );
  const failed = hasFailed(sprints);
  // K105: edit + create happen in place via the shared SprintEditDialog.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingSprint = (sprints.data?.items ?? []).find(s => s.id === editingId) ?? null;
  const [creating, setCreating] = useState(false);
  return (
    <>
    <SectionShell id="sprints" label="Sprints" collapsed={collapsed}>
      {/* The /sprints overview (all sprints, including completed ones) was
          reachable only by URL — the group's rows filter the list to one
          sprint. Mirrors "All milestones": a top row into the overview
          surface. Sprint editing stays on the /sprints/:id detail page
          (K100), which the overview links to. */}
      {!collapsed && (
        <Link to="/sprints" data-testid="sidebar-sprints-link" className="no-underline">
          <ItemShell
            active={sameRow(activeRow, { kind: "sprints" })}
            collapsed={collapsed}
            title="All sprints"
          >
            {/* UI-20: the `calendar` glyph (itself a fix for the earlier
                shared-`flag` bug) is gone too — a type glyph is
                decoration when the section can't scroll apart from its
                heading, which sprints (1-3 live at a time) never do.
                Item rows below already carry the real per-item mark
                (state colour); the anchor row gets the same empty slot
                and no empty slot is reserved in its place — a blank
                16px column reads as a hole (Ken, 2026-09-23). */}
            <span className="truncate">All sprints</span>
          </ItemShell>
        </Link>
      )}
      {failed && (
        <GroupError collapsed={collapsed} error={sprints.error} onRetry={() => { void sprints.refetch(); }} />
      )}
      {!failed && hasAnswered(sprints) && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No active sprints</GroupEmpty>
      ) : null}
      {items.map(s => {
        const row = (
          <Link
            to="/list"
            // K118: a sprint click is a full replace like every other
            // sidebar row. `clearFilters` (added by this fix) drops a
            // lingering `q`/`view`/`project`/`labels` from whatever was
            // active before — this link used to only ADD `sprint`,
            // which is the same carry-over bug the saved-view link had.
            search={prev => ({ ...clearSort(clearFilters(prev)), sprint: [s.id] })}
            title={`${s.name} (${s.state})`}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell
              active={sameRow(activeRow, { kind: "sprint", id: s.id })}
              collapsed={collapsed}
              title={`${s.name} (${s.state})`}
            >
              {/* Ken, 2026-09-23: drop the dot — it was DERIVED from
                  `state`, not user-assigned, and there are three states
                  (active/completed/future) but the dot only distinguished
                  two, so completed and future rendered identical grey.
                  The chip beside it already names all three correctly.
                  Dropping it also fixes "All sprints" sitting flush while
                  its items were indented by the dot slot — so, unlike the
                  other UI-25 rows, no empty `w-4` slot is kept here either
                  (four other empty slots were removed earlier today for
                  exactly this reason — Ken: "missing gap is ugly"). */}
              {!collapsed ? (
                <>
                  <span className="truncate">{s.name}</span>
                  {/* The sprint's lifecycle state as a plain meta pill —
                      migrated to the B1 Chip so it shares the app's one
                      pill shape/height (K-6). Coloured per state (Ken's
                      follow-up, 2026-09-23): `active` uses the success
                      feedback token the old dot used; `completed` and
                      `future` get the neutral/accent Chip variants so
                      they are distinguishable from each other, which the
                      dot could not do. Colour reinforces the text, which
                      already names the state — not the only signal. */}
                  <span className="ml-auto">
                    <Chip
                      variant={s.state === "future" ? "accent" : "neutral"}
                      className={s.state === "active" ? "text-success-fg" : undefined}
                    >
                      {s.state}
                    </Chip>
                  </span>
                </>
              ) : null}
            </ItemShell>
          </Link>
        );
        // Collapsed rail: icon-only, no room for a kebab (matches the
        // other groups, which also shed their trailing affordance when
        // collapsed).
        if (collapsed) return <div key={s.id}>{row}</div>;
        return (
          <div
            key={s.id}
            // UI-16c: a badge-ending row (built-in filters) insets its
            // trailing content by `ItemShell`'s own `px-2.5`, but the
            // kebab here is a SIBLING of `ItemShell`, outside that
            // padding — so it sat flush against the sidebar edge, 8.75px
            // further right than a badge's edge, and the column's right
            // side zig-zagged row to row. `pr-2.5` matches that inset so
            // every row kind ends at the same x.
            className="flex items-center rounded-md pr-2.5 hover:bg-bg-muted"
            data-sprint-row={s.id}
          >
            {row}
            <SprintRowActions sprint={s} onEdit={() => { setEditingId(s.id); }} />
          </div>
        );
      })}

      {/* K105: "+ New sprint" opens the shared dialog in place — not the
          Settings page. */}
      {!collapsed && !failed ? (
        <button
          type="button"
          data-testid="sidebar-new-sprint"
          title="New sprint"
          onClick={() => { setCreating(true); }}
          className="w-full text-left no-underline"
        >
          <ItemShell collapsed={collapsed} title="New sprint">
            <span className="w-4 shrink-0 text-center text-accent">+</span>
            <span className="truncate text-accent">New sprint</span>
          </ItemShell>
        </button>
      ) : null}

    </SectionShell>

      {/* Dialogs outside SectionShell so collapsing never unmounts one. */}
      {editingSprint !== null ? (
        <SprintEditDialog
          mode="edit"
          existing={editingSprint}
          onClose={() => { setEditingId(null); }}
        />
      ) : null}
      {creating ? (
        <SprintEditDialog
          mode="create"
          onClose={() => { setCreating(false); }}
        />
      ) : null}
    </>
  );
}

/**
 * A sprint row's kebab (K100). Sibling of the row `<Link>` — a `<button>`
 * inside an `<a>` is invalid HTML. Sprint *editing* lives on the
 * `/sprints/:key` detail page (K100: no sprint edit dialog), so this only
 * navigates: "Open sprint" to that detail page (where Edit lives). The
 * row's own click still filters the list by this sprint. UI-17 / K105: no
 * "Manage sprints…" deep link — the roster-level Settings panel is
 * reached through the persistent Settings gear (`Footer`, below), not a
 * sprint-scoped menu item.
 *
 * `/sprints/$key` is keyed by the sprint's ULID (route decision V3), so
 * `key` is `sprint.id`.
 */
function SprintRowActions({
  sprint,
  onEdit,
}: {
  readonly sprint: SprintDef;
  readonly onEdit: () => void;
}) {
  const navigate = useNavigate();
  return (
    <RowActions
      size="sm"
      label={`Actions for sprint "${sprint.name}"`}
      actions={[
        // K105: edit in place via the shared dialog (was navigate-only).
        { label: "Edit", testId: "sidebar-sprint-edit", onSelect: onEdit },
        {
          label: "Open sprint",
          testId: "sidebar-sprint-open",
          onSelect: () => { void navigate({ to: "/sprints/$key", params: { key: sprint.id } }); },
        },
      ]}
    />
  );
}

function LabelsGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const labels = useLabels();
  // K118: this group previously computed no active state at all.
  const activeRow = useActiveRow(currentUserId, today);
  const items = (labels.data?.items ?? []).filter(l => l.archived !== true);
  const failed = hasFailed(labels);
  // K100: the same LabelEditDialog the Settings panel renders. Only the
  // id is held; the current LabelDef is looked up from live data.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingLabel = items.find(l => l.id === editingId) ?? null;
  // K105: "+ New label" opens the shared LabelEditDialog in place.
  const [creating, setCreating] = useState(false);
  return (
    <>
    <SectionShell id="labels" label="Labels" collapsed={collapsed}>
      {failed && (
        <GroupError collapsed={collapsed} error={labels.error} onRetry={() => { void labels.refetch(); }} />
      )}
      {!failed && hasAnswered(labels) && items.length === 0 ? (
        <GroupEmpty collapsed={collapsed}>No labels yet</GroupEmpty>
      ) : null}
      {items.map(l => {
        const row = (
          <Link
            to="/list"
            // K118: a label click is a full replace like every other
            // sidebar row. `clearFilters` (added by this fix) drops a
            // lingering `q`/`view`/`project`/`sprint` from whatever was
            // active before — this link used to only ADD `labels`,
            // which is the same carry-over bug the saved-view link had.
            search={prev => ({ ...clearSort(clearFilters(prev)), labels: [l.id] })}
            title={l.name}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell
              active={sameRow(activeRow, { kind: "label", id: l.id })}
              collapsed={collapsed}
              title={l.name}
            >
              {/* UI-25: wrapped in the same `w-4` slot the icon rows use.
                  Content unchanged — `EntityColorDot` is the model mark
                  (per-item shape, per-item value, backed by a stored
                  field) the other sections are measured against. */}
              <span className="flex w-4 shrink-0 justify-center">
                <EntityColorDot color={l.color} />
              </span>
              {!collapsed ? <span className="truncate">{l.name}</span> : null}
            </ItemShell>
          </Link>
        );
        if (collapsed) return <div key={l.id}>{row}</div>;
        return (
          <div
            key={l.id}
            // UI-16c: a badge-ending row (built-in filters) insets its
            // trailing content by `ItemShell`'s own `px-2.5`, but the
            // kebab here is a SIBLING of `ItemShell`, outside that
            // padding — so it sat flush against the sidebar edge, 8.75px
            // further right than a badge's edge, and the column's right
            // side zig-zagged row to row. `pr-2.5` matches that inset so
            // every row kind ends at the same x.
            className="flex items-center rounded-md pr-2.5 hover:bg-bg-muted"
            data-label-row={l.id}
          >
            {row}
            <LabelRowActions label={l} onEdit={() => { setEditingId(l.id); }} />
          </div>
        );
      })}

      {/* K105: "+ New label" opens the shared dialog in place. */}
      {!collapsed && !failed ? (
        <button
          type="button"
          data-testid="sidebar-new-label"
          title="New label"
          onClick={() => { setCreating(true); }}
          className="w-full text-left no-underline"
        >
          <ItemShell collapsed={collapsed} title="New label">
            <span className="w-4 shrink-0 text-center text-accent">+</span>
            <span className="truncate text-accent">New label</span>
          </ItemShell>
        </button>
      ) : null}

    </SectionShell>

      {/* Dialogs outside SectionShell so collapsing never unmounts one. */}
      {/* K100: the shared editor, mounted fresh on open so it seeds from
          the current label. */}
      {editingLabel !== null ? (
        <LabelEditDialog
          mode="edit"
          existing={editingLabel}
          onClose={() => { setEditingId(null); }}
        />
      ) : null}
      {creating ? (
        <LabelEditDialog
          mode="create"
          existingLabels={labels.data?.items ?? []}
          onClose={() => { setCreating(false); }}
        />
      ) : null}
    </>
  );
}

/**
 * A label row's kebab (K100). Sibling of the row `<Link>`. Edit opens the
 * shared `LabelEditDialog`; Archive is a clean single mutation. UI-17 /
 * K105: no "Manage labels…" deep link — a full Delete (behind the remap
 * picker, `RemapDeleteDialog`, panel-owned and not extracted) lives in
 * Settings, reached through the persistent Settings gear (`Footer`,
 * below), not a label-scoped menu item.
 */
function LabelRowActions({
  label,
  onEdit,
}: {
  readonly label: LabelDef;
  readonly onEdit: () => void;
}) {
  const archive = useArchiveLabel();
  return (
    <RowActions
      size="sm"
      label={`Actions for label "${label.name}"`}
      actions={[
        { label: "Edit", testId: "sidebar-label-edit", onSelect: onEdit },
        {
          label: "Archive",
          testId: "sidebar-label-archive",
          disabled: archive.isPending,
          onSelect: () => { archive.mutate({ id: label.id, archived: true }); },
        },
      ]}
    />
  );
}

function RecentsGroup({
  collapsed,
  currentUserId,
  today,
}: {
  collapsed: boolean;
  currentUserId: string | null;
  today: string;
}) {
  const recents = useRecents();
  // K118: this group previously computed no active state at all.
  const activeRow = useActiveRow(currentUserId, today);
  const items = recents.data?.items ?? [];
  const failed = hasFailed(recents);
  if (collapsed) return null;
  return (
    <SectionShell id="recents" label="Recently viewed" collapsed={collapsed}>
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
            <ItemShell
              active={sameRow(activeRow, { kind: "recent", key: t.key })}
              collapsed={collapsed}
              title={t.title}
            >
              <span className="shrink-0 text-[0.7143rem] text-text-tertiary">{t.key}</span>
              <span className="truncate">{t.title}</span>
            </ItemShell>
          </Link>
        ))
      )}
    </SectionShell>
  );
}

/**
 * The pinned footer: a "Customize sidebar" affordance and the Settings
 * link (SHL-11).
 *
 * ## Customize sidebar (K100 point-of-use, A244)
 *
 * The sidebar's own layout config (which built-in groups show, their
 * order, hidden built-in filters) lived only in Settings → Sidebar
 * groups. K100 wants config editable *from where it is used*, in-place
 * where a shared editor exists. `SidebarGroupsPanel` is exactly that: a
 * self-contained editor owning its own `useUserSettings` read and
 * `useUserSettingsMutation` write. So this is the K100 **in-place** tier,
 * not a deep link — the gear opens the SAME `SidebarGroupsPanel` the
 * Settings section renders, inside a `ResponsiveDialog` (A273): a centered
 * dialog on desktop, a bottom drawer on mobile. It was a bare `Sheet`,
 * which made it a bottom drawer even on desktop — wrong there, per Ken.
 * No second source of truth: an edit made here writes the same
 * `sidebar_groups` user setting through the same mutation. The panel still
 * carries its own note pointing at Settings, and the Settings link below
 * keeps the full surface reachable.
 *
 * Kept out of the way on a narrow/overlay viewport (`overlay`): the
 * sidebar is a temporary drawer there, and a nested config sheet over a
 * drawer is fiddly on a phone — the setting stays reachable from Settings.
 */
function Footer({ collapsed, overlay }: { collapsed: boolean; overlay: boolean }) {
  const [customizing, setCustomizing] = useState(false);
  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border-subtle pt-2">
      {!overlay ? (
        <>
          {collapsed ? (
            // Collapsed rail: icon-only, centred to match the other rail
            // rows. Still a real, focusable button (keyboard-reachable).
            <IconButton
              aria-label="Customize sidebar"
              testId="sidebar-customize"
              onClick={() => { setCustomizing(true); }}
              className="mx-auto"
            >
              <Icon name="settings" />
            </IconButton>
          ) : (
            <button
              type="button"
              data-testid="sidebar-customize"
              onClick={() => { setCustomizing(true); }}
              title="Customize sidebar"
              className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[0.9286rem] font-medium text-text-secondary hover:bg-bg-muted hover:text-text-primary"
            >
              <span className="flex w-4 shrink-0 justify-center">
                <Icon name="settings" size={16} />
              </span>
              <span>Customize sidebar</span>
            </button>
          )}
        </>
      ) : null}

      <Link to="/settings/$section" params={{ section: DEFAULT_SECTION }} title="Settings" className="no-underline">
        <ItemShell collapsed={collapsed} title="Settings">
          <SettingsIcon />
          {!collapsed ? <span>Settings</span> : null}
        </ItemShell>
      </Link>

      {customizing ? (
        // K100 in-place: the exact Settings component, in a responsive
        // overlay. `embedded` only suppresses the panel's own <h1> (the
        // overlay supplies the title) — the editor, its mutation and its
        // validation are the same.
        <ResponsiveDialog
          title="Customize sidebar"
          testId="sidebar-customize-sheet"
          onClose={() => { setCustomizing(false); }}
        >
          <SidebarGroupsPanel embedded />
        </ResponsiveDialog>
      ) : null}
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
  // CMT-10: "Mentions me" is no longer deferred — it resolves to
  // `comment_mentions = currentUser()`. It is only inert when there is no
  // current user, which the generic "not available yet" reason (shared
  // with "Assigned to me") already covers.
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
 * K125 (Ken, 2026-09-24) removed the view switcher's carry-across:
 * `CARRY_FILTER_KEYS` and `carryFilters` (the 2026-09-20 cross-view
 * scope fix for List/Board/Timeline's OWN links) are gone — a view-link
 * click now clears the sidebar-driven scope like every other sidebar
 * row (see the K125 comment above `ViewSwitcher`). The `viewTo`
 * mechanism in `ProjectsGroup` (a PROJECT click staying on the current
 * view) is a separate thing and is preserved.
 */

/** The three main-pane views the filter scope carries between. */
const VIEW_PATHS = ["/list", "/board", "/timeline"] as const;

/** Is `pathname` one of the filter-bearing main-pane views? */
function isView(pathname: string): boolean {
  return (VIEW_PATHS as readonly string[]).includes(pathname);
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

function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z" /></svg>;
}
