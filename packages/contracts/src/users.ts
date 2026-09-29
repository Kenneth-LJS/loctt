import { z } from "zod";

import { IanaTimezone } from "./brands.js";
import { KeyboardShortcutsSchema } from "./shortcuts.js";
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
 * The sidebar's top-level group ids, and the ids of the items inside the
 * Views group, that the `sidebar_groups` setting orders and hides
 * (SHL-45, K125, K158).
 *
 * **K158 (Ken, 2026-09-29): one "Views" section.** *"why are you
 * splitting filters vs saved views?!?! ... it should be 1. then we can
 * re-order them, and we can hide."* The built-in views (Assigned to me,
 * Reported by me, ...) and the saved views are one ordered, hideable list
 * under one group, `views`. The List / Board / Timeline switcher, which
 * used to own the id `views`, is now `layouts` (labelled "Layouts (List /
 * Board / Timeline)" so it is not confused with Views).
 *
 * The pre-K158 ids (`views` meaning the switcher, `saved-filters`,
 * `filters`) live on only in `LEGACY_SIDEBAR_*` below, for reading a
 * setting written before K158 (see `LegacySidebarGroupsSchema`).
 */
export const SIDEBAR_GROUP_IDS = [
  "layouts",
  "projects",
  "views",
  "milestones",
  "sprints",
  "labels",
  "recents",
] as const;
export type SidebarGroupId = (typeof SIDEBAR_GROUP_IDS)[number];

/**
 * The built-in views, children of the `views` group (K158; they were the
 * "Filters" group's children under K125). They mirror
 * `apps/web/src/client/sidebar/builtinFilters.ts`.
 */
export const SIDEBAR_BUILTIN_VIEW_IDS = [
  "assigned-to-me",
  "reported-by-me",
  "mentions-me",
  "due-this-week",
  "overdue",
  "high-priority",
] as const;
export type SidebarBuiltinViewId = (typeof SIDEBAR_BUILTIN_VIEW_IDS)[number];

/**
 * A saved view's id inside `sidebar_groups` (K158): `view:` + its
 * `queries.yaml` id. The prefix keeps a saved view apart from a group or
 * built-in id: a view's id is free text, and a view called `overdue` or
 * `projects` must not collide with the built-in of that name.
 */
export const SAVED_VIEW_SIDEBAR_PREFIX = "view:";
export type SavedViewSidebarId = `view:${string}`;

export function savedViewSidebarId(viewId: string): SavedViewSidebarId {
  return `${SAVED_VIEW_SIDEBAR_PREFIX}${viewId}`;
}

/** The saved view's own id, or undefined when `id` is not a saved-view entry. */
export function parseSavedViewSidebarId(id: string): string | undefined {
  if (!id.startsWith(SAVED_VIEW_SIDEBAR_PREFIX)) return undefined;
  const rest = id.slice(SAVED_VIEW_SIDEBAR_PREFIX.length);
  return rest === "" ? undefined : rest;
}

/**
 * Every FIXED id a `sidebar_groups` entry may reference: the groups plus
 * the built-in views. Saved views (`view:<id>`) are the open part.
 */
export const SIDEBAR_ITEM_IDS = [
  ...SIDEBAR_GROUP_IDS,
  ...SIDEBAR_BUILTIN_VIEW_IDS,
] as const;
export type SidebarFixedItemId = (typeof SIDEBAR_ITEM_IDS)[number];
export type SidebarItemId = SidebarFixedItemId | SavedViewSidebarId;

const FIXED_ITEM_IDS: ReadonlySet<string> = new Set(SIDEBAR_ITEM_IDS);

/** Whether `id` is a well-formed `sidebar_groups` id (a fixed id or `view:<id>`). */
export function isSidebarItemId(id: unknown): id is SidebarItemId {
  if (typeof id !== "string") return false;
  return FIXED_ITEM_IDS.has(id) || parseSavedViewSidebarId(id) !== undefined;
}

const SidebarItemIdSchema = z.custom<SidebarItemId>(isSidebarItemId, {
  message: "not a sidebar id",
});

/** The stored-format version of `sidebar_groups` written since K158. */
export const SIDEBAR_GROUPS_VERSION = 2;

