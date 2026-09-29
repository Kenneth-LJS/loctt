/**
 * User lifecycle and active-user switching. `delete_user` has a
 * remap_to / unassign mutex because user references on tasks must
 * be resolved one way or the other — leaving dangling assignees
 * would silently corrupt task views.
 *
 * Setting an avatar is intentionally not exposed via MCP (binary
 * upload is a poor fit for the protocol); CLI and web UI cover that
 * path. Removing one needs no binary, so `edit_user` accepts
 * `remove_avatar` — the layer rule (a core capability reaches all
 * three surfaces) applies to the clear even where the set does not.
 */

import type { SidebarGroups, SidebarItemId } from "@loctt/contracts";
import { SHORTCUT_IDS } from "@loctt/contracts";
import { SIDEBAR_BUILTIN_VIEW_IDS, SIDEBAR_GROUP_IDS } from "@loctt/contracts";
import {
  applyArchivedScope,
  applyShortcutChanges,
  archiveUser,
  countUserReferences,
  createUser,
  deleteUser,
  filterByName,
  getCurrentUser,
  loadAllUsers,
  loadSidebarSavedViews,
  loadUserSettings,
  readKeyboardShortcuts,
  readSidebarGroups,
  resolveKeyboardShortcuts,
  resolveRenderedSidebarItems,
  resolveUserRef,
  saveUserSettings,
  SHORTCUT_VALID_IDS,
  sidebarValidIdsList,
  switchCurrentUser,
  unarchiveUser,
  updateUser,
  validateShortcutIds,
  validateSidebarIds,
  withKeyboardShortcuts,
} from "@loctt/core";
import { z } from "zod";

