import type { SidebarFilterId, SidebarGroupId, SidebarItemId, UserSettings } from "@loctt/contracts";
import { SIDEBAR_GROUP_IDS } from "@loctt/contracts";

import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";
import { readSidebarGroups, resolveGroupedSidebarOrder } from "./sidebarGroups.ts";

/**
 * Settings → Personal → Sidebar groups (SHL-45, nested K125).
 *
 * Reorders (drag) and shows/hides the built-in sidebar groups and the
 * built-in saved filters. The choice is a per-user setting
 * (`sidebar_groups`) that mirrors `sidebar_pins`, persisted through the
 * same `PUT /api/user-settings` merge.
 *
 * ## K125: one "Filters" group, still individually reorderable inside
 *
 * Ken: "Nest under 'Filters'". The six built-in filters (Overdue,
 * Assigned to me, Reported by me, Mentions me, Due this week, High
 * priority) no longer sit as six top-level rows in this panel — they
 * are children of ONE "Filters" row, which is itself one more
 * reorderable/hideable row among Projects/Milestones/etc. Each child
 * is still individually reorderable/hideable inside the group. When
 * the group's own switch is off, every child's switch AND drag handle
 * is disabled (still visible, clearly inactive) — Ken: "when an item
 * is switched off, disable switching/reordering its child items too".
 *
 * `resolveGroupedSidebarOrder` (core, shared with the live sidebar's own
 * rendering) produces this nested shape from the same flat
 * `order`/`hidden` storage `resolveSidebarOrder` reads — nesting is a
 * rendering concern, not a new stored shape beyond the `filters` group
 * id itself. See its doc comment for the migration rule (A339): an
 * existing flat stored order (from before this ticket, when a filter
 * id could only ever be a top-level entry) places the new group at the
 * position of the FIRST filter id found there, keeping every filter's
 * own inner order/hidden flag untouched.
 *
 * ## Order + hidden as two lists
 *
 * The panel edits one visible-order array and a hidden set, same as
 * before nesting: every write recomputes the FULL flat `order` (top
 * ids, with `filters` now a real entry, followed by the six filter
 * ids in their own order) and the FULL flat `hidden` set (top-level
 * hidden ids, `filters` itself when the group is off, and each
 * individually-hidden filter) and writes both in full. Writing the
 * full lists (not just the ids the user touched) keeps the panel's
 * rendered order and the file identical, and resolves cleanly on load.
 *
 * Hiding is a deliberate choice distinct from an empty group (the SHL-9
 * carve-out): a hidden group is dropped from the sidebar entirely, not
 * shown as an "empty" affordance.
 *
 * ## Show/Hide → Switch (K125)
 *
 * Ken: "yes use switch" — `ui/Toggle` (`role="switch"`), replacing the
 * old Show/Hide `Button`. Each switch carries its own accessible name
 * ("Show {section} in the sidebar") rather than relying on adjacent
 * text, since AT reads a switch's label and state together. The
 * strikethrough on a hidden row's label is removed — the switch itself
 * carries the state now, so a second visual signal saying the same
 * thing was redundant.
 */

/** Human labels for the built-in ids (ids are the stored identity). */
const LABELS: Record<SidebarItemId, string> = {
  views: "Views (List / Board / Timeline)",
  projects: "Projects",
  // K125 (amended, Ken 2026-09-24): renamed "Saved filters" → "Saved
  // views" to match the sidebar's own heading for this section exactly
  // (also `SavedViewsGroup` below/`Sidebar.tsx`) — the mismatch (this
  // panel said "Saved filters" for the section the sidebar headed
  // "Views", right next to a "Filters" row) was part of the disconnect
  // Ken flagged. Matches the Settings "Saved views" page and the "Save
  // as view" button too. The STORED id (`saved-filters`) is unchanged.
  "saved-filters": "Saved views",
  filters: "Filters",
  milestones: "Milestones",
  sprints: "Sprints",
  labels: "Labels",
  recents: "Recently viewed",
  "assigned-to-me": "Assigned to me",
  "reported-by-me": "Reported by me",
  "mentions-me": "Mentions me",
  "due-this-week": "Due this week",
  overdue: "Overdue",
  "high-priority": "High priority",
};

/**
 * @param embedded When rendered inside the sidebar's own "Customize
 *   sidebar" sheet (K100 in-place, A244), the enclosing Sheet already
 *   supplies the heading — so the panel omits its own `<h1>` to avoid two
 *   competing titles. The *same component* is reused either way: the
 *   inline editor is not a fork, it is this panel in a different shell.
 */
