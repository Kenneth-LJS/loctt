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
import { SIDEBAR_GROUP_IDS, SIDEBAR_ITEM_IDS } from "@loctt/contracts";
import {
  archiveUser,
  countUserReferences,
  createUser,
  deleteUser,
  filterByName,
  getCurrentUser,
  loadAllUsers,
  loadOptionalConfigs,
  loadUserSettings,
  readSidebarGroups,
  readSidebarPins,
  resolveSidebarOrder,
  resolveUserRef,
  saveUserSettings,
  SIDEBAR_VALID_IDS,
  sweepSidebarPins,
  switchCurrentUser,
  unarchiveUser,
  updateUser,
  validateSidebarIds,
} from "@loctt/core";
import { z } from "zod";

import { configListInputSchema, getQ, pageConfigList } from "../runtime/config-list.js";
import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_users",
    description:
      "List registered users. By default, archived users are hidden; pass include_archived=true to include them. "
      + "K90: pass `q` for a case-insensitive name substring search, and `limit`/`offset` to page (default 100, cap 1000).",
    inputSchema: {
      include_archived: z.boolean().optional(),
      ...configListInputSchema,
    },
    handler: async ({ locttDir }, args) => {
      const includeArchived = args["include_archived"] === true;
      const users = await loadAllUsers(locttDir);
      const current = await getCurrentUser(locttDir);
      // K90 order (matching the web `handleListUsers`): archived filter,
      // then name filter, then page.
      const visible = users.filter(u => includeArchived || u.archived !== true);
      const filtered = pageConfigList(filterByName(visible, getQ(args)), args);
      return text(JSON.stringify({
        current: current?.id ?? null,
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
    /**
     * Ken's layer rule: core's pin sweep (`sweepSidebarPins`) ships to
     * all three surfaces, not just the web UI that motivated it.
     */
    name: "get_user_settings",
    description: "Returns the active user's personal settings (theme, card_layout, sidebar_pins, default_project). These are per-user render preferences stored in .loctt/users/<id>/settings.yaml.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const settings = await loadUserSettings(locttDir, current.id);
      return text(JSON.stringify({ user: current.id, settings }, null, 2));
    },
  },
  {
    name: "sweep_sidebar_pins",
    description: "Removes pinned saved views whose views no longer exist in queries.yaml, and reports which were removed by id. Pins whose views merely match zero tasks are kept — this checks existence, not results.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const settings = await loadUserSettings(locttDir, current.id);
      const { queriesConfig } = await loadOptionalConfigs(locttDir);
      const existing = (queriesConfig?.queries ?? []).map(q => q.id);
      const sweep = sweepSidebarPins(readSidebarPins(settings), existing);
      if (sweep.changed) {
        await saveUserSettings(locttDir, current.id, {
          ...settings,
          sidebar_pins: sweep.kept,
        });
      }
      return text(JSON.stringify(
        { removed: sweep.removed, kept: sweep.kept, changed: sweep.changed },
        null,
        2,
      ));
    },
  },
  {
    /**
     * SHL-45, Ken's layer rule: the web sidebar-groups editor is a core
     * capability, so an agent can read/configure it too.
     */
    name: "get_sidebar_groups",
    description: "Returns the active user's sidebar-groups customization (SHL-45): which built-in sidebar groups/filters show and in what order. `resolved` is the full ordered list with a `hidden` flag per item (what the sidebar renders); `stored` is the raw per-user setting. Group ids: " + SIDEBAR_GROUP_IDS.join(", ") + ". Filter ids: " + SIDEBAR_ITEM_IDS.slice(SIDEBAR_GROUP_IDS.length).join(", ") + ".",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const current = await getCurrentUser(locttDir);
      if (!current) return errorResult("no users registered");
      const settings = await loadUserSettings(locttDir, current.id);
      const stored = readSidebarGroups(settings);
      // Full item catalog (groups + filters) so a hidden filter appears
      // in `resolved`, matching CLI read (B2 bug 3).
      const resolved = resolveSidebarOrder(stored, [...SIDEBAR_ITEM_IDS]);
      return text(JSON.stringify({ user: current.id, stored, resolved }, null, 2));
    },
  },
  {
    name: "set_sidebar_groups",
    description: "Sets the active user's sidebar-groups customization (SHL-45). `order` is the ids in render order (any built-in not listed follows in default order); `hidden` is the ids to hide (a hidden group renders nothing — a deliberate choice, distinct from an empty group). Omit both and pass reset=true to clear back to the default. An unknown id is rejected with an error naming it (a typo must not silently no-op); duplicates are de-duplicated. Returns the resolved state.",
    inputSchema: {
      order: z.array(z.string()).optional().describe("Group/filter ids in render order"),
      hidden: z.array(z.string()).optional().describe("Group/filter ids to hide"),
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
      if (reset) {
        const { sidebar_groups: _drop, ...rest } = settings;
        await saveUserSettings(locttDir, current.id, rest);
      } else if (orderArg !== undefined || hiddenArg !== undefined) {
        // Reject an unknown id rather than silently dropping it — parity
        // with the CLI (SHL-45, B2 bug 4). A typo used to succeed and
        // change nothing, so the agent believed a group was hidden.
        const bad: string[] = [];
        const parse = (raw: string[]): SidebarItemId[] => {
          const { known, unknown } = validateSidebarIds(raw);
          bad.push(...unknown);
          return known;
        };
        const stored = readSidebarGroups(settings);
        const next: SidebarGroups = { ...stored };
        const orderIds = orderArg !== undefined ? parse(orderArg) : undefined;
        const hiddenIds = hiddenArg !== undefined ? parse(hiddenArg) : undefined;
        if (bad.length > 0) {
          return errorResult(
            `unknown sidebar id${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. `
            + `Valid ids: ${SIDEBAR_VALID_IDS.join(", ")}`,
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
      const after = readSidebarGroups(await loadUserSettings(locttDir, current.id));
      // Resolve the FULL item catalog (groups + filters) so a hidden
      // filter round-trips in `resolved`, matching CLI read (B2 bug 3).
      const resolved = resolveSidebarOrder(after, [...SIDEBAR_ITEM_IDS]);
      return text(JSON.stringify({ user: current.id, stored: after, resolved }, null, 2));
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
    description: "Creates a new user. Names are not unique (UUIDs disambiguate). Timezone defaults to the system timezone. Avatars are not settable via MCP — use the CLI or web UI.",
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
    description: "Reverses archive_user — clears the archived flag.",
    inputSchema: { ref: z.string() },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      await unarchiveUser(locttDir, target.id);
      return text(`Unarchived ${target.name}`);
    },
  },
  {
    name: "count_user_references",
    description: "Counts how many tasks reference a user, split by role (assignee vs reporter). Read-only. Use it before delete_user to see what a remap or unassign will affect — the same split delete_user reports back.",
    inputSchema: { ref: z.string() },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      const counts = await countUserReferences(locttDir, target.id);
      return text(JSON.stringify({ id: target.id, ...counts }, null, 2));
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
      return text(JSON.stringify({ deleted: target.id, ...result }, null, 2));
    },
  },
];
