/**
 * The settings sections and the five groups they sit in (SET-2).
 *
 * This is a plain data module rather than JSX so the nav, the route's
 * section resolution, and the not-found state (SET-32) all read from
 * one list. A section that exists in the nav but not here — or the
 * reverse — is the drift SET-2's last bullet is about.
 *
 * `built` marks the panels that exist today. M4.1 ships Projects and
 * Users; the rest land in M4.2–M4.4. The nav still lists them, because
 * SET-2 wants the shape of settings visible, but the shell renders an
 * honest "not built yet" pane rather than a blank one — a blank pane
 * under a valid-looking URL is exactly what SET-32 forbids.
 */

export type SettingsGroup =
  | "Workspace"
  | "Workflow"
  | "Data"
  | "Tracker"
  | "Personal";

export interface SettingsSection {
  /** URL segment: `/settings/<id>`. */
  readonly id: string;
  /** Nav label. */
  readonly label: string;
  readonly group: SettingsGroup;
  /** False until the panel itself is implemented. */
  readonly built: boolean;
}

/** Group order in the nav. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  "Workspace",
  "Workflow",
  "Data",
  "Tracker",
  "Personal",
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General", group: "Workspace", built: false },
  { id: "projects", label: "Projects", group: "Workspace", built: true },
  { id: "users", label: "Users", group: "Workspace", built: true },

  { id: "statuses", label: "Statuses", group: "Workflow", built: true },
  { id: "priorities", label: "Priorities", group: "Workflow", built: true },
  { id: "task-types", label: "Task types", group: "Workflow", built: true },
  { id: "relationships", label: "Relationships", group: "Workflow", built: true },
  { id: "custom-fields", label: "Custom fields", group: "Workflow", built: true },
  { id: "estimation", label: "Estimation", group: "Workflow", built: true },

  { id: "labels", label: "Labels", group: "Data", built: true },
  { id: "milestones", label: "Milestones", group: "Data", built: true },
  { id: "sprints", label: "Sprints", group: "Data", built: true },
  { id: "saved-views", label: "Saved views", group: "Data", built: true },

  { id: "calendar", label: "Calendar", group: "Tracker", built: true },
  { id: "board-columns", label: "Board columns", group: "Tracker", built: false },
  { id: "timeline", label: "Timeline defaults", group: "Tracker", built: false },
  { id: "sync", label: "Sync", group: "Tracker", built: true },
  { id: "diagnostics", label: "Diagnostics", group: "Tracker", built: true },

  { id: "preferences", label: "My preferences", group: "Personal", built: true },
  { id: "card-layout", label: "Card layout", group: "Personal", built: true },
  { id: "sidebar-pins", label: "Sidebar pins", group: "Personal", built: true },
  { id: "keyboard", label: "Keyboard", group: "Personal", built: true },
];

/** The section a bare `/settings` lands on (SET-1). */
export const DEFAULT_SECTION = "general";

export function findSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find(s => s.id === id);
}

export function sectionsInGroup(group: SettingsGroup): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter(s => s.group === group);
}
