import type { SidebarItemId } from "@loctt/contracts";

import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";
import { useSidebarLayout } from "../sidebar/useSidebarLayout.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { moveInArray, type SortableMove, SortableTree } from "../ui/SortableTree.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { sidebarGroupsFromLayout, type SidebarLayoutRow, type SidebarViewChild } from "./sidebarGroups.ts";

/**
 * Settings → Personal → Sidebar groups, also opened in place as
 * "Customize sidebar" (SHL-45, K125, K158).
 *
 * Reorders and shows/hides the sidebar's groups and the views inside its
 * Views group. The choice is the per-user `sidebar_groups` setting,
 * persisted through the same `PUT /api/user-settings` merge every personal
 * panel uses.
 *
 * ## K158: one Views list
 *
 * Ken: *"it should be 1. then we can re-order them, and we can hide"*,
 * and, asked where: *"we have the settings, right? where you can reorder
 * things, no?"*. The built-in views and the saved views are the children
 * of one "Views" row, in one list on the shared `ui/SortableTree` (K156),
 * nested one level deep. Each child reorders within the Views group and
 * has its own switch; the Views row itself moves and hides as a unit.
 * This is also where a view hidden from the sidebar's ⋯ comes back.
 *
 * The List / Board / Timeline switcher is labelled "Layouts (List / Board
 * / Timeline)" so it is not confused with Views (K158).
 *
 * ## Switched off disables the children (K125)
 *
 * Ken: *"when an item is switched off, disable switching/reordering its
 * child items too"*. While the Views row's switch is off, every child's
 * switch and handle is disabled (still visible).
 *
 * ## Every write is the full layout
 *
 * A write recomputes the FULL order and hidden list from what the panel
 * shows (`sidebarGroupsFromLayout`), so the file and the panel never
 * drift, and a pre-K158 setting is written in the K158 shape the first
 * time anything changes. Writes wait for the saved views to load: the
 * layout names each one, and writing without them would drop them.
 *
 * ## Show/Hide is a Switch (K125)
 *
 * `ui/Toggle` (`role="switch"`), each labelled "Show {name} in the
 * sidebar", since assistive tech reads a switch's label and state
 * together.
 */

const GROUP_LABELS: Record<Exclude<SidebarLayoutRow, { kind: "views" }>["id"] | "views", string> = {
  layouts: "Layouts (List / Board / Timeline)",
  projects: "Projects",
  views: "Views",
  milestones: "Milestones",
  sprints: "Sprints",
  labels: "Labels",
  recents: "Recently viewed",
};

const BUILTIN_LABELS: ReadonlyMap<string, string> = new Map(BUILTIN_FILTERS.map(f => [f.id, f.label]));

/** One node of the panel's tree: a top-level row, or a Views child. */
interface PanelNode {
  readonly id: SidebarItemId;
  readonly label: string;
  readonly hidden: boolean;
  readonly children?: readonly PanelNode[];
}

function childLabel(c: SidebarViewChild): string {
  return c.kind === "saved" ? c.name : (BUILTIN_LABELS.get(c.id) ?? c.id);
}

function toNodes(rows: readonly SidebarLayoutRow[]): readonly PanelNode[] {
  return rows.map(r =>
    r.kind === "views"
      ? {
          id: "views",
          label: GROUP_LABELS.views,
          hidden: r.hidden,
          children: r.children.map(c => ({ id: c.id, label: childLabel(c), hidden: c.hidden })),
        }
      : { id: r.id, label: GROUP_LABELS[r.id], hidden: r.hidden },
  );
}

/**
 * @param embedded When rendered inside the sidebar's own "Customize
 *   sidebar" dialog (K100 in-place, A244), the dialog supplies the heading,
 *   so the panel omits its own `<h1>`. The same component either way.
 */
