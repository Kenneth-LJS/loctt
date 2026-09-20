import type { LabelDef, MilestoneDef, ProjectDef, SavedQuery, SidebarGroupId, SprintDef, UserSettings } from "@loctt/contracts";
import { SIDEBAR_FILTER_IDS, SIDEBAR_GROUP_IDS } from "@loctt/contracts";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

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
import { DeleteViewDialog } from "../settings/DeleteViewDialog.tsx";
import { LabelEditDialog } from "../settings/LabelEditDialog.tsx";
import { MilestoneEditDialog } from "../settings/MilestoneEditDialog.tsx";
import { ProjectEditDialog } from "../settings/ProjectEditDialog.tsx";
import { RowActions } from "../settings/RowActions.tsx";
import { DEFAULT_SECTION } from "../settings/sections.ts";
import { readSidebarGroups, resolveSidebarOrder } from "../settings/sidebarGroups.ts";
import { SidebarGroupsPanel } from "../settings/SidebarGroupsPanel.tsx";
import { readSidebarPins } from "../settings/sidebarPins.ts";
import { ViewFormDialog } from "../settings/ViewFormDialog.tsx";
import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";
import { Chip } from "../ui/Chip.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { ICON } from "../ui/icons.ts";
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
    <div className="px-2.5 pb-0.5 pt-1.5 text-[0.7857rem] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
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
        <Link
          key={v.to}
          to={v.to}
          title={v.label}
          className="no-underline"
          // Cross-view scope fix (Ken 2026-09-20): switching views carries
          // the filter scope (q/project/status/…/vf/field.*) so
          // List↔Board↔Timeline show the same tasks, and drops the
          // view-private display params (page/sort/dir/zoom/…) so each view
          // opens at its own default. TanStack's `<Link>` default drops
          // every param, which is what stripped the scope before.
          search={carryFilters}
        >
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