import { configListInputSchema, getArchivedScope, getQ, pageConfigList } from "../runtime/config-list.js";
import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_users",
    description:
      "List registered users. By default archived users are hidden (K107); pass "
      + "`archived: archived` for only archived or `archived: all` for both. "
      + "K90: pass `q` for a case-insensitive name substring search, and `limit`/`offset` to page (default 100, cap 1000).",
    inputSchema: {
      // K107: the shared tri-state `archived` scope replaces the old
      // boolean `include_archived` param. `include_archived: true` maps to
      // `archived: all`; the default is `active` either way.
      ...configListInputSchema,
    },
    handler: async ({ locttDir }, args) => {
      const users = await loadAllUsers(locttDir);
      const current = await getCurrentUser(locttDir);
      // K90/K107 order (matching the web `handleListUsers`): archived
      // scope, then name filter, then page.
      const scoped = applyArchivedScope(users, getArchivedScope(args));
      const filtered = pageConfigList(filterByName(scoped, getQ(args)), args);
      return text(JSON.stringify({
        current: current?.id ?? null,
        // K148: name beside the ID.
        ...(current?.name !== undefined ? { current_name: current.name } : {}),
        users: filtered,
      }, null, 2));
    },
  },
  {
    name: "get_current_user",
    description: "Returns the currently active user's profile.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      return text(JSON.stringify(current, null, 2));
    },
  },
  {
    name: "get_user_settings",
    description: "Returns the active user's personal settings (theme, card_layout, sidebar_groups, keyboard_shortcuts, default_project). These are per-user render preferences stored in .loctt/users/<id>/settings.yaml.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const settings = await loadUserSettings(locttDir, current.id);
      return text(JSON.stringify({ user: current.id, user_name: current.name, settings }, null, 2));
    },
  },
  {
    /**
     * SHL-45, Ken's layer rule: the web sidebar customization is a core
     * capability, so an agent can read/configure it too (K158 ids).
     */
    name: "get_sidebar_groups",
    description: "Returns the active user's sidebar customization (SHL-45, K158): which sidebar groups, and which views inside the Views group, show and in what order. `resolved` is the full ordered list with a `hidden` flag per item, exactly as the sidebar renders it: the Views group's children (built-in views, and saved views as `view:<id>` with their `name` and `broken` when their filters no longer load) follow `views`, and all read hidden while that group is hidden. `stored` is the per-user setting (a value written before K158 is shown migrated). Group ids: " + SIDEBAR_GROUP_IDS.join(", ") + " (`layouts` is the List / Board / Timeline switcher). Built-in view ids: " + SIDEBAR_BUILTIN_VIEW_IDS.join(", ") + ". Saved views: `view:<id>`.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const settings = await loadUserSettings(locttDir, current.id);
      const savedViews = await loadSidebarSavedViews(locttDir);
      const stored = readSidebarGroups(settings, savedViews);
      // Resolved as the web sidebar renders it (A346), matching the CLI read.
      const resolved = resolveRenderedSidebarItems(stored, savedViews);
      return text(JSON.stringify({ user: current.id, user_name: current.name, stored, resolved }, null, 2));
    },
  },
  {
    name: "set_sidebar_groups",
    description: "Sets the active user's sidebar customization (SHL-45, K158). `order` is ids in render order: group ids order the sections, and the Views group's children (built-in view ids and `view:<id>` for a saved view) are ordered by their relative position in the same list. Anything not listed follows in its default place, and a saved view not listed appends. `hidden` is the ids to hide (a hidden group renders nothing, a deliberate choice distinct from an empty group). Omit both and pass reset=true to clear back to the default. An unknown id (including `view:<id>` for a view that does not exist) is rejected with an error naming it; duplicates are de-duplicated. Returns the resolved state.",
    inputSchema: {
      order: z.array(z.string()).optional().describe("Group, built-in view and view:<id> ids in render order"),
      hidden: z.array(z.string()).optional().describe("Group, built-in view and view:<id> ids to hide"),
      reset: z.boolean().optional().describe("Clear the setting back to the default order/visibility"),
    },
    handler: async ({ locttDir }, args) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const reset = args["reset"] === true;
      const orderArg = args["order"] as string[] | undefined;
      const hiddenArg = args["hidden"] as string[] | undefined;
      if (reset && (orderArg !== undefined || hiddenArg !== undefined)) {
        return errorResult("reset cannot be combined with order/hidden");
      }
      const settings = await loadUserSettings(locttDir, current.id);
      const savedViews = await loadSidebarSavedViews(locttDir);
      if (reset) {
        const { sidebar_groups: _drop, ...rest } = settings;
        await saveUserSettings(locttDir, current.id, rest);
      } else if (orderArg !== undefined || hiddenArg !== undefined) {
        // Reject an unknown id rather than silently dropping it — parity
        // with the CLI (SHL-45, B2 bug 4).
        const bad: string[] = [];
        const parse = (raw: string[]): SidebarItemId[] => {
          const { known, unknown } = validateSidebarIds(raw, savedViews);
          bad.push(...unknown);
          return known;
        };
        const stored = readSidebarGroups(settings, savedViews);
        const next: SidebarGroups = { ...stored };
        const orderIds = orderArg !== undefined ? parse(orderArg) : undefined;
        const hiddenIds = hiddenArg !== undefined ? parse(hiddenArg) : undefined;
        if (bad.length > 0) {
          return errorResult(
            `unknown sidebar id${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. `
            + `Valid ids: ${sidebarValidIdsList(savedViews)}`,
          );
        }
        if (orderIds !== undefined) {
          if (orderIds.length > 0) next.order = orderIds;
          else delete next.order;
        }
        if (hiddenIds !== undefined) {
          if (hiddenIds.length > 0) next.hidden = hiddenIds;
          else delete next.hidden;
        }
        await saveUserSettings(locttDir, current.id, { ...settings, sidebar_groups: next });
      }
      const after = readSidebarGroups(await loadUserSettings(locttDir, current.id), savedViews);
      // Resolved as the web sidebar renders it (A346), matching the CLI read.
      const resolved = resolveRenderedSidebarItems(after, savedViews);
      return text(JSON.stringify({ user: current.id, user_name: current.name, stored: after, resolved }, null, 2));
    },
  },
  {
    /**
     * K133, Ken's layer rule: the web Keyboard settings are a core
     * capability, so an agent can read and set the switches too.
     */
    name: "get_keyboard_shortcuts",
    description: "Returns the active user's single-key shortcut switches (K133). `single_key` is the master switch: false turns every single-key shortcut off. `shortcuts` lists each shortcut with its keys, `on` (its own switch) and `active` (whether it fires now: its own switch and the master are both on). `stored` is the raw per-user setting. Shortcut ids: " + SHORTCUT_IDS.join(", ") + ". Keys are fixed; they can be switched off, not rebound.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const stored = readKeyboardShortcuts(await loadUserSettings(locttDir, current.id));
      return text(JSON.stringify({ user: current.id, user_name: current.name, stored, ...shortcutPayload(stored) }, null, 2));
    },
  },
  {
    name: "set_keyboard_shortcuts",
    description: "Sets the active user's single-key shortcut switches (K133). `single_key` sets the master switch. `off` turns the listed shortcuts off, `on` turns them back on (an id in both ends up on). `reset: true` turns the master and every shortcut back on, and cannot be combined with the others. An unknown id is rejected with an error naming it, and nothing is written. Returns the resulting state, as get_keyboard_shortcuts does. Shortcut ids: " + SHORTCUT_IDS.join(", ") + ".",
    inputSchema: {
      single_key: z.boolean().optional().describe("Master switch: false turns every single-key shortcut off"),
      off: z.array(z.string()).optional().describe("Shortcut ids to turn off"),
      on: z.array(z.string()).optional().describe("Shortcut ids to turn back on"),
      reset: z.boolean().optional().describe("Turn the master and every shortcut back on"),
    },
    handler: async ({ locttDir }, args) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const reset = args["reset"] === true;
      const singleKey = args["single_key"] as boolean | undefined;
      const offArg = (args["off"] as string[] | undefined) ?? [];
      const onArg = (args["on"] as string[] | undefined) ?? [];
      if (reset && (singleKey !== undefined || offArg.length > 0 || onArg.length > 0)) {
        return errorResult("reset cannot be combined with single_key/off/on");
      }
      const settings = await loadUserSettings(locttDir, current.id);
      if (reset) {
        await saveUserSettings(locttDir, current.id, withKeyboardShortcuts(settings, {}));
      } else if (singleKey !== undefined || offArg.length > 0 || onArg.length > 0) {
        const off = validateShortcutIds(offArg);
        const on = validateShortcutIds(onArg);
        const bad = [...off.unknown, ...on.unknown];
        if (bad.length > 0) {
          return errorResult(
            `unknown shortcut${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. `
            + `Valid ids: ${SHORTCUT_VALID_IDS.join(", ")}`,
          );
        }
        const next = applyShortcutChanges(readKeyboardShortcuts(settings), {
          ...(singleKey !== undefined ? { singleKey } : {}),
          off: off.known,
          on: on.known,
        });
        await saveUserSettings(locttDir, current.id, withKeyboardShortcuts(settings, next));
      }
      const stored = readKeyboardShortcuts(await loadUserSettings(locttDir, current.id));
      return text(JSON.stringify({ user: current.id, user_name: current.name, stored, ...shortcutPayload(stored) }, null, 2));
    },
  },
  {
    name: "switch_user",
    description: "Switches the active user. Accepts either a UUID or an exact name (when unambiguous).",
    inputSchema: {
      ref: z.string().describe("User UUID or exact name"),
    },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      await switchCurrentUser(locttDir, target.id);
      return text(`Switched to ${target.name} (${target.id})`);
    },
  },
  {
    name: "create_user",
    description: "Creates a new user. Names are not unique (UUIDs disambiguate). Timezone defaults to the system timezone. Avatars are not settable via MCP. Use the CLI or web UI.",
    inputSchema: {
      name: z.string(),
      email: z.string().optional(),
      timezone: z.string().optional(),
      switch_to_on_create: z.boolean().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const created = await createUser(locttDir, {
        name: args["name"] as string,
        ...(args["email"] !== undefined ? { email: args["email"] as string } : {}),
        ...(args["timezone"] !== undefined ? { timezone: args["timezone"] as string } : {}),
        switchToOnCreate: args["switch_to_on_create"] === true,
      });
      return text(JSON.stringify(created, null, 2));
    },
  },
  {
    name: "edit_user",
    description: "Edit an existing user's profile fields. Setting an avatar needs an image file, so that stays on the CLI or web UI; but an existing avatar can be removed here with remove_avatar.",
    inputSchema: {
      ref: z.string(),
      name: z.string().optional(),
      email: z.string().nullable().optional().describe("Pass null to clear"),
      timezone: z.string().optional(),
      remove_avatar: z.boolean().optional().describe("Clear the user's avatar (deletes the file and the profile reference)"),
    },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      const updated = await updateUser(locttDir, target.id, {
        ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
        ...("email" in args
          ? { email: args["email"] as string | null }
          : {}),
        ...(args["timezone"] !== undefined ? { timezone: args["timezone"] as string } : {}),
        ...(args["remove_avatar"] === true ? { removeAvatar: true } : {}),
      });
      return text(JSON.stringify(updated, null, 2));
    },
  },
  {
    name: "archive_user",
    description: "Archives (soft-deletes) a user. Hides them from pickers without breaking historical task references. Blocked when target is the active user.",
    inputSchema: { ref: z.string() },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      await archiveUser(locttDir, target.id);
      return text(`Archived ${target.name}`);
    },
  },
  {
    name: "unarchive_user",
    description: "Reverses archive_user: clears the archived flag.",
    inputSchema: { ref: z.string() },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      await unarchiveUser(locttDir, target.id);
      return text(`Unarchived ${target.name}`);
    },
  },
  {
    name: "count_user_references",
    description: "Counts how many tasks reference a user, split by role (assignee vs reporter). Read-only. Use it before delete_user to see what a remap or unassign will affect. It is the same split delete_user reports back.",
    inputSchema: { ref: z.string() },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      const counts = await countUserReferences(locttDir, target.id);
      return text(JSON.stringify({ id: target.id, name: target.name, ...counts }, null, 2));
    },
  },
  {
    name: "delete_user",
    description: "Hard-deletes a user. When the user has task references (assignee/reporter), exactly one of `remap_to` or `unassign` is required. Mutually exclusive. Blocked when target is the active user. Requires confirm: true.",
    inputSchema: {
      ref: z.string(),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
      remap_to: z.string().optional().describe("Target user UUID/name to migrate references onto"),
      unassign: z.boolean().optional().describe("Clear assignee/reporter on affected tasks"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_user");
      if (blocked) return blocked;
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      const remapToRef = args["remap_to"] as string | undefined;
      const unassign = args["unassign"] === true;
      if (remapToRef !== undefined && unassign) {
        return errorResult("remap_to and unassign are mutually exclusive");
      }
      const remapTo = remapToRef !== undefined
        ? (await resolveUserRef(locttDir, remapToRef)).id
        : undefined;
      const result = await deleteUser(locttDir, target.id, {
        ...(remapTo !== undefined ? { remapTo } : {}),
        ...(unassign ? { unassign: true } : {}),
      });
      return text(JSON.stringify({ deleted: target.id, name: target.name, ...result }, null, 2));
    },
  },
];

/** The resolved switch state both shortcut tools return. */
function shortcutPayload(stored: Parameters<typeof resolveKeyboardShortcuts>[0]) {
  const state = resolveKeyboardShortcuts(stored);
  return {
    single_key: state.singleKey,
    shortcuts: state.shortcuts.map(s => ({
      id: s.id,
      action: s.action,
      keys: s.bindings.map(b => b.keys.join(" ")),
      on: s.on,
      active: s.active,
    })),
  };
}
