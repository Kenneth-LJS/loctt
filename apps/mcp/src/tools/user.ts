/**
 * User lifecycle and active-user switching. `delete_user` has a
 * remap_to / unassign mutex because user references on tasks must
 * be resolved one way or the other — leaving dangling assignees
 * would silently corrupt task views.
 *
 * Avatars are intentionally not settable via MCP (binary upload is
 * a poor fit for the protocol); CLI and web UI cover that path.
 */

import {
  archiveUser,
  createUser,
  deleteUser,
  getCurrentUser,
  loadAllUsers,
  resolveUserRef,
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
    description: "Edit an existing user's profile fields. Avatars are not settable via MCP — use the CLI or web UI.",
    inputSchema: {
      ref: z.string(),
      name: z.string().optional(),
      email: z.string().nullable().optional().describe("Pass null to clear"),
      timezone: z.string().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const target = await resolveUserRef(locttDir, args["ref"] as string);
      const updated = await updateUser(locttDir, target.id, {
        ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
        ...("email" in args
          ? { email: args["email"] as string | null }
          : {}),
        ...(args["timezone"] !== undefined ? { timezone: args["timezone"] as string } : {}),
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
