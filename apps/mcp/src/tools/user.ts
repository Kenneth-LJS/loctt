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

import {
  archiveUser,
  countUserReferences,
  createUser,
  deleteUser,
  getCurrentUser,
  loadAllUsers,
  loadOptionalConfigs,
  loadUserSettings,
  readSidebarPins,
  resolveUserRef,
  saveUserSettings,
  sweepSidebarPins,
  switchCurrentUser,
  unarchiveUser,
  updateUser,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_users",
    description: "List registered users. By default, archived users are hidden; pass include_archived=true to include them.",
    inputSchema: {
      include_archived: z.boolean().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const includeArchived = args["include_archived"] === true;
      const users = await loadAllUsers(locttDir);
      const current = await getCurrentUser(locttDir);
      const filtered = users.filter(u => includeArchived || u.archived !== true);
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
