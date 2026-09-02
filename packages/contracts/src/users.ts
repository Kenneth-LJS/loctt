import { z } from "zod";

import { IanaTimezone } from "./brands.js";

/**
 * A single user's profile. Stored as `.loctt/users/<id>/profile.yaml`.
 * `id` is a generated ULID — never user-supplied — and is the
 * identifier referenced by `assignee` / `reporter` task fields.
 *
 * `name` and other metadata are mutable. Names are not unique
 * (ULIDs disambiguate); the UI shows truncated IDs alongside
 * names where ambiguity matters.
 *
 * `archived` hides the user from default pickers; tasks already
 * assigned to them continue to display the name.
 */
export const UserProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email().optional(),
  timezone: IanaTimezone,
  // Avatar is the basename of a file inside the user's folder
  // (e.g. "avatar.png"). Reject path separators and traversal at
  // the contract layer so a hand-edited profile.yaml can't point
  // at files outside the user dir.
  avatar: z
    .string()
    .min(1)
    .regex(/^[^/\\]+$/, "must be a basename (no path separators)")
    .refine(s => s !== "." && s !== "..", "must not be \".\" or \"..\"")
    .optional(),
  archived: z.boolean().optional(),
}).strict();
export type UserProfile = z.infer<typeof UserProfileSchema>;

/** A list of registered user profiles. */
export const UsersListSchema = z.object({
  users: z.array(UserProfileSchema),
}).strict();
export type UsersList = z.infer<typeof UsersListSchema>;

/**
 * Per-user settings stored at `.loctt/users/<id>/settings.yaml`
 * (gitignored). Most fields are pure UI render prefs that core does
 * not interpret — those are accepted via passthrough so they survive
 * a load → save round trip without core needing to model them.
 *
 * **`default_project`** is the one cross-cutting field: `loctt create`
 * resolves the target project as `--project` flag > this field >
 * workspace default. Core validates the shape (non-empty string) but
 * not existence; if the referenced project has been deleted, callers
 * fall back gracefully and doctor reports the dangling reference.
 */
/**
 * Fields a board card can display, in the order `card_layout` lists them.
 *
 * The set is closed so a typo in hand-edited YAML is caught at load rather
 * than silently rendering nothing. Title is always shown and is therefore
 * not a member.
 */
export const CARD_LAYOUT_FIELDS = [
  "key",
  "status",
  "priority",
  "task_type",
  "assignee",
  "labels",
  "due_date",
  "estimate",
  "milestone",
  "sprint",
] as const;
export type CardLayoutField = (typeof CARD_LAYOUT_FIELDS)[number];

/**
 * Board-card field layout (CW-17): an **ordered array**, not a visibility
 * map. Position in the array is the render order, so one field carries
 * both concerns and drag-to-reorder (Q6) needs no second setting.
 *
 * Absent means "use the default layout". An explicit empty array means
 * "show nothing but the title" — a deliberate choice, distinct from
 * absence.
 *
 * Duplicates are rejected: a field appearing twice has no meaningful
 * render order.
 */
export const CardLayoutSchema = z
  .array(z.enum(CARD_LAYOUT_FIELDS))
  .refine(fields => new Set(fields).size === fields.length, {
    message: "card_layout must not repeat a field",
  });
export type CardLayout = z.infer<typeof CardLayoutSchema>;

/** Body editor mode, persisted per user (D17). */
export const EditorModeSchema = z.enum(["wysiwyg", "source"]);
export type EditorMode = z.infer<typeof EditorModeSchema>;

/** Theme preference, persisted per user (SET-11). */
export const ThemePreferenceSchema = z.enum(["light", "dark", "system"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

/**
 * Sidebar pins (SET-13): the saved-view ids pinned to the sidebar's
 * Saved filters group, in sidebar order.
 *
 * Ids, not names — a view renamed in `queries.yaml` keeps its pin.
 * Absent means "pin nothing"; the sidebar still lists views, but the
 * pinned subset is what this orders.
 *
 * Duplicates are rejected for the same reason `card_layout` rejects
 * them: a pin appearing twice has no meaningful sidebar position.
 */
export const SidebarPinsSchema = z
  .array(z.string().min(1))
  .refine(ids => new Set(ids).size === ids.length, {
    message: "sidebar_pins must not repeat a view",
  });
export type SidebarPins = z.infer<typeof SidebarPinsSchema>;

/**
 * `.passthrough()`, unlike its `.strict()` siblings above, and
 * deliberately so.
 *
 * Every settings panel saves with `{...stored, ...next}` — it reads
 * the whole object and writes it back
 * (`PreferencesPanel.tsx:83`, `SidebarPinsPanel.tsx:94`,
 * `CardLayoutPanel.tsx:96`). Under `.strict()`, a key one panel does
 * not know about is rejected *on save*, so editing your card layout
 * would destroy your sidebar pins the moment the two versions
 * disagree — a newer client's key, or a hand-added one.
 *
 * The strictness that protects `profile.yaml` would corrupt this file.
 * Flagged as an inconsistency by the Phase 4 audit; it is a load-bearing
 * difference, not drift.
 */
export const UserSettingsSchema = z.object({
  default_project: z.string().min(1).optional(),
  card_layout: CardLayoutSchema.optional(),
  editor_mode: EditorModeSchema.optional(),
  theme: ThemePreferenceSchema.optional(),
  sidebar_pins: SidebarPinsSchema.optional(),
}).passthrough();
export type UserSettings = z.infer<typeof UserSettingsSchema>;