export function SidebarGroupsPanel({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const settings = useUserSettings();

  if (settings.isError) {
    return (
      <div>
        {!embedded ? (
          <h1 className="mb-2 text-lg font-semibold text-text-primary">Sidebar groups</h1>
        ) : null}
        <ErrorState
          error={settings.error}
          onRetry={() => { void settings.refetch(); }}
          context="reading your sidebar layout"
        />
      </div>
    );
  }
  if (settings.data === undefined) {
    return <LoadingState>Loading…</LoadingState>;
  }
  return <GroupsEditor stored={settings.data.settings} embedded={embedded} />;
}

function GroupsEditor({ stored, embedded }: { readonly stored: UserSettings; readonly embedded: boolean }) {
  const save = useUserSettingsMutation();
  const groups = readSidebarGroups(stored);
  const rows = resolveGroupedSidebarOrder(groups, [...SIDEBAR_GROUP_IDS]);

  // The top-level order the panel renders and reorders: every row's id,
  // with the group's own id ("filters") standing in for its children.
  const topOrder = rows.map(r => (r.kind === "filters-group" ? "filters" : r.id));
  const filtersRow = rows.find(r => r.kind === "filters-group");
  const filterChildren = filtersRow?.kind === "filters-group" ? filtersRow.children : [];
  const filterChildOrder = filterChildren.map(c => c.id);

  /**
   * Every write recomputes the FULL flat lists from the panel's current
   * rendered state, so the file and the panel never drift (same
   * contract `resolveSidebarOrder` always had — only now the source is
   * the nested `rows`, flattened back out).
   */
  const write = (
    nextTopOrder: readonly SidebarGroupId[],
    nextFilterOrder: readonly SidebarFilterId[],
    nextTopHidden: ReadonlySet<SidebarItemId>,
    nextFilterHidden: ReadonlySet<SidebarFilterId>,
  ): void => {
    const order: SidebarItemId[] = [...nextTopOrder, ...nextFilterOrder];
    const hidden: SidebarItemId[] = [...nextTopHidden, ...nextFilterHidden];
    save.mutate({
      ...stored,
      sidebar_groups: {
        order,
        ...(hidden.length > 0 ? { hidden } : {}),
      },
    } as UserSettings);
  };

  const currentTopHidden = new Set<SidebarItemId>(
    rows.flatMap(r => {
      if (r.kind === "item") return r.hidden ? [r.id] : [];
      return r.hidden ? ["filters" as const] : [];
    }),
  );
  const currentFilterHidden = new Set<SidebarFilterId>(
    filterChildren.flatMap(c => (c.hidden ? [c.id] : [])),
  );

  const onMoveTop = (from: number, to: number): void => {
    const next = [...topOrder];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    write(next, filterChildOrder, currentTopHidden, currentFilterHidden);
  };

  const onMoveFilter = (from: number, to: number): void => {
    const next = [...filterChildOrder];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    write(topOrder, next, currentTopHidden, currentFilterHidden);
  };

  const toggleTopHidden = (id: SidebarGroupId): void => {
    const next = new Set(currentTopHidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(topOrder, filterChildOrder, next, currentFilterHidden);
  };

  const toggleFilterHidden = (id: SidebarFilterId): void => {
    const next = new Set(currentFilterHidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(topOrder, filterChildOrder, currentTopHidden, next);
  };

  const resetAll = (): void => {
    // Clear the setting entirely — absent means the default order,
    // everything visible.
    const { sidebar_groups: _drop, ...rest } = stored;
    save.mutate(rest as UserSettings);
  };

  return (
    <div data-testid="sidebar-groups-panel">
      {!embedded ? (
        <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
          Sidebar groups
        </h1>
      ) : null}
      <ReorderableRows
        items={rows.map(r => (r.kind === "filters-group" ? "filters" : r.id))}
        rowKey={id => id}
        rowLabel={id => LABELS[id]}
        onMove={onMoveTop}
        testIdPrefix="sidebar-group"
      >
        {id => {
          if (id !== "filters" || filtersRow?.kind !== "filters-group") {
            const hidden = currentTopHidden.has(id);
            return (
              <GroupRow
                id={id}
                hidden={hidden}
                onToggle={() => { toggleTopHidden(id); }}
              />
            );
          }
          const groupHidden = filtersRow.hidden;
          return (
            <div className="flex flex-col gap-1.5">
              <GroupRow id="filters" hidden={groupHidden} onToggle={() => { toggleTopHidden("filters"); }} />
              <div className="ml-4 border-l border-border-subtle pl-3">
                <ReorderableRows
                  items={filterChildOrder}
                  rowKey={fid => fid}
                  rowLabel={fid => LABELS[fid]}
                  onMove={onMoveFilter}
                  enabled={!groupHidden}
                  testIdPrefix="sidebar-filter"
                >
                  {fid => (
                    <GroupRow
                      id={fid}
                      hidden={currentFilterHidden.has(fid)}
                      // K125: the whole child row (switch included) is
                      // disabled while the parent group is off — Ken:
                      // "disable switching/reordering its child items
                      // too". `ReorderableRows`'s own `enabled` prop
                      // above already disables the drag handle; this
                      // disables the switch the same way.
                      disabled={groupHidden}
                      onToggle={() => { toggleFilterHidden(fid); }}
                      testIdPrefix="sidebar-filter"
                    />
                  )}
                </ReorderableRows>
              </div>
            </div>
          );
        }}
      </ReorderableRows>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          data-testid="sidebar-groups-reset"
          onClick={resetAll}
          className="text-[0.8571rem] text-text-secondary underline decoration-border-strong underline-offset-2 hover:text-text-primary"
        >
          Reset to default
        </button>
      </div>

      {save.isError ? (
        // ErrorState standard: the server's reason + a Retry that re-sends
        // the last write, replacing a bare line with no recovery. The
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

/**
 * One row's content: label + Switch (K125). Shared by top-level rows
 * (groups, and the "Filters" group header) and the nested filter rows.
 */
function GroupRow({
  id,
  hidden,
  disabled = false,
  onToggle,
  testIdPrefix = "sidebar-group",
}: {
  readonly id: SidebarItemId;
  readonly hidden: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
  /** Matches the enclosing `ReorderableRows`'s own `testIdPrefix` — the
   *  nested filter rows use `sidebar-filter`, distinct from the
   *  top-level `sidebar-group` rows they sit inside. */
  readonly testIdPrefix?: "sidebar-group" | "sidebar-filter";
}) {
  const label = LABELS[id];
  return (
    <div
      data-hidden={hidden ? "true" : undefined}
      className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-2 py-1"
    >
      <span className="flex-1 text-[0.9286rem] text-text-primary">
        {label}
      </span>
      <Toggle
        checked={!hidden}
        disabled={disabled}
        onChange={onToggle}
        data-testid={`${testIdPrefix}-toggle-${id}`}
        aria-label={`Show ${label} in the sidebar`}
      />
    </div>
  );
}
