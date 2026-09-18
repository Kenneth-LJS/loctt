import { z } from "zod";

import { IanaTimezone } from "./brands.js";
import type { FieldHealth } from "./task.js";

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
 *
 * **Corruption model (Phase-7B, per-FIELD like a task).** A profile is
 * a single addressable record, so it degrades exactly like task
 * frontmatter (`FieldHealth`): only `id` is object-fatal — a user is
 * *addressed* by id, so a bad/absent id has no record to degrade around
 * and still throws. Every other field is field-local: a hand-corrupted
 * `email`/`timezone`/`avatar`/`name` (or an unknown key) is lifted out
 * of the record into `health` with its raw value preserved, and the
 * profile still loads. That is why `name` and `timezone` are optional
 * *in the type* even though they are required on disk — a corrupt value
 * is dropped to `undefined` here and carried in `health`, mirroring how
 * `title`/`created_at`/`updated_at` are modelled on `TaskFrontmatter`
 * (K26). `health` is omitted (not `[]`) when the profile is clean, the
 * same convention as `Task.health` and `QueriesConfig.broken`.
 */
/**
 * The email format a write path must satisfy (B2, bug 1).
 *
 * `UserProfileSchema.email` is `z.email()`, but that only guards the
 * *read* path — a hand-edited or API-supplied bad value degrades into
 * `health` on load rather than being rejected. A write (`POST`/`PUT
 * /api/users`) must reject a malformed email *before* it is persisted,
 * or core saves `email: "bob"`, the reader degrades it into `health` on
 * the next load, and the field silently reads back blank (data loss).
 * Exported so the server validates against the exact same rule the
 * profile schema stores.
 */
export const EmailSchema = z.email();

export const UserProfileSchema = z.object({
  id: z.string().min(1),
  // Field-local (Phase-7B): a missing/blank/wrong-typed `name` degrades
  // to a health finding rather than making the user unreadable. Only
  // `id` is object-fatal. Optional here so a corrupt value drops to
  // undefined and travels in `health`.
  name: z.string().min(1).optional(),
  email: z.email().optional(),
  // Field-local, like `name`: a hand-edited unresolvable timezone must
  // not lock the user out of their whole profile. Optional so a corrupt
  // value degrades into `health`.
  timezone: IanaTimezone.optional(),
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

/**
 * A parsed user profile.
 *
 * The base type is the schema inference (healthy fields only). `health`
 * is added on top: field-level corruption findings gathered while
 * loading — the corrupt fields are NOT on the record (they were lifted
 * out), a surface renders them from `health` using `rawText`. Omitted
 * when the profile is clean.
 */
export type UserProfile = z.infer<typeof UserProfileSchema> & {
  readonly health?: readonly FieldHealth[];
};

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
 * The built-in sidebar group ids, and the built-in filter ids the
 * `sidebar_groups` setting can hide/reorder (SHL-45).
 *
 * These are the stable identities a `sidebar_groups` entry refers to.
 * The group ids name the top-level sidebar sections; the filter ids
 * name the built-in saved filters inside the "Saved filters" group (they
 * mirror `apps/web/src/client/sidebar/builtinFilters.ts`). Both are
 * kept here so core, CLI and MCP validate against the same catalog the
 * web sidebar renders from.
 *
 * `views` (the List/Board/Timeline switcher) and `saved-filters` are
 * deliberately hideable/reorderable too, per Ken's 2026-09-06 ruling
 * (built-in groups AND filters are both).
 */
export const SIDEBAR_GROUP_IDS = [
  "views",
  "projects",
  "saved-filters",
  "milestones",
  "sprints",
  "labels",
  "recents",
] as const;
export type SidebarGroupId = (typeof SIDEBAR_GROUP_IDS)[number];

export const SIDEBAR_FILTER_IDS = [
  "assigned-to-me",
  "reported-by-me",
  "mentions-me",
  "due-this-week",
  "overdue",
  "high-priority",
] as const;
export type SidebarFilterId = (typeof SIDEBAR_FILTER_IDS)[number];

/**
 * Every id a `sidebar_groups` entry may reference: the built-in groups
 * plus the built-in filters. This is the closed set the schema accepts;
 * an unknown id is dropped on load (degrade), never stored (SHL-45).
 */
export const SIDEBAR_ITEM_IDS = [
  ...SIDEBAR_GROUP_IDS,
  ...SIDEBAR_FILTER_IDS,
] as const;
export type SidebarItemId = (typeof SIDEBAR_ITEM_IDS)[number];

/**
 * Sidebar-groups customization (SHL-45): which built-in sidebar
 * groups/filters show, and in what order.
 *
 * ## Shape
 *
 * Two ordered id lists rather than one array of `{id, hidden}`:
 *
 *  - **`order`** — the ids the user has an opinion about, in the order
 *    they should render. Any built-in NOT listed here renders after
 *    these, in its natural default position, still visible. So a fresh
 *    user with no setting gets every group in default order, and a user
 *    who reordered only two groups need not enumerate all of them.
 *  - **`hidden`** — the ids the user chose to hide. A hidden id is a
 *    deliberate choice, distinct from "absent config" (SHL-45's fourth
 *    bullet / the SHL-9 carve-out): a hidden group renders nothing, not
 *    the "empty affordance" a group with no *entries* shows.
 *
 * A single ordered array cannot express "hidden but remembered in this
 * position", which reorder-then-hide-then-show needs; two lists can.
 *
 * ## Degradation (per corruption-handling-guide)
 *
 * The schema is the *stored* contract; tolerance lives in the reader
 * (`core/users/sidebarGroups.ts`), which drops unknown ids and
 * de-dups rather than throwing — a hand-edited unknown/duplicate id
 * must never make the sidebar unrenderable (P7). Here the schema still
 * rejects duplicates so a clean save stays clean; the reader is what
 * tolerates a dirty file.
 *
 * Ids, not labels: a group is referenced by its stable id, so this
 * survives a re-label.
 */
export const SidebarGroupsSchema = z
  .object({
    order: z
      .array(z.enum(SIDEBAR_ITEM_IDS))
      .refine(ids => new Set(ids).size === ids.length, {
        message: "sidebar_groups.order must not repeat an id",
      })
      .optional(),
    hidden: z
      .array(z.enum(SIDEBAR_ITEM_IDS))
      .refine(ids => new Set(ids).size === ids.length, {
        message: "sidebar_groups.hidden must not repeat an id",
      })
      .optional(),
  })
  .strict();
export type SidebarGroups = z.infer<typeof SidebarGroupsSchema>;

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
  sidebar_groups: SidebarGroupsSchema.optional(),
}).passthrough();
export type UserSettings = z.infer<typeof UserSettingsSchema>;
