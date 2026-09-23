import type { ArchivedScope } from "@loctt/contracts";

import { ArchivedScopeControl } from "../ui/ArchivedScopeControl.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu } from "../ui/Menu.tsx";

/**
 * Demotes `ArchivedScopeControl` inside a settings admin panel (Projects,
 * Users, Labels, Milestones, Sprints, Saved views) from a permanently
 * visible segmented control to a secondary reveal — Ken's ruling,
 * 2026-09-22 ("archiving is a one-way door, not a filter", decisions.md
 * § 9):
 *
 * > "the reveal is secondary, not a visible segmented control"
 *
 * All six panels put the control directly in `SettingsPanelHeader`'s
 * `actions` row, next to (and the same visual weight as) the primary
 * "New X" button — the exact "another filter" reading Ken ruled out, just
 * relocated from the task list's filter band into a settings header
 * instead of removed.
 *
 * **No new primitive.** This composes three that already exist —
 * `ui/Menu` (already the settings family's row-kebab and view-actions
 * pattern, `RowActions`/`FilterBar`'s "⋯"), `ui/IconButton`, and the
 * control itself unchanged — into the one shape needed here: an icon
 * trigger that is quiet until opened, holding the same three-way choice
 * behind it. It is a settings-local composition, not `ui/` API surface,
 * because "an icon button that opens a Menu holding a single control" is
 * specific to this one demotion and is not a shape any other surface
 * needs (the repo's documented failure mode is "built is not adopted" —
 * this stays a private composition rather than a speculative primitive).
 *
 * The trigger is `eye`/`eye-off` (scope is `active` vs anything else) so
 * its own icon says whether archived rows are currently hidden or
 * revealed without opening the menu — the one piece of at-a-glance state
 * a fully-hidden control would otherwise lose. Ghost weight, sized to sit
 * beside the header's primary action without competing with it.
 */
export function ArchivedScopeReveal({
  value,
  onChange,
  testId,
  panelLabel,
}: {
  readonly value: ArchivedScope;
  readonly onChange: (scope: ArchivedScope) => void;
  /** `data-testid` root; the control inside keeps its existing id (`${testId}` unchanged from before demotion, so specs that assert its data-value need no rename). */
  readonly testId: string;
  /** Names the panel for the trigger's accessible label, e.g. "projects". */
  readonly panelLabel: string;
}) {
  const revealing = value !== "active";
  return (
    <Menu
      align="end"
      aria-label={`Show archived ${panelLabel}`}
      trigger={({ toggle, ...aria }) => (
        <IconButton
          variant="ghost"
          size="md"
          aria-label={`Show archived ${panelLabel}`}
          title={revealing ? `Showing: ${value}` : "Show archived"}
          testId={`${testId}-reveal`}
          onClick={toggle}
          {...aria}
        >
          <Icon name={revealing ? "eye" : "eyeOff"} size={16} />
        </IconButton>
      )}
    >
      {() => (
        <div className="p-2">
          <ArchivedScopeControl testId={testId} value={value} onChange={onChange} />
        </div>
      )}
    </Menu>
  );
}
