import type { ReactNode } from "react";

import { PageHeader } from "../ui/PageHeader.tsx";

/**
 * The title row for a settings config-list panel (Projects, Users,
 * Labels, Milestones, Sprints, Saved views) — N-4 / UI-10.
 *
 * An audit found six panels building the same row six different ways:
 * five layouts, two button heights (24.5px vs 28px), two button
 * variants for the create action, and "Create" sitting in three
 * different places (top, below-list, in the title row). This is the
 * one row all six now render.
 *
 * **Scope: title + actions only, deliberately no `subtitle` slot.**
 * Every panel's description paragraph (`<p className="mb-4 ...">`)
 * stays a plain sibling *after* this component, not wired through
 * `PageHeader`'s `subtitle` prop. `PageHeader` puts `title`/`subtitle`
 * in a `flex flex-col gap-0.5` (2px, ×0.875 = 1.75px) wrapper — routing
 * the description through it would shrink the title→description gap
 * from the settings family's existing `mb-1` (4px, ×0.875 = 3.5px) to
 * that 1.75px gap, a spacing regression this ticket did not ask for.
 * Keeping the description outside preserves it byte-for-byte.
 *
 * **Why this wraps `PageHeader` instead of reusing it directly.**
 * `PageHeader` already standardizes the *main-view* title row (List/
 * Board/Timeline) at `text-[1.0714rem]` (measured 15.0px at the 87.5%
 * root). Settings panels are a **separate, already-converged family**:
 * five sibling panels outside N-4's scope — `WorkflowPanelFrame`
 * (shared by the five Workflow sub-panels), `BackupPanel`,
 * `DiagnosticsPanel`, `GitSyncPanel`, `SidebarGroupsPanel` — all render
 * `data-testid="settings-panel-title"` on an `<h1
 * className="mb-1 text-lg font-semibold text-text-primary">`
 * (measured 15.75px). Pointing these six at `PageHeader` verbatim would
 * fix the six-panel drift by silently shrinking their titles 0.75px and
 * opening a NEW split — eight settings panels at two different title
 * sizes instead of six at one and five at another. This component
 * converges onto the size the *other eight already use*, not onto the
 * main-view size, while still reusing `PageHeader` for the mechanics
 * that are genuinely shared (the `items-start` row, the actions slot,
 * `min-h-7`) rather than re-implementing them.
 *
 * `data-testid="settings-panel-title"` is placed on the `<h1>` itself
 * (via `PageHeader`'s "a node renders as-is" escape hatch), matching
 * every existing consumer of that testid — none of them expect it on a
 * wrapping `<header>`. The `<h1>` keeps its own `mb-1` so its spacing
 * to the sibling description paragraph is unchanged from today.
 */
export function SettingsPanelHeader({
  title,
  actions,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={
        <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
          {title}
        </h1>
      }
      actions={actions}
    />
  );
}