export function SidebarGroupsPanel({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const layout = useSidebarLayout();
  const { settings, views } = layout;

  const failure = settings.isError ? settings.error : views.isError ? views.error : null;
  if (failure !== null) {
    return (
      <div>
        {!embedded ? (
          <h1 className="mb-2 text-lg font-semibold text-text-primary">Sidebar groups</h1>
        ) : null}
        <ErrorState
          error={failure}
          onRetry={() => {
            void settings.refetch();
            void views.refetch();
          }}
          context="reading your sidebar layout"
        />
      </div>
    );
  }
  if (settings.data === undefined || !views.isSuccess) {
    return <LoadingState>Loading…</LoadingState>;
  }
  return <GroupsEditor layout={layout} embedded={embedded} />;
}

function GroupsEditor({
  layout,
  embedded,
}: {
  readonly layout: ReturnType<typeof useSidebarLayout>;
  readonly embedded: boolean;
}) {
  const { rows, groups, save, canWrite } = layout;
  const nodes = toNodes(rows);
  const viewsRow = rows.find(r => r.kind === "views");
  const viewsHidden = viewsRow?.hidden ?? false;

  /** Writes `next` in full, keeping what the rows cannot show (archived views). */
  const write = (next: readonly SidebarLayoutRow[]): void => {
    if (!canWrite) return;
    layout.write(sidebarGroupsFromLayout(next, groups));
  };

  const onMove = (m: SortableMove): void => {
    if (m.parentId === null) {
      write(moveInArray(rows, m.fromIndex, m.toIndex));
      return;
    }
    write(rows.map(r =>
      r.kind === "views" ? { ...r, children: moveInArray(r.children, m.fromIndex, m.toIndex) } : r,
    ));
  };

  const toggle = (id: SidebarItemId): void => {
    write(rows.map(r => {
      if (r.kind === "group") return r.id === id ? { ...r, hidden: !r.hidden } : r;
      if (id === "views") return { ...r, hidden: !r.hidden };
      return { ...r, children: r.children.map(c => (c.id === id ? { ...c, hidden: !c.hidden } : c)) };
    }));
  };

  const resetAll = (): void => {
    // Clear the setting entirely: absent means the default order,
    // everything visible.
    layout.write(undefined);
  };

  return (
    <div data-testid="sidebar-groups-panel">
      {!embedded ? (
        <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
          Sidebar groups
        </h1>
      ) : null}
      <SortableTree<PanelNode>
        items={nodes}
        getId={n => n.id}
        getChildren={n => n.children}
        itemName={n => n.label}
        onMove={onMove}
        nesting
        maxDepth={2}
        disabled={level => !canWrite || (level.depth === 1 && viewsHidden)}
        listClassName="space-y-1"
        testIds={{
          row: (n, level) => `${level.depth === 0 ? "sidebar-group" : "sidebar-view"}-row-${n.id}`,
          handle: (n, level) => `${level.depth === 0 ? "sidebar-group" : "sidebar-view"}-handle-${n.id}`,
          toggle: "sidebar-group-expand",
          announcement: "sidebar-group-announcement",
        }}
        rowAttributes={n => ({ id: `row-${n.id}` })}
        renderItem={(n, ctx) => {
          const child = ctx.depth === 1;
          const prefix = child ? "sidebar-view" : "sidebar-group";
          return (
            <div
              data-hidden={n.hidden ? "true" : undefined}
              className={
                "flex items-center gap-2 rounded-md border px-2 py-1.5 "
                + (ctx.moving ? "border-accent bg-bg-muted" : "border-border-subtle bg-bg-surface")
                + (child && ctx.index === 0 ? " mt-1" : "")
              }
            >
              {ctx.leading}
              <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">{n.label}</span>
              <Toggle
                checked={!n.hidden}
                // K125: a child's switch is disabled while the Views group
                // is off, like its handle (`disabled` above).
                disabled={!canWrite || (child && viewsHidden)}
                onChange={() => { toggle(n.id); }}
                data-testid={`${prefix}-toggle-${n.id}`}
                aria-label={`Show ${n.label} in the sidebar`}
              />
            </div>
          );
        }}
      />

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          data-testid="sidebar-groups-reset"
          onClick={resetAll}
          className="inline-flex min-h-[24px] items-center text-[0.8571rem] text-text-secondary underline decoration-border-strong underline-offset-2 hover:text-text-primary"
        >
          Reset to default
        </button>
      </div>

      {save.isError ? (
        // The server's reason + a Retry that re-sends the last write. The
        // write is rolled back on failure, so the list already shows the
        // last saved layout; the context says so.
        <div className="mt-4" data-testid="sidebar-groups-save-error">
          <ErrorState
            error={save.error}
            context="Your changes weren't saved. Showing your last saved layout."
            {...(save.variables !== undefined
              ? { onRetry: () => { save.mutate(save.variables); } }
              : {})}
          />
        </div>
      ) : null}
    </div>
  );
}