/**
 * Sidebar-groups customization (SHL-45, K158): which sidebar groups and
 * which views inside the Views group show, and in what order.
 *
 * ## Shape
 *
 * `version: 2` plus two flat id lists:
 *
 *  - **`order`**: the ids the user has an opinion about, in render
 *    order. Group ids order the sections. The Views group's children
 *    (built-in ids and `view:<id>`) are ordered by their relative
 *    position in the same list. Anything not listed follows in its
 *    default place: a group at its catalog slot, a built-in after the
 *    placed children, a saved view after those (so a new saved view
 *    appends).
 *  - **`hidden`**: the ids the user chose to hide. A hidden id is a
 *    deliberate choice, distinct from "absent config" (SHL-45's fourth
 *    bullet / the SHL-9 carve-out).
 *
 * A single ordered array cannot express "hidden but remembered in this
 * position", which reorder-then-hide-then-show needs; two lists can.
 *
 * `version` marks the K158 id set. A value without it was written before
 * K158, where `views` meant the List / Board / Timeline switcher; it is
 * read with `LegacySidebarGroupsSchema` and migrated on read
 * (`core/users/sidebarGroups.ts`, `migrateLegacySidebarGroups`).
 *
 * ## Degradation (per corruption-handling-guide)
 *
 * The schema is the *stored* contract; tolerance lives in the reader
 * (`core/users/sidebarGroups.ts`), which drops malformed and duplicate
 * ids rather than throwing (P7). A `view:<id>` whose view no longer
 * exists is not malformed: it is skipped when the sidebar resolves (a
 * deleted view drops out of the order).
 *
 * Ids, not labels: a group or view is referenced by its stable id, so
 * this survives a rename.
 */
export const SidebarGroupsSchema = z
  .object({
    version: z.literal(SIDEBAR_GROUPS_VERSION),
    order: z
      .array(SidebarItemIdSchema)
      .refine(ids => new Set(ids).size === ids.length, {
        message: "sidebar_groups.order must not repeat an id",
      })
      .optional(),
    hidden: z
      .array(SidebarItemIdSchema)
      .refine(ids => new Set(ids).size === ids.length, {
        message: "sidebar_groups.hidden must not repeat an id",
      })
      .optional(),
  })
  .strict();
export type SidebarGroups = z.infer<typeof SidebarGroupsSchema>;

/**
 * The pre-K158 group ids (SHL-45, K125): `views` was the List / Board /
 * Timeline switcher, and the built-ins and saved views were two groups,
 * `filters` and `saved-filters`. Read-only: nothing writes these any more.
 */
export const LEGACY_SIDEBAR_GROUP_IDS = [
  "views",
  "projects",
  "saved-filters",
  "filters",
  "milestones",
  "sprints",
  "labels",
  "recents",
] as const;
export type LegacySidebarGroupId = (typeof LEGACY_SIDEBAR_GROUP_IDS)[number];
export const LEGACY_SIDEBAR_ITEM_IDS = [
  ...LEGACY_SIDEBAR_GROUP_IDS,
  ...SIDEBAR_BUILTIN_VIEW_IDS,
] as const;
export type LegacySidebarItemId = (typeof LEGACY_SIDEBAR_ITEM_IDS)[number];

/** A `sidebar_groups` value written before K158 (no `version`). */
export const LegacySidebarGroupsSchema = z
  .object({
    order: z
      .array(z.enum(LEGACY_SIDEBAR_ITEM_IDS))
      .refine(ids => new Set(ids).size === ids.length, {
        message: "sidebar_groups.order must not repeat an id",
      })
      .optional(),
    hidden: z
      .array(z.enum(LEGACY_SIDEBAR_ITEM_IDS))
      .refine(ids => new Set(ids).size === ids.length, {
        message: "sidebar_groups.hidden must not repeat an id",
      })
      .optional(),
  })
  .strict();
export type LegacySidebarGroups = z.infer<typeof LegacySidebarGroupsSchema>;

/** What `settings.yaml` may hold: the K158 shape, or a pre-K158 value still to migrate. */
export const StoredSidebarGroupsSchema = z.union([SidebarGroupsSchema, LegacySidebarGroupsSchema]);
export type StoredSidebarGroups = z.infer<typeof StoredSidebarGroupsSchema>;

/**
 * `.passthrough()`, unlike its `.strict()` siblings above, and
 * deliberately so.
 *
 * Every settings panel saves with `{...stored, ...next}` — it reads
 * the whole object and writes it back
 * (`PreferencesPanel.tsx:83`, `CardLayoutPanel.tsx:96`). Under `.strict()`, a key one panel does
 * not know about is rejected *on save*, so editing your card layout
 * would destroy your sidebar layout the moment the two versions
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
  sidebar_groups: StoredSidebarGroupsSchema.optional(),
  // K133: the single-key shortcut switches. See `shortcuts.ts`.
  keyboard_shortcuts: KeyboardShortcutsSchema.optional(),
}).passthrough();
export type UserSettings = z.infer<typeof UserSettingsSchema>;
