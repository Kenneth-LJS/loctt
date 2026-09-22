/**
 * The settings sections and the four groups they sit in (SET-2, A64).
 *
 * This is a plain data module rather than JSX so the nav, the route's
 * section resolution, and the not-found state (SET-32) all read from
 * one list. A section that exists in the nav but not here — or the
 * reverse — is the drift SET-2's last bullet is about.
 *
 * The groups are semantic but ordered by likelihood of use, System
 * last (A64): Content (the things you make), Workflow (how tasks are
 * shaped and shown), Personal (per-user), System (admin/plumbing).
 * Order within a group is authored order in `SETTINGS_SECTIONS` —
 * `sectionsInGroup` preserves array order — so the array is the source
 * of truth for both grouping and within-group order.
 *
 * `built` marks the panels that exist today. The nav still lists them,
 * because SET-2 wants the shape of settings visible, and the shell
 * renders an honest "not built yet" pane rather than a blank one — a
 * blank pane under a valid-looking URL is exactly what SET-32 forbids.
 */

export type SettingsGroup =
  | "Content"
  | "Workflow"
  | "Personal"
  | "System";

export interface SettingsSection {
  /** URL segment: `/settings/<id>`. */
  readonly id: string;
  /** Nav label. */
  readonly label: string;
  readonly group: SettingsGroup;
  /** False until the panel itself is implemented. */
  readonly built: boolean;
}

/** Group order in the nav (A64): frequency-ordered, System last. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  "Content",
  "Workflow",
  "Personal",
  "System",
];

// Array order == nav order (both across groups, via SETTINGS_GROUPS, and
// within a group, via sectionsInGroup which preserves array order).
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // Content — the things a user creates and organizes. Projects first: a
  // bare /settings lands here (DEFAULT_SECTION), so it must be the first
  // real panel. ("General" was removed earlier — every setting it would
  // hold already has a home: timezone → Calendar, default project →
  // Projects, theme → My preferences.)
  { id: "projects", label: "Projects", group: "Content", built: true },
  { id: "saved-views", label: "Saved views", group: "Content", built: true },
  { id: "labels", label: "Labels", group: "Content", built: true },
  { id: "milestones", label: "Milestones", group: "Content", built: true },
  { id: "sprints", label: "Sprints", group: "Content", built: true },

  // Workflow — how tasks are shaped (statuses/priorities/types/fields/
  // relationships/estimation) and how they are shown (board/timeline/
  // calendar).
  { id: "statuses", label: "Statuses", group: "Workflow", built: true },
  { id: "priorities", label: "Priorities", group: "Workflow", built: true },
  { id: "task-types", label: "Task types", group: "Workflow", built: true },
  { id: "custom-fields", label: "Custom fields", group: "Workflow", built: true },
  { id: "relationships", label: "Relationships", group: "Workflow", built: true },
  { id: "estimation", label: "Estimation", group: "Workflow", built: true },
  { id: "board-columns", label: "Board columns", group: "Workflow", built: true },
  { id: "timeline", label: "Timeline defaults", group: "Workflow", built: true },
  { id: "calendar", label: "Calendar", group: "Workflow", built: true },

  // Personal — per-user preferences.
  { id: "preferences", label: "My preferences", group: "Personal", built: true },
  { id: "card-layout", label: "Card layout", group: "Personal", built: true },
  // "Sidebar pins" → "Pinned views" (A244): the two sidebar-config
  // sections were a confusable pair. This one pins *saved views*; the
  // other reorders/hides the *built-in groups*. The label now says which.
  // The section id is unchanged, so /settings/sidebar-pins stays stable.
  { id: "sidebar-pins", label: "Pinned views", group: "Personal", built: true },
  { id: "sidebar-groups", label: "Sidebar groups", group: "Personal", built: true },
  { id: "keyboard", label: "Keyboard", group: "Personal", built: true },

  // System — admin and plumbing. Diagnostics is last of all (A64).
  { id: "users", label: "Users", group: "System", built: true },
  { id: "sync", label: "Sync", group: "System", built: true },
  { id: "backup", label: "Backup & restore", group: "System", built: true },
  { id: "diagnostics", label: "Diagnostics", group: "System", built: true },
];

/** The section a bare `/settings` lands on (SET-1). Projects, since
 * "General" was removed — a bare /settings must land on a real panel. */
export const DEFAULT_SECTION = "projects";

export function findSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find(s => s.id === id);
}

export function sectionsInGroup(group: SettingsGroup): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter(s => s.group === group);
}
