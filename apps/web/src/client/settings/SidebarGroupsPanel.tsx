import type { SidebarItemId, UserSettings } from "@loctt/contracts";
import { SIDEBAR_FILTER_IDS, SIDEBAR_GROUP_IDS } from "@loctt/contracts";

import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";
import { readSidebarGroups, resolveSidebarOrder } from "./sidebarGroups.ts";

/**
 * Settings → Personal → Sidebar groups (SHL-45).
 *
 * Reorders (drag) and shows/hides the built-in sidebar groups and the
 * built-in saved filters. The choice is a per-user setting
 * (`sidebar_groups`) that mirrors `sidebar_pins`, persisted through the
 * same `PUT /api/user-settings` merge.
 *
 * ## Order + hidden as two lists
 *
 * The panel edits one visible-order array and a hidden set. On every
 * change it writes `{ order: <the full current order>, hidden: <hidden
 * ids> }`. Writing the *full* order (not just the ids the user touched)
 * keeps the panel's rendered order and the file identical — the same
 * "one source of truth the parent holds" contract ReorderableRows
 * needs — and resolves cleanly on load: any id somehow missing from
 * `order` still falls back to its default position.
 *
 * Hiding is a deliberate choice distinct from an empty group (the SHL-9
 * carve-out): a hidden group is dropped from the sidebar entirely, not
 * shown as an "empty" affordance.
 */

/** Human labels for the built-in ids (ids are the stored identity). */
const LABELS: Record<SidebarItemId, string> = {
  views: "Views (List / Board / Timeline)",
  projects: "Projects",
  "saved-filters": "Saved filters",
  milestones: "Milestones",
  sprints: "Sprints",
  labels: "Labels",
  recents: "Recently viewed",
  "assigned-to-me": "Filter · Assigned to me",
  "reported-by-me": "Filter · Reported by me",
  "mentions-me": "Filter · Mentions me",
  "due-this-week": "Filter · Due this week",
  overdue: "Filter · Overdue",
  "high-priority": "Filter · High priority",
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

  // The full catalog: groups first, then the built-in filters. Both are
  // hideable/reorderable per Ken's ruling.
  const catalog: SidebarItemId[] = [...SIDEBAR_GROUP_IDS, ...SIDEBAR_FILTER_IDS];
  const resolved = resolveSidebarOrder(groups, catalog);
  const order = resolved.map(r => r.id);
  const hidden = new Set(resolved.filter(r => r.hidden).map(r => r.id));

  const write = (nextOrder: readonly SidebarItemId[], nextHidden: ReadonlySet<SidebarItemId>): void => {
    save.mutate({
      ...stored,
      sidebar_groups: {
        order: [...nextOrder],
        ...(nextHidden.size > 0 ? { hidden: [...nextHidden] } : {}),
      },
    } as UserSettings);
  };

  const onMove = (from: number, to: number): void => {
    const next = [...order];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    write(next, hidden);
  };

  const toggleHidden = (id: SidebarItemId): void => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(order, next);
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
        items={order}
        rowKey={id => id}
        rowLabel={id => LABELS[id]}
        onMove={onMove}
        testIdPrefix="sidebar-group"
      >
        {id => (
          <div
            data-hidden={hidden.has(id) ? "true" : undefined}
            className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-2 py-1"
          >
            <span
              className={[
                "flex-1 text-[0.9286rem]",
                hidden.has(id) ? "text-text-tertiary line-through" : "text-text-primary",
              ].join(" ")}
            >
              {LABELS[id]}
            </span>
            <button
              type="button"
              data-testid={`sidebar-group-toggle-${id}`}
              aria-pressed={!hidden.has(id)}
              onClick={() => { toggleHidden(id); }}
              className="text-[0.8571rem] text-text-tertiary hover:text-text-primary"
            >
              {hidden.has(id) ? "Show" : "Hide"}
            </button>
          </div>
        )}
      </ReorderableRows>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          data-testid="sidebar-groups-reset"
          onClick={resetAll}
          className="text-[0.8571rem] text-text-tertiary hover:text-text-primary"
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