function ProjectsGroup({ collapsed }: { collapsed: boolean }) {
  const projects = useProjects();
  const activeProjects = useRouterState({
    select: s => (s.location.search as { project?: string[] }).project ?? [],
  });
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
          to={viewTo}
          data-testid="project-all"
          // Clears the project facet (and only it — the other filters
          // are left alone, matching a project click). The ambient sort
          // is dropped too (LST-55). Route-aware `to` keeps a click made
          // on the board/timeline on that view (cross-view scope fix).
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
          className="px-2.5 py-1 text-[0.8571rem] text-text-tertiary"
        >
          No projects match “{query.trim()}”
        </div>
      ) : null}

      {visible.map(p => {
        const active = activeProjects.includes(p.id);
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
        // Collapsed rail: icon-only, no room for a kebab (matches the
        // saved-filter rows).
        if (collapsed) return <div key={p.id}>{row}</div>;
        // K100: the kebab is a SIBLING of the <Link> (a <button> inside an
        // <a> is invalid HTML), matching the saved-filter row pattern. Edit
        // opens the shared ProjectEditDialog; Make default / Archive are
        // handled inside that same dialog, so the kebab need only open it —
        // plus a "Manage projects…" deep link so Settings stays discoverable.
        return (
          <div
            key={p.id}
            className="flex items-center rounded-md hover:bg-bg-muted"
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

      {/* "+ New project": creating a project uses the panel-local
          CreateProjectForm (slug/prefix uniqueness checks, not extracted
          into a shared self-contained component), so per K100 this is a
          DEEP LINK to Settings rather than a forked inline create. */}
      {!collapsed && !failed ? (
        <Link
          to="/settings/$section"
          params={{ section: "projects" }}
          data-testid="sidebar-new-project"
          title="New project"
          className="no-underline"
        >
          <ItemShell collapsed={collapsed} title="New project">
            <span className="w-4 shrink-0 text-center text-accent">+</span>
            <span className="truncate text-accent">New project</span>
          </ItemShell>
        </Link>
      ) : null}

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
    </div>
  );
}

/**
 * A project row's kebab (K100). A sibling of the row `<Link>` — a
 * `<button>` inside an `<a>` is invalid HTML — carrying Edit (opens the
 * shared `ProjectEditDialog`, where Make default / Archive also live) and
 * a "Manage projects…" deep link so Settings stays discoverable.
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
  const navigate = useNavigate();
  const archive = useArchiveProject();
  const setDefault = useSetDefaultProject();
  const archived = project.archived === true;
  return (
    <RowActions
      size="sm"
      label={`Actions for project "${project.name}"`}
      actions={[
        { label: "Edit…", testId: "sidebar-project-edit", onSelect: onEdit },
        {
          label: isDefault ? "Default (current)" : "Make default",
          testId: "sidebar-project-set-default",
          disabled: isDefault || archived || setDefault.isPending,
          title: archived ? "An archived project cannot be the default." : undefined,
          onSelect: () => { setDefault.reset(); setDefault.mutate({ id: project.id }); },
        },
        {
          label: archived ? "Unarchive" : "Archive",
          testId: "sidebar-project-archive",
          disabled: archive.isPending,
          onSelect: () => { archive.reset(); archive.mutate({ id: project.id, archived: !archived }); },
        },
        {
          label: "Manage projects…",
          testId: "sidebar-project-manage",
          onSelect: () => { void navigate({ to: "/settings/$section", params: { section: "projects" } }); },
        },
      ]}
    />
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
  const saveSettings = useUserSettingsMutation();
  const del = useDeleteView();
  // The saved-filter dialog state, mirroring `SavedViewsPanel`'s
  // discriminated union: `null` closed, or one of create / edit / delete.
  // A single state (rather than a bare `creating` boolean) lets the same
  // group host Edit… and Delete… launched from a row's kebab as well as
  // the "+ New filter…" create.
  //
  // Edit accepts a `SavedQuery` or the `{id,name,query}` picked from a
  // `BrokenSavedQuery` (VUE-22's fix path) — the two are not assignable to
  // one another, so the edit target is stored as the minimal shape
  // `ViewFormDialog` actually reads. `conditions` is carried when present
  // (a valid view) so the dialog seeds the visual builder from structure;
  // a broken view omits it and the dialog opens Advanced on the raw query.
  type EditTarget = Pick<SavedQuery, "id" | "name" | "query"> & {
    readonly conditions?: SavedQuery["conditions"];
  };
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; view: EditTarget }
    | { mode: "delete"; view: EditTarget }
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
   * Two things happen before the DELETE, both to avoid telling the user
   * about a change they just made:
   *  - `dismiss(view.id)` so `useVanishedViews` does not, on the refetch,
   *    announce "«name» was removed from queries.yaml" for this deliberate
   *    deletion (SHL-32 is for a view that vanished *without* the user's
   *    action here);
   *  - if the view is pinned, drop the pin in the same settings write, the
   *    same pattern `SidebarPinsPanel` uses — leaving it to the pins sweep
   *    would surface a "removed because it no longer exists" notice for a
   *    deletion already confirmed.
   */
  const confirmDelete = (view: EditTarget): void => {
    dismiss(view.id);
    if (pins.includes(view.id) && settings.data !== undefined) {
      saveSettings.mutate({
        ...settings.data.settings,
        sidebar_pins: pins.filter(p => p !== view.id),
      } as UserSettings);
    }
    del.mutate({ id: view.id });
    setDialog(null);
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
        return (
          <Link
            key={f.id}
            to="/list"
            search={prev => ({ ...clearSort(clearFilters(prev)), ...search })}
            title={f.label}
            className="no-underline"
          >
            <ItemShell collapsed={collapsed} title={f.label}>
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

      {userViews.map(v => {
        const row = (
          <Link
            to="/list"
            search={prev => ({ ...clearSort(prev), view: v.id })}
            title={v.name}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell collapsed={collapsed} title={v.name}>
              <span className="w-4 shrink-0 text-center text-text-tertiary">{ICON.star}</span>
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
            className="flex items-center rounded-md hover:bg-bg-muted"
            data-view-row={v.id}
          >
            {row}
            <RowActions
              size="sm"
              label={`Actions for saved filter "${v.name}"`}
              actions={[
                { label: "Edit…", testId: "view-edit", onSelect: () => { setDialog({ mode: "edit", view: v }); } },
                {
                  label: pins.includes(v.id) ? "Unpin" : "Pin to top",
                  testId: "view-pin",
                  onSelect: () => { togglePin(v); },
                },
                { label: "Delete…", testId: "view-delete", danger: true, onSelect: () => { setDialog({ mode: "delete", view: v }); } },
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
        const row = (
          <Link
            to="/list"
            search={prev => ({ ...clearSort(prev), view: v.id })}
            title={`${v.name} — broken: ${v.error}`}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
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
            className="flex items-center rounded-md hover:bg-bg-muted"
            data-broken-view-row={v.id}
          >
            {row}
            <RowActions
              size="sm"
              label={`Actions for saved filter "${v.name}"`}
              actions={[
                // VUE-22's fix path: Edit… opens the editor pre-populated
                // from the BrokenSavedQuery. Its raw `{id,name,query}` is
                // not a SavedQuery (a broken entry has no `sort`/`display`
                // and cannot be one), so only those three fields are passed.
                { label: "Edit…", testId: "broken-view-edit", onSelect: () => { setDialog({ mode: "edit", view: { id: v.id, name: v.name, query: v.query } }); } },
                // No Pin: a broken view is being fixed, not promoted. Delete
                // removes it from queries.yaml like any other.
                { label: "Delete…", testId: "broken-view-delete", danger: true, onSelect: () => { setDialog({ mode: "delete", view: { id: v.id, name: v.name, query: v.query } }); } },
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
          New filter…
        </button>
      ) : null}

      {/* The create / edit / delete dialogs live INSIDE the group (not
          hoisted to a provider): Modal renders inline, so for the mobile
          drawer's focus trap and DOM containment to hold, the dialog must
          stay within the drawer's subtree. Create + edit share
          ViewFormDialog (existing ⇒ edit, VUE-40/VUE-41); delete routes
          through DeleteViewDialog. */}
      {dialog?.mode === "create" ? (
        // Create mode: empty name + query with the advanced query editor,
        // so a view created from the sidebar carries a typed query (VUE-40)
        // rather than the fixed `archived != true` of the old dialog.
        <ViewFormDialog onClose={() => { setDialog(null); }} />
      ) : null}
      {dialog?.mode === "edit" ? (
        <ViewFormDialog existing={dialog.view} onClose={() => { setDialog(null); }} />
      ) : null}
      {dialog?.mode === "delete" ? (
        <DeleteViewDialog
          name={dialog.view.name}
          pinned={pins.includes(dialog.view.id)}
          returnFocusTo={newFilterRef}
          onCancel={() => { setDialog(null); }}
          onConfirm={() => { confirmDelete(dialog.view); }}
        />
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
  // K100: the same MilestoneEditDialog the Settings panel and the
  // /milestones view render. Only the id is held; the current
  // MilestoneDef is looked up from live data, so an external edit shows.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingMilestone = items.find(m => m.id === editingId) ?? null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Milestones</GroupLabel>
      {/* M4.9: the group's entries filter the list to one milestone;
          this opens the milestones *progress* view, which is a
          different surface and otherwise reachable only by URL. */}
      {!collapsed && (
        <Link to="/milestones" data-testid="sidebar-milestones-link" className="no-underline">
          <ItemShell collapsed={collapsed} title="All milestones">
            <span className="flex w-4 shrink-0 justify-center text-text-tertiary">
              <Icon name="flag" size={14} />
            </span>
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
          <Link
            to="/list"
            search={prev => ({ ...clearSort(prev), milestone: [m.id] })}
            title={m.name}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell collapsed={collapsed} title={m.name}>
              <span className="flex w-4 shrink-0 justify-center text-text-tertiary">
                <Icon name="flag" size={14} />
              </span>
              {!collapsed ? <span className="truncate">{m.name}</span> : null}
            </ItemShell>
          </Link>
        );
        if (collapsed) return <div key={m.id}>{row}</div>;
        return (
          <div
            key={m.id}
            className="flex items-center rounded-md hover:bg-bg-muted"
            data-milestone-row={m.id}
          >
            {row}
            <MilestoneRowActions milestone={m} onEdit={() => { setEditingId(m.id); }} />
          </div>
        );
      })}

      {/* K100: the shared editor, mounted fresh on open so it seeds from
          the current milestone. */}
      {editingMilestone !== null ? (
        <MilestoneEditDialog
          mode="edit"
          existing={editingMilestone}
          onClose={() => { setEditingId(null); }}
        />
      ) : null}
    </div>
  );
}

/**
 * A milestone row's kebab (K100). Sibling of the row `<Link>`. Edit opens
 * the shared `MilestoneEditDialog`; Archive is a clean single mutation;
 * "Manage milestones…" deep-links to Settings (delete lives there, behind
 * the remap picker, which is panel-owned and not extracted).
 */
function MilestoneRowActions({
  milestone,
  onEdit,
}: {
  readonly milestone: MilestoneDef;
  readonly onEdit: () => void;
}) {
  const navigate = useNavigate();
  const archive = useArchiveMilestone();
  const archived = milestone.archived === true;
  return (
    <RowActions
      size="sm"
      label={`Actions for milestone "${milestone.name}"`}
      actions={[
        { label: "Edit…", testId: "sidebar-milestone-edit", onSelect: onEdit },
        {
          label: archived ? "Unarchive" : "Archive",
          testId: "sidebar-milestone-archive",
          disabled: archive.isPending,
          onSelect: () => { archive.reset(); archive.mutate({ id: milestone.id, archived: !archived }); },
        },
        {
          label: "Manage milestones…",
          testId: "sidebar-milestone-manage",
          onSelect: () => { void navigate({ to: "/settings/$section", params: { section: "milestones" } }); },
        },
      ]}
    />
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
      {/* The /sprints overview (all sprints, including completed ones) was
          reachable only by URL — the group's rows filter the list to one
          sprint. Mirrors "All milestones": a top row into the overview
          surface. Sprint editing stays on the /sprints/:id detail page
          (K100), which the overview links to. */}
      {!collapsed && (
        <Link to="/sprints" data-testid="sidebar-sprints-link" className="no-underline">
          <ItemShell collapsed={collapsed} title="All sprints">
            <span className="flex w-4 shrink-0 justify-center text-text-tertiary">
              <Icon name="flag" size={14} />
            </span>
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
            search={prev => ({ ...clearSort(prev), sprint: [s.id] })}
            title={`${s.name} (${s.state})`}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
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
        );
        // Collapsed rail: icon-only, no room for a kebab (matches the
        // other groups, which also shed their trailing affordance when
        // collapsed).
        if (collapsed) return <div key={s.id}>{row}</div>;
        return (
          <div
            key={s.id}
            className="flex items-center rounded-md hover:bg-bg-muted"
            data-sprint-row={s.id}
          >
            {row}
            <SprintRowActions sprint={s} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A sprint row's kebab (K100). Sibling of the row `<Link>` — a `<button>`
 * inside an `<a>` is invalid HTML. Sprint *editing* lives on the
 * `/sprints/:key` detail page (K100: no sprint edit dialog), so this only
 * navigates: "Open sprint" to that detail page (where Edit lives) and
 * "Manage sprints…" to the Settings panel that manages the roster. The
 * row's own click still filters the list by this sprint.
 *
 * `/sprints/$key` is keyed by the sprint's ULID (route decision V3), so
 * `key` is `sprint.id`.
 */
function SprintRowActions({ sprint }: { readonly sprint: SprintDef }) {
  const navigate = useNavigate();
  return (
    <RowActions
      size="sm"
      label={`Actions for sprint "${sprint.name}"`}
      actions={[
        {
          label: "Open sprint",
          testId: "sidebar-sprint-open",
          onSelect: () => { void navigate({ to: "/sprints/$key", params: { key: sprint.id } }); },
        },
        {
          label: "Manage sprints…",
          testId: "sidebar-sprint-manage",
          onSelect: () => { void navigate({ to: "/settings/$section", params: { section: "sprints" } }); },
        },
      ]}
    />
  );
}

function LabelsGroup({ collapsed }: { collapsed: boolean }) {
  const labels = useLabels();
  const items = (labels.data?.items ?? []).filter(l => l.archived !== true);
  const failed = hasFailed(labels);
  // K100: the same LabelEditDialog the Settings panel renders. Only the
  // id is held; the current LabelDef is looked up from live data.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingLabel = items.find(l => l.id === editingId) ?? null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupLabel collapsed={collapsed}>Labels</GroupLabel>
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
            search={prev => ({ ...clearSort(prev), labels: [l.id] })}
            title={l.name}
            className={collapsed ? "no-underline" : "min-w-0 flex-1 no-underline"}
          >
            <ItemShell collapsed={collapsed} title={l.name}>
              <ColorDot color={l.color} />
              {!collapsed ? <span className="truncate">{l.name}</span> : null}
            </ItemShell>
          </Link>
        );
        if (collapsed) return <div key={l.id}>{row}</div>;
        return (
          <div
            key={l.id}
            className="flex items-center rounded-md hover:bg-bg-muted"
            data-label-row={l.id}
          >
            {row}
            <LabelRowActions label={l} onEdit={() => { setEditingId(l.id); }} />
          </div>
        );
      })}

      {/* K100: the shared editor, mounted fresh on open so it seeds from
          the current label. */}
      {editingLabel !== null ? (
        <LabelEditDialog
          mode="edit"
          existing={editingLabel}
          onClose={() => { setEditingId(null); }}
        />
      ) : null}
    </div>
  );
}

/**
 * A label row's kebab (K100). Sibling of the row `<Link>`. Edit opens the
 * shared `LabelEditDialog`; Archive is a clean single mutation; a full
 * Delete needs the remap picker (`RemapDeleteDialog`, panel-owned, not
 * extracted), so it is reached through the "Manage labels…" deep link.
 */
function LabelRowActions({
  label,
  onEdit,
}: {
  readonly label: LabelDef;
  readonly onEdit: () => void;
}) {
  const navigate = useNavigate();
  const archive = useArchiveLabel();
  const archived = label.archived === true;
  return (
    <RowActions
      size="sm"
      label={`Actions for label "${label.name}"`}
      actions={[
        { label: "Edit…", testId: "sidebar-label-edit", onSelect: onEdit },
        {
          label: archived ? "Unarchive" : "Archive",
          testId: "sidebar-label-archive",
          disabled: archive.isPending,
          onSelect: () => { archive.mutate({ id: label.id, archived: !archived }); },
        },
        {
          label: "Manage labels…",
          testId: "sidebar-label-manage",
          onSelect: () => { void navigate({ to: "/settings/$section", params: { section: "labels" } }); },
        },
      ]}
    />
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
              <span className="shrink-0 text-[0.7143rem] text-text-tertiary">{t.key}</span>
              <span className="truncate">{t.title}</span>
            </ItemShell>
          </Link>
        ))
      )}
    </div>
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
              <span>Customize sidebar…</span>
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
 * The filter keys that DEFINE the scope and must survive a view switch,
 * so List↔Board↔Timeline show the same set of tasks (the cross-view
 * scope fix, Ken 2026-09-20). Sourced from {@link FILTER_KEYS} so the
 * allow-list cannot drift from the built-in filters, plus the filter
 * params that live outside it: `archived` (a toggle, not a built-in),
 * `labels_match` (the label AND/OR mode), `vf` (the visible-filter set),
 * and any `field.<key>` custom-enum filter. View-private display params
 * (page/sort/dir/edit and the timeline's zoom/grouping/arrows) are
 * dropped, so each view falls back to its own default for what it owns.
 */
const CARRY_FILTER_KEYS = [
  ...FILTER_KEYS, "archived", "labels_match", "vf",
] as const;

/**
 * Keep only the scope-defining filter params when switching between the
 * List, Board and Timeline views — dropping every view-private display
 * param (page/sort/dir/edit and the timeline's zoom/grouping/arrows).
 *
 * TanStack Router's `<Link>` default drops ALL search params, so a plain
 * view-switcher link stripped the user's filters and project scope on
 * every switch. This carries them across while leaving each view free to
 * fall back to its own default for the display params it owns.
 */
function carryFilters(prev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prev)) {
    if ((CARRY_FILTER_KEYS as readonly string[]).includes(k) || k.startsWith("field.")) {
      out[k] = v;
    }
  }
  return out;
}

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
